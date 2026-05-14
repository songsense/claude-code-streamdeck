// Build SVG data URIs for the info tiles. Stream Deck keys are 144x144 (or 72x72 @1x).
// SVG scales for free, so we draw at 144x144.

interface TileOpts {
  primary: string;      // big number, e.g. "42%" or "$1.23"
  secondary?: string;   // small subtitle, e.g. "2h 13m"
  caption?: string;     // top-of-key label, e.g. "5h" or "session"
  color?: string;       // hex, defines accent
  background?: string;  // hex, key background
}

function colorForPct(pct: number): string {
  if (pct >= 95) return "#dc2626";
  if (pct >= 80) return "#ea580c";
  if (pct >= 50) return "#f59e0b";
  return "#16a34a";
}

function escapeXml(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

export function buildTile(opts: TileOpts): string {
  const bg = opts.background ?? "#111418";
  const accent = opts.color ?? "#9ca3af";
  const primary = escapeXml(opts.primary);
  const secondary = opts.secondary ? escapeXml(opts.secondary) : "";
  const caption = opts.caption ? escapeXml(opts.caption) : "";
  const primarySize = primary.length >= 6 ? 36 : primary.length >= 5 ? 44 : 56;
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="144" height="144" viewBox="0 0 144 144">
  <rect width="144" height="144" rx="14" fill="${bg}"/>
  <rect x="0" y="0" width="144" height="6" fill="${accent}"/>
  ${caption ? `<text x="72" y="28" font-family="-apple-system, system-ui, sans-serif" font-size="14" font-weight="500" fill="#9ca3af" text-anchor="middle">${caption}</text>` : ""}
  <text x="72" y="88" font-family="-apple-system, system-ui, sans-serif" font-size="${primarySize}" font-weight="700" fill="#f3f4f6" text-anchor="middle">${primary}</text>
  ${secondary ? `<text x="72" y="120" font-family="-apple-system, system-ui, sans-serif" font-size="18" font-weight="500" fill="${accent}" text-anchor="middle">${secondary}</text>` : ""}
</svg>`;
  return `data:image/svg+xml;base64,${Buffer.from(svg, "utf8").toString("base64")}`;
}

export function tileForUsagePercent(
  pct: number,
  resetsAtMs: number | undefined,
): string {
  const color = colorForPct(pct);
  let countdown = "";
  if (resetsAtMs != null) {
    const ms = Math.max(0, resetsAtMs - Date.now());
    const h = Math.floor(ms / 3_600_000);
    const m = Math.floor((ms % 3_600_000) / 60_000);
    countdown = h > 0 ? `${h}h ${m}m` : `${m}m`;
  }
  return buildTile({
    caption: "5h",
    primary: `${Math.round(pct)}%`,
    secondary: countdown || undefined,
    color,
  });
}

export function tileForError(message: string): string {
  return buildTile({
    caption: "5h",
    primary: "—",
    secondary: message,
    color: "#6b7280",
  });
}

export function tileForCost(cost: number): string {
  const text = cost >= 100 ? `$${cost.toFixed(0)}` : `$${cost.toFixed(2)}`;
  return buildTile({
    caption: "cost · 5h",
    primary: text,
    color: "#22d3ee",
  });
}

export function tileForMode(mode: "plan" | "auto"): string {
  if (mode === "plan") {
    return buildTile({ caption: "mode", primary: "Plan", color: "#3b82f6", background: "#0b1220" });
  }
  return buildTile({ caption: "mode", primary: "Auto", color: "#f59e0b", background: "#1a1206" });
}

export function tileForTokens(tokens: number, model: string | undefined): string {
  let text: string;
  if (tokens >= 1_000_000) text = `${(tokens / 1_000_000).toFixed(1)}M`;
  else if (tokens >= 1000) text = `${(tokens / 1000).toFixed(1)}k`;
  else text = String(tokens);
  const short = model
    ? model.replace(/^claude-/, "").replace(/-\d{8}$/, "").slice(0, 14)
    : "";
  return buildTile({
    caption: "session",
    primary: text,
    secondary: short || undefined,
    color: "#fbbf24",
  });
}
