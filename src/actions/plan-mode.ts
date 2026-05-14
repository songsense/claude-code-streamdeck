import { action, KeyDownEvent, SingletonAction } from "@elgato/streamdeck";
import { sendSpecialKey } from "../lib/keystroke.js";

// Shift+Tab toggles Claude Code between plan-mode and auto-accept-edits mode.
@action({ UUID: "com.siming.claude-code.plan-mode" })
export class PlanMode extends SingletonAction {
  override async onKeyDown(_ev: KeyDownEvent): Promise<void> {
    await sendSpecialKey("tab", ["shift"]);
  }
}
