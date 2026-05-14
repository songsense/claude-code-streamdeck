import { action, KeyDownEvent, SingletonAction } from "@elgato/streamdeck";
import { sendKeystroke } from "../lib/keystroke.js";

@action({ UUID: "com.siming.claude-code.approve" })
export class Approve extends SingletonAction {
  override async onKeyDown(_ev: KeyDownEvent): Promise<void> {
    await sendKeystroke("1", { enter: true });
  }
}
