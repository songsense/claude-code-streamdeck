import {
  action,
  SingletonAction,
  WillAppearEvent,
  WillDisappearEvent,
  type KeyAction,
} from "@elgato/streamdeck";
import { scanLatestSession } from "../lib/usage-local.js";
import { tileForTokens } from "../lib/render.js";

const REFRESH_MS = 5_000;

@action({ UUID: "com.siming.claude-code.session-tokens" })
export class SessionTokens extends SingletonAction {
  private visible = new Map<string, KeyAction>();
  private timer: ReturnType<typeof setInterval> | null = null;

  override async onWillAppear(ev: WillAppearEvent): Promise<void> {
    if (!ev.action.isKey()) return;
    this.visible.set(ev.action.id, ev.action);
    if (!this.timer) this.timer = setInterval(() => this.refreshAll(), REFRESH_MS);
    await this.render(ev.action);
  }

  override onWillDisappear(ev: WillDisappearEvent): void {
    this.visible.delete(ev.action.id);
    if (this.visible.size === 0 && this.timer) {
      clearInterval(this.timer);
      this.timer = null;
    }
  }

  private async refreshAll(): Promise<void> {
    for (const a of this.visible.values()) await this.render(a);
  }

  private async render(target: KeyAction): Promise<void> {
    const s = scanLatestSession();
    await target.setImage(tileForTokens(s.totalTokens, s.model));
  }
}
