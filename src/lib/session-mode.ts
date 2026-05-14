import { execFile } from "node:child_process";
import { readdirSync, readFileSync, statSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);

export type PermissionMode =
  | "plan"
  | "auto"
  | "acceptEdits"
  | "default"
  | "bypassPermissions";

const CLAUDE_HOME = join(homedir(), ".claude");
const SESSIONS_DIR = join(CLAUDE_HOME, "sessions");
const PROJECTS_ROOT = join(CLAUDE_HOME, "projects");
const TAIL_BYTES = 64 * 1024;

interface SessionMeta {
  pid: number;
  sessionId: string;
  cwd?: string;
  updatedAt?: number;
  status?: string;
  kind?: string;
}

function readAllSessionMeta(): SessionMeta[] {
  let files: string[];
  try {
    files = readdirSync(SESSIONS_DIR).filter((f) => f.endsWith(".json"));
  } catch {
    return [];
  }
  const out: SessionMeta[] = [];
  for (const f of files) {
    try {
      const data = JSON.parse(readFileSync(join(SESSIONS_DIR, f), "utf8"));
      if (typeof data?.pid === "number" && typeof data?.sessionId === "string") {
        out.push(data as SessionMeta);
      }
    } catch {
      /* skip malformed */
    }
  }
  return out;
}

/**
 * Ask System Events for the unix PID of the frontmost process. Returns null
 * if the AppleScript fails (e.g. accessibility not granted).
 */
async function getFrontmostPid(): Promise<number | null> {
  try {
    const { stdout } = await execFileAsync(
      "/usr/bin/osascript",
      [
        "-e",
        'tell application "System Events" to return unix id of first process whose frontmost is true',
      ],
      { timeout: 2000 },
    );
    const pid = parseInt(stdout.trim(), 10);
    return Number.isFinite(pid) ? pid : null;
  } catch {
    return null;
  }
}

/**
 * Build a pid → children map by parsing `ps -axo pid,ppid`, then return the
 * transitive descendant set of `rootPid` (including itself).
 */
async function getDescendantPids(rootPid: number): Promise<Set<number>> {
  const out = await execFileAsync("/bin/ps", ["-axo", "pid=,ppid="], {
    timeout: 3000,
    maxBuffer: 4 * 1024 * 1024,
  });
  const children = new Map<number, number[]>();
  for (const line of out.stdout.split("\n")) {
    const m = line.trim().match(/^(\d+)\s+(\d+)/);
    if (!m) continue;
    const pid = parseInt(m[1]!, 10);
    const ppid = parseInt(m[2]!, 10);
    if (!children.has(ppid)) children.set(ppid, []);
    children.get(ppid)!.push(pid);
  }
  const out_set = new Set<number>([rootPid]);
  const stack = [rootPid];
  while (stack.length) {
    const p = stack.pop()!;
    for (const k of children.get(p) ?? []) {
      if (!out_set.has(k)) {
        out_set.add(k);
        stack.push(k);
      }
    }
  }
  return out_set;
}

/**
 * Pick the Claude session whose PID is a descendant of the frontmost app.
 * Tiebreak when multiple match (multiple tabs running `claude`):
 *   1. Prefer "idle" status — the busy session is the one running tools
 *      (very likely the conversation invoking this very plugin), not the
 *      one the user wants to toggle.
 *   2. Among matches with the same status, prefer most-recently-updated.
 * Returns null if no descendant matches a known session.
 */
export async function findFocusedSession(): Promise<SessionMeta | null> {
  const frontPid = await getFrontmostPid();
  if (!frontPid) return null;
  const descendants = await getDescendantPids(frontPid);
  const sessions = readAllSessionMeta().filter(
    (s) => s.kind !== "headless" && descendants.has(s.pid),
  );
  if (sessions.length === 0) return null;
  // Among multiple descendants, the most-recently-busy one is almost
  // certainly the session running this very plugin (it's writing tool
  // results constantly). Drop that one when we have alternatives.
  let candidates = sessions;
  if (sessions.length > 1) {
    const mostRecentBusy = [...sessions]
      .filter((s) => s.status === "busy")
      .sort((a, b) => (b.updatedAt ?? 0) - (a.updatedAt ?? 0))[0];
    if (mostRecentBusy) {
      const filtered = sessions.filter(
        (s) => s.sessionId !== mostRecentBusy.sessionId,
      );
      if (filtered.length > 0) candidates = filtered;
    }
  }
  candidates.sort((a, b) => {
    const aIdle = a.status === "idle" ? 1 : 0;
    const bIdle = b.status === "idle" ? 1 : 0;
    if (aIdle !== bIdle) return bIdle - aIdle;
    return (b.updatedAt ?? 0) - (a.updatedAt ?? 0);
  });
  return candidates[0]!;
}

/**
 * Fallback when no focused session is detectable: pick the interactive
 * session with the most-recent updatedAt. Less accurate but always returns
 * something if any claude is running.
 */
function fallbackSession(): SessionMeta | null {
  const sessions = readAllSessionMeta().filter((s) => s.kind !== "headless");
  if (sessions.length === 0) return null;
  sessions.sort((a, b) => (b.updatedAt ?? 0) - (a.updatedAt ?? 0));
  return sessions[0]!;
}

function findJsonlForSession(sessionId: string): string | null {
  let projects: string[];
  try {
    projects = readdirSync(PROJECTS_ROOT, { withFileTypes: true })
      .filter((d) => d.isDirectory())
      .map((d) => join(PROJECTS_ROOT, d.name));
  } catch {
    return null;
  }
  let best: { path: string; mtimeMs: number } | null = null;
  for (const dir of projects) {
    const candidate = join(dir, `${sessionId}.jsonl`);
    try {
      const s = statSync(candidate);
      if (!best || s.mtimeMs > best.mtimeMs) {
        best = { path: candidate, mtimeMs: s.mtimeMs };
      }
    } catch {
      /* not in this project dir */
    }
  }
  return best?.path ?? null;
}

function detectModeInFile(path: string): PermissionMode | null {
  let buf: Buffer;
  try {
    const stat = statSync(path);
    const len = Math.min(stat.size, TAIL_BYTES);
    if (stat.size > len) {
      // Read just the tail to keep this cheap on long sessions.
      const fs = require("node:fs") as typeof import("node:fs");
      const fd = fs.openSync(path, "r");
      buf = Buffer.alloc(len);
      fs.readSync(fd, buf, 0, len, stat.size - len);
      fs.closeSync(fd);
    } else {
      buf = readFileSync(path);
    }
  } catch {
    return null;
  }
  const text = buf.toString("utf8");
  const lines = text.split("\n");
  for (let i = lines.length - 1; i >= 0; i--) {
    const line = lines[i];
    if (!line || !line.includes('"permission-mode"')) continue;
    try {
      const entry = JSON.parse(line);
      if (
        entry?.type === "permission-mode"
        && typeof entry.permissionMode === "string"
      ) {
        return entry.permissionMode as PermissionMode;
      }
    } catch {
      /* malformed tail line, keep scanning */
    }
  }
  return null;
}

export interface DetectedMode {
  mode: PermissionMode | null;
  sessionId: string | null;
  source: "focused" | "fallback" | "none";
}

export async function detectCurrentMode(): Promise<DetectedMode> {
  const focused = await findFocusedSession();
  const chosen = focused ?? fallbackSession();
  if (!chosen) return { mode: null, sessionId: null, source: "none" };
  const path = findJsonlForSession(chosen.sessionId);
  if (!path) return { mode: null, sessionId: chosen.sessionId, source: focused ? "focused" : "fallback" };
  const mode = detectModeInFile(path);
  return {
    mode,
    sessionId: chosen.sessionId,
    source: focused ? "focused" : "fallback",
  };
}
