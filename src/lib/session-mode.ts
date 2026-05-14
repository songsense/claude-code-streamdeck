import { readdirSync, readFileSync, statSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";

export type PermissionMode =
  | "plan"
  | "auto"
  | "acceptEdits"
  | "default"
  | "bypassPermissions";

const PROJECTS_ROOT = join(homedir(), ".claude", "projects");
const TAIL_BYTES = 64 * 1024; // 64 KB is more than enough to find the last mode event

/**
 * Return the path of the most-recently-modified .jsonl session log. We treat
 * this as the "active" session — the one the user most likely just touched in
 * a focused terminal.
 */
export function findActiveSessionJsonl(): string | null {
  let best: { path: string; mtimeMs: number } | null = null;
  let projects: string[];
  try {
    projects = readdirSync(PROJECTS_ROOT, { withFileTypes: true })
      .filter((d) => d.isDirectory())
      .map((d) => join(PROJECTS_ROOT, d.name));
  } catch {
    return null;
  }
  for (const dir of projects) {
    let files;
    try {
      files = readdirSync(dir, { withFileTypes: true });
    } catch {
      continue;
    }
    for (const f of files) {
      if (!f.isFile() || !f.name.endsWith(".jsonl")) continue;
      const p = join(dir, f.name);
      try {
        const s = statSync(p);
        if (!best || s.mtimeMs > best.mtimeMs) best = { path: p, mtimeMs: s.mtimeMs };
      } catch {
        /* skip */
      }
    }
  }
  return best?.path ?? null;
}

/**
 * Tail the file and scan backwards for the most recent `permission-mode`
 * entry. Returns the raw `permissionMode` value, or null if not found.
 */
export function detectModeInFile(path: string): PermissionMode | null {
  let buf: Buffer;
  try {
    const fd = openForRead(path);
    if (!fd) return null;
    const { size } = fd;
    const readLen = Math.min(size, TAIL_BYTES);
    buf = Buffer.alloc(readLen);
    fd.fd.read(buf, 0, readLen, size - readLen);
    fd.fd.close();
  } catch {
    try {
      buf = readFileSync(path);
    } catch {
      return null;
    }
  }
  const text = buf.toString("utf8");
  const lines = text.split("\n");
  for (let i = lines.length - 1; i >= 0; i--) {
    const line = lines[i];
    if (!line || !line.includes('"permission-mode"')) continue;
    try {
      const entry = JSON.parse(line);
      if (entry?.type === "permission-mode" && typeof entry.permissionMode === "string") {
        return entry.permissionMode as PermissionMode;
      }
    } catch {
      /* malformed tail line — skip */
    }
  }
  return null;
}

interface FdHandle {
  fd: {
    read(buf: Buffer, offset: number, length: number, position: number): void;
    close(): void;
  };
  size: number;
}

function openForRead(_path: string): FdHandle | null {
  // Always use the simpler readFileSync path; if files ever grow huge we can
  // switch to fs.openSync/readSync. Returning null falls back to that.
  return null;
}

export function detectCurrentMode(): PermissionMode | null {
  const path = findActiveSessionJsonl();
  if (!path) return null;
  return detectModeInFile(path);
}
