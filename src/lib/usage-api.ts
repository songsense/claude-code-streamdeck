import { execFile } from "node:child_process";
import { promisify } from "node:util";
import {
  readFileSync,
  writeFileSync,
  existsSync,
  mkdirSync,
} from "node:fs";
import { homedir, userInfo } from "node:os";
import { join, dirname } from "node:path";
import * as https from "node:https";

const execFileAsync = promisify(execFile);

const KEYCHAIN_SERVICE = "Claude Code-credentials";
const USAGE_ENDPOINT = "https://api.anthropic.com/api/oauth/usage";
const CACHE_TTL_MS = 60_000;
const RATE_LIMIT_BACKOFF_MS = 5 * 60_000; // 5 min minimum after a 429
const ERROR_BACKOFF_MS = 60_000; // shorter backoff for transient errors
const REQUEST_TIMEOUT_MS = 8_000;
const DISK_CACHE_PATH = join(
  homedir(),
  "Library",
  "Caches",
  "com.siming.claude-code",
  "usage-cache.json",
);

export interface UsageWindow {
  utilization: number;
  resetsAt: number;
}

export interface UsageSnapshot {
  fiveHour?: UsageWindow;
  sevenDay?: UsageWindow;
  fetchedAt: number;
  error?: string;
  /** true when the data is served from cache after a failed/blocked refresh */
  stale?: boolean;
}

// Last *successful* snapshot — the value we fall back to on any failure.
let lastGood: UsageSnapshot | null = null;
// Earliest time we're allowed to hit the API again (rate-limit / error backoff).
let nextFetchAllowedAt = 0;
let diskLoaded = false;

function loadDiskCache(): void {
  if (diskLoaded) return;
  diskLoaded = true;
  try {
    if (!existsSync(DISK_CACHE_PATH)) return;
    const data = JSON.parse(readFileSync(DISK_CACHE_PATH, "utf8"));
    if (
      data
      && typeof data.fetchedAt === "number"
      && (data.fiveHour || data.sevenDay)
    ) {
      lastGood = data as UsageSnapshot;
    }
  } catch {
    // corrupt cache — ignore
  }
}

function saveDiskCache(snap: UsageSnapshot): void {
  try {
    mkdirSync(dirname(DISK_CACHE_PATH), { recursive: true });
    writeFileSync(DISK_CACHE_PATH, JSON.stringify(snap), "utf8");
  } catch {
    // best-effort — a missing cache just means an extra API call later
  }
}

function parseRetryAfter(raw: string | string[] | undefined): number | null {
  const v = Array.isArray(raw) ? raw[0] : raw;
  if (!v) return null;
  const secs = parseInt(v, 10);
  if (Number.isFinite(secs) && secs > 0) return secs * 1000;
  const dateMs = Date.parse(v);
  if (Number.isFinite(dateMs)) return Math.max(0, dateMs - Date.now());
  return null;
}

async function readKeychainToken(): Promise<string | null> {
  if (process.platform !== "darwin") return null;
  const account = userInfo().username;
  const tryArgs: string[][] = [
    ["find-generic-password", "-s", KEYCHAIN_SERVICE, "-a", account, "-w"],
    ["find-generic-password", "-s", KEYCHAIN_SERVICE, "-w"],
  ];
  for (const args of tryArgs) {
    try {
      const { stdout } = await execFileAsync("/usr/bin/security", args, {
        timeout: 3000,
      });
      const trimmed = stdout.trim();
      if (!trimmed) continue;
      const parsed = JSON.parse(trimmed);
      const token = parsed?.claudeAiOauth?.accessToken;
      const expiresAt = parsed?.claudeAiOauth?.expiresAt;
      if (typeof token === "string" && token.length > 0) {
        if (typeof expiresAt === "number" && expiresAt <= Date.now()) {
          continue;
        }
        return token;
      }
    } catch {
      // continue to next service name
    }
  }
  return null;
}

function readFileToken(): string | null {
  const path = join(homedir(), ".claude", ".credentials.json");
  if (!existsSync(path)) return null;
  try {
    const data = JSON.parse(readFileSync(path, "utf8"));
    const token = data?.claudeAiOauth?.accessToken;
    const expiresAt = data?.claudeAiOauth?.expiresAt;
    if (typeof token !== "string" || !token) return null;
    if (typeof expiresAt === "number" && expiresAt <= Date.now()) return null;
    return token;
  } catch {
    return null;
  }
}

async function readAccessToken(): Promise<string | null> {
  return (await readKeychainToken()) ?? readFileToken();
}

interface RawUsage {
  five_hour?: { utilization?: number; resets_at?: string };
  seven_day?: { utilization?: number; resets_at?: string };
}

function parseWindow(
  raw: { utilization?: number; resets_at?: string } | undefined,
): UsageWindow | undefined {
  if (!raw) return undefined;
  const u = typeof raw.utilization === "number" ? raw.utilization : NaN;
  const r = raw.resets_at ? Date.parse(raw.resets_at) : NaN;
  if (!Number.isFinite(u) || !Number.isFinite(r)) return undefined;
  return { utilization: u, resetsAt: r };
}

interface FetchResult {
  snapshot?: UsageSnapshot; // present on HTTP 200
  error?: string; // present on failure
  backoffMs: number; // how long before we should try again
}

function fetchUsage(token: string): Promise<FetchResult> {
  return new Promise((resolve) => {
    const url = new URL(USAGE_ENDPOINT);
    const req = https.request(
      {
        hostname: url.hostname,
        path: url.pathname,
        method: "GET",
        timeout: REQUEST_TIMEOUT_MS,
        headers: {
          Authorization: `Bearer ${token}`,
          "anthropic-beta": "oauth-2025-04-20",
          "User-Agent": "claude-code-streamdeck/0.1",
        },
      },
      (res) => {
        let body = "";
        res.on("data", (chunk) => (body += chunk));
        res.on("end", () => {
          const fetchedAt = Date.now();
          if (res.statusCode !== 200) {
            const isRateLimited = res.statusCode === 429;
            const retryAfterMs = isRateLimited
              ? parseRetryAfter(res.headers["retry-after"])
              : null;
            resolve({
              error: isRateLimited
                ? "rate-limited"
                : `http-${res.statusCode ?? "err"}`,
              backoffMs: isRateLimited
                ? Math.max(RATE_LIMIT_BACKOFF_MS, retryAfterMs ?? 0)
                : ERROR_BACKOFF_MS,
            });
            return;
          }
          try {
            const data = JSON.parse(body) as RawUsage;
            resolve({
              snapshot: {
                fetchedAt,
                fiveHour: parseWindow(data.five_hour),
                sevenDay: parseWindow(data.seven_day),
              },
              backoffMs: CACHE_TTL_MS,
            });
          } catch {
            resolve({ error: "parse", backoffMs: ERROR_BACKOFF_MS });
          }
        });
      },
    );
    req.on("error", () => resolve({ error: "network", backoffMs: ERROR_BACKOFF_MS }));
    req.on("timeout", () => {
      req.destroy();
      resolve({ error: "timeout", backoffMs: ERROR_BACKOFF_MS });
    });
    req.end();
  });
}

/** Return lastGood marked stale, or a bare error snapshot if we have nothing. */
function fallback(error: string): UsageSnapshot {
  if (lastGood) return { ...lastGood, stale: true, error };
  return { fetchedAt: Date.now(), error };
}

export async function getUsage(
  opts: { force?: boolean } = {},
): Promise<UsageSnapshot> {
  loadDiskCache();
  const now = Date.now();

  // Fresh successful data — serve it without touching the network.
  if (
    !opts.force
    && lastGood
    && now - lastGood.fetchedAt < CACHE_TTL_MS
  ) {
    return lastGood;
  }

  // In backoff after a recent failure — don't hammer the API, serve stale.
  if (now < nextFetchAllowedAt) {
    return fallback("backoff");
  }

  const token = await readAccessToken();
  if (!token) {
    nextFetchAllowedAt = now + ERROR_BACKOFF_MS;
    return fallback("no-token");
  }

  const result = await fetchUsage(token);
  nextFetchAllowedAt = Date.now() + result.backoffMs;

  if (result.snapshot) {
    lastGood = result.snapshot;
    saveDiskCache(result.snapshot);
    return result.snapshot;
  }

  return fallback(result.error ?? "unknown");
}
