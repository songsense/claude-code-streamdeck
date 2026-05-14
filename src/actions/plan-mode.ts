import {
  action,
  KeyDownEvent,
  SingletonAction,
  WillAppearEvent,
} from "@elgato/streamdeck";
import { sendSpecialKey } from "../lib/keystroke.js";
import { tileForMode } from "../lib/render.js";

// Claude Code's Shift+Tab is a 3-way cycle (default → auto → plan). Two
// presses advance two steps and skip "default", so each key press toggles
// plan ⇄ auto. We track the assumed current mode in per-key settings since
// there's no way to read Claude Code's live mode from outside the process.
// First press from a fresh default state lands on plan, so we default the
// tracked state to "auto" — flipping to "plan" after the press.

type Mode = "plan" | "auto";
type Settings = { mode?: Mode };

function readMode(raw: unknown): Mode {
  const m = (raw as Settings | undefined)?.mode;
  return m === "plan" || m === "auto" ? m : "auto";
}

@action({ UUID: "com.siming.claude-code.plan-mode" })
export class PlanMode extends SingletonAction {
  override async onWillAppear(ev: WillAppearEvent): Promise<void> {
    if (!ev.action.isKey()) return;
    const mode = readMode(ev.payload.settings);
    await ev.action.setImage(tileForMode(mode));
    await ev.action.setTitle("");
  }

  override async onKeyDown(ev: KeyDownEvent): Promise<void> {
    const current = readMode(ev.payload.settings);
    const next: Mode = current === "plan" ? "auto" : "plan";

    await sendSpecialKey("tab", ["shift"]);
    await new Promise((r) => setTimeout(r, 60));
    await sendSpecialKey("tab", ["shift"]);

    if (ev.action.isKey()) {
      await ev.action.setSettings({ mode: next } satisfies Settings);
      await ev.action.setImage(tileForMode(next));
      await ev.action.setTitle("");
    }
  }
}
