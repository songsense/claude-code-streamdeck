import {
  action,
  KeyDownEvent,
  SingletonAction,
  WillAppearEvent,
  WillDisappearEvent,
  type KeyAction,
} from "@elgato/streamdeck";
import { getUsage } from "../lib/usage-api.js";
import { tileForError, tileForUsagePercent } from "../lib/render.js";

const REFRESH_MS = 30_000;

@action({ UUID: "com.siming.claude-code.usage-5h" })
export class Usage5h extends SingletonAction {
  private visible = new Map<string, KeyAction>();
  private timer: ReturnType<typeof setInterval> | null = null;

  override async onWillAppear(ev: WillAppearEvent): Promise<void> {
    if (!ev.action.isKey()) return;
    this.visible.set(ev.action.id, ev.action);
    if (!this.timer) this.timer = setInterval(() => this.refreshAll(), REFRESH_MS);
    await this.render(ev.action, { force: false });
  }

  override onWillDisappear(ev: WillDisappearEvent): void {
    this.visible.delete(ev.action.id);
    if (this.visible.size === 0 && this.timer) {
      clearInterval(this.timer);
      this.timer = null;
    }
  }

  override async onKeyDown(ev: KeyDownEvent): Promise<void> {
    await this.render(ev.action, { force: true });
  }

  private async refreshAll(): Promise<void> {
    for (const a of this.visible.values()) await this.render(a, { force: false });
  }

  private async render(target: KeyAction, opts: { force: boolean }): Promise<void> {
    const usage = await getUsage({ force: opts.force });
    let image: string;
    if (usage.error) {
      image = tileForError(usage.error);
    } else if (usage.fiveHour) {
      // API already returns utilization as a 0-100 percentage, not a 0-1 fraction.
      image = tileForUsagePercent(usage.fiveHour.utilization, usage.fiveHour.resetsAt);
    } else {
      image = tileForError("no data");
    }
    await target.setImage(image);
  }
}
