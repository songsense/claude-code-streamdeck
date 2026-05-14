import { readdirSync, statSync, readFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";

// Per-million-token pricing in USD. Approximate, edit as needed.
interface ModelPrice {
  input: number;
  output: number;
  cacheWrite: number;
  cacheRead: number;
}

const PRICING: { match: RegExp; price: ModelPrice }[] = [
  {
    match: /opus/i,
    price: { input: 15, output: 75, cacheWrite: 18.75, cacheRead: 1.5 },
  },
  {
    match: /sonnet/i,
    price: { input: 3, output: 15, cacheWrite: 3.75, cacheRead: 0.3 },
  },
  {
    match: /haiku/i,
    price: { input: 1, output: 5, cacheWrite: 1.25, cacheRead: 0.1 },
  },
];

const DEFAULT_PRICE: ModelPrice = {
  input: 3,
  output: 15,
  cacheWrite: 3.75,
  cacheRead: 0.3,
};

function priceFor(model: string | undefined): ModelPrice {
  if (!model) return DEFAULT_PRICE;
  for (const { match, price } of PRICING) if (match.test(model)) return price;
  return DEFAULT_PRICE;
}

interface Aggregate {
  inputTokens: number;
  outputTokens: number;
  cacheWriteTokens: number;
  cacheReadTokens: number;
  costUsd: number;
  model?: string;
}

function emptyAgg(): Aggregate {
  return {
    inputTokens: 0,
    outputTokens: 0,
    cacheWriteTokens: 0,
    cacheReadTokens: 0,
    costUsd: 0,
  };
}

function listJsonlFiles(root: string): { path: string; mtimeMs: number }[] {
  const out: { path: string; mtimeMs: number }[] = [];
  let projectDirs: string[];
  try {
    projectDirs = readdirSync(root, { withFileTypes: true })
      .filter((d) => d.isDirectory())
      .map((d) => join(root, d.name));
  } catch {
    return out;
  }
  for (const dir of projectDirs) {
    let entries;
    try {
      entries = readdirSync(dir, { withFileTypes: true });
    } catch {
      continue;
    }
    for (const e of entries) {
      if (!e.isFile() || !e.name.endsWith(".jsonl")) continue;
      const p = join(dir, e.name);
      try {
        const s = statSync(p);
        out.push({ path: p, mtimeMs: s.mtimeMs });
      } catch {
        /* skip */
      }
    }
  }
  return out;
}

function aggregateFile(
  path: string,
  sinceMs: number | null,
  agg: Aggregate,
): void {
  let content: string;
  try {
    content = readFileSync(path, "utf8");
  } catch {
    return;
  }
  let lastModel: string | undefined;
  for (const line of content.split("\n")) {
    if (!line) continue;
    let entry: any;
    try {
      entry = JSON.parse(line);
    } catch {
      continue;
    }
    if (sinceMs != null) {
      const ts = entry?.timestamp ? Date.parse(entry.timestamp) : NaN;
      if (!Number.isFinite(ts) || ts < sinceMs) continue;
    }
    const usage = entry?.message?.usage;
    if (!usage) continue;
    const model: string | undefined = entry?.message?.model;
    if (model) lastModel = model;
    const price = priceFor(model);
    const input = usage.input_tokens ?? 0;
    const output = usage.output_tokens ?? 0;
    const cacheW = usage.cache_creation_input_tokens ?? 0;
    const cacheR = usage.cache_read_input_tokens ?? 0;
    agg.inputTokens += input;
    agg.outputTokens += output;
    agg.cacheWriteTokens += cacheW;
    agg.cacheReadTokens += cacheR;
    agg.costUsd +=
      (input * price.input
        + output * price.output
        + cacheW * price.cacheWrite
        + cacheR * price.cacheRead) / 1_000_000;
  }
  if (lastModel && !agg.model) agg.model = lastModel;
}

export interface WindowUsage {
  costUsd: number;
  inputTokens: number;
  outputTokens: number;
}

export interface SessionUsage {
  totalTokens: number;
  model?: string;
  path?: string;
}

const PROJECTS_ROOT = join(homedir(), ".claude", "projects");

export function scanWindow(sinceMs: number): WindowUsage {
  const agg = emptyAgg();
  const files = listJsonlFiles(PROJECTS_ROOT);
  for (const f of files) {
    if (f.mtimeMs < sinceMs) continue; // file untouched in window
    aggregateFile(f.path, sinceMs, agg);
  }
  return {
    costUsd: agg.costUsd,
    inputTokens: agg.inputTokens,
    outputTokens: agg.outputTokens,
  };
}

export function scanLatestSession(): SessionUsage {
  const files = listJsonlFiles(PROJECTS_ROOT);
  if (files.length === 0) return { totalTokens: 0 };
  files.sort((a, b) => b.mtimeMs - a.mtimeMs);
  const latest = files[0]!;
  const agg = emptyAgg();
  aggregateFile(latest.path, null, agg);
  return {
    totalTokens: agg.inputTokens + agg.outputTokens,
    model: agg.model,
    path: latest.path,
  };
}
