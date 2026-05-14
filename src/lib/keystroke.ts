import { execFile } from "node:child_process";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);

function escapeForAppleScript(text: string): string {
  return text.replace(/\\/g, "\\\\").replace(/"/g, '\\"');
}

export type KeyName = "return" | "escape" | "tab" | "space" | "delete";

const KEY_CODES: Record<KeyName, number> = {
  return: 36,
  escape: 53,
  tab: 48,
  space: 49,
  delete: 51,
};

export async function sendKeystroke(
  text: string,
  opts: { enter?: boolean } = {},
): Promise<void> {
  const lines: string[] = [`tell application "System Events"`];
  if (text.length > 0) {
    lines.push(`  keystroke "${escapeForAppleScript(text)}"`);
  }
  if (opts.enter) {
    lines.push(`  key code ${KEY_CODES.return}`);
  }
  lines.push(`end tell`);
  const script = lines.join("\n");
  await execFileAsync("/usr/bin/osascript", ["-e", script], { timeout: 5000 });
}

export type Modifier = "shift" | "control" | "option" | "command";

const MODIFIER_PHRASE: Record<Modifier, string> = {
  shift: "shift down",
  control: "control down",
  option: "option down",
  command: "command down",
};

function modifierClause(mods: Modifier[]): string {
  if (mods.length === 0) return "";
  if (mods.length === 1) return ` using ${MODIFIER_PHRASE[mods[0]!]}`;
  return ` using {${mods.map((m) => MODIFIER_PHRASE[m]).join(", ")}}`;
}

export async function sendSpecialKey(
  key: KeyName,
  modifiers: Modifier[] = [],
): Promise<void> {
  const script =
    `tell application "System Events" to key code ${KEY_CODES[key]}${modifierClause(modifiers)}`;
  await execFileAsync("/usr/bin/osascript", ["-e", script], { timeout: 5000 });
}
