import { action, KeyDownEvent, SingletonAction } from "@elgato/streamdeck";
import { sendSpecialKey } from "../lib/keystroke.js";

@action({ UUID: "com.siming.claude-code.deny" })
export class Deny extends SingletonAction {
  override async onKeyDown(_ev: KeyDownEvent): Promise<void> {
    await sendSpecialKey("escape");
  }
}
