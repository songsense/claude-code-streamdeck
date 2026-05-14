import { action, KeyDownEvent, SingletonAction } from "@elgato/streamdeck";
import { sendSpecialKey } from "../lib/keystroke.js";

// Claude Code's Shift+Tab is a 3-way cycle (default → auto-accept → plan).
// Two presses advance two steps, which skips "default" — so plan → auto and
// default → plan land cleanly. Auto → default is the one asymmetric case,
// which the user accepts (manual one-press if needed).
@action({ UUID: "com.siming.claude-code.plan-mode" })
export class PlanMode extends SingletonAction {
  override async onKeyDown(_ev: KeyDownEvent): Promise<void> {
    await sendSpecialKey("tab", ["shift"]);
    await new Promise((r) => setTimeout(r, 60));
    await sendSpecialKey("tab", ["shift"]);
  }
}
