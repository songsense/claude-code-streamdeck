import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { readFileSync, existsSync } from "node:fs";
import { homedir, userInfo } from "node:os";
import { join } from "node:path";
import * as https from "node:https";

const execFileAsync = promisify(execFile);

const KEYCHAIN_SERVICE = "Claude Code-credentials";
const USAGE_ENDPOINT = "https://api.anthropic.com/api/oauth/usage";
const CACHE_TTL_MS = 60_000;
const REQUEST_TIMEOUT_MS = 8_000;

export interface UsageWindow {
  utilization: number;
  resetsAt: number;
}

export interface UsageSnapshot {
  fiveHour?: UsageWindow;
  sevenDay?: UsageWindow;
  fetchedAt: number;
  error?: string;
}

let cache: UsageSnapshot | null = null;

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

function fetchUsage(token: string): Promise<UsageSnapshot> {
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
            resolve({
              fetchedAt,
              error: res.statusCode === 429
                ? "rate-limited"
                : `http-${res.statusCode ?? "err"}`,
            });
            return;
          }
          try {
            const data = JSON.parse(body) as RawUsage;
            resolve({
              fetchedAt,
              fiveHour: parseWindow(data.five_hour),
              sevenDay: parseWindow(data.seven_day),
            });
          } catch {
            resolve({ fetchedAt, error: "parse" });
          }
        });
      },
    );
    req.on("error", () =>
      resolve({ fetchedAt: Date.now(), error: "network" }));
    req.on("timeout", () => {
      req.destroy();
      resolve({ fetchedAt: Date.now(), error: "timeout" });
    });
    req.end();
  });
}

export async function getUsage(
  opts: { force?: boolean } = {},
): Promise<UsageSnapshot> {
  const now = Date.now();
  if (!opts.force && cache && now - cache.fetchedAt < CACHE_TTL_MS) {
    return cache;
  }
  const token = await readAccessToken();
  if (!token) {
    const snap: UsageSnapshot = { fetchedAt: now, error: "no-token" };
    cache = snap;
    return snap;
  }
  const snap = await fetchUsage(token);
  cache = snap;
  return snap;
}
