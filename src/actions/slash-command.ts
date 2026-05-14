import {
  action,
  KeyDownEvent,
  SingletonAction,
  WillAppearEvent,
} from "@elgato/streamdeck";
import { sendKeystroke } from "../lib/keystroke.js";

type Settings = { text?: string; enter?: boolean };

function readSettings(raw: unknown): Settings {
  return (raw ?? {}) as Settings;
}

@action({ UUID: "com.siming.claude-code.slash-command" })
export class SlashCommand extends SingletonAction {
  override async onWillAppear(ev: WillAppearEvent): Promise<void> {
    if (!ev.action.isKey()) return;
    const settings = readSettings(ev.payload.settings);
    if (settings.text) {
      const t = settings.text;
      await ev.action.setTitle(t.length > 10 ? t.slice(0, 10) : t);
    }
  }

  override async onKeyDown(ev: KeyDownEvent): Promise<void> {
    const settings = readSettings(ev.payload.settings);
    const text = settings.text ?? "";
    if (!text) return;
    const enter = settings.enter !== false;
    await sendKeystroke(text, { enter });
  }
}
