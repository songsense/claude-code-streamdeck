import { action, KeyDownEvent, SingletonAction } from "@elgato/streamdeck";
import { sendKeystroke } from "../lib/keystroke.js";

@action({ UUID: "com.siming.claude-code.compact" })
export class Compact extends SingletonAction {
  override async onKeyDown(_ev: KeyDownEvent): Promise<void> {
    await sendKeystroke("/compact", { enter: true });
  }
}
