import {
  action,
  KeyDownEvent,
  SingletonAction,
  WillAppearEvent,
  WillDisappearEvent,
  type KeyAction,
} from "@elgato/streamdeck";
import { sendSpecialKey } from "../lib/keystroke.js";
import { tileForMode, type DisplayMode } from "../lib/render.js";
import {
  detectCurrentMode,
  type PermissionMode,
} from "../lib/session-mode.js";

// Step the Shift+Tab cycle until the focused Claude session's permission-mode
// event log reports the target mode. Best-current-guess cycle order:
//   auto → default → acceptEdits → plan → auto
// If this is wrong, update CYCLE — stepUntil adapts to any ordering.
const CYCLE = ["auto", "default", "acceptEdits", "plan"] as const;
type CycleMode = (typeof CYCLE)[number];

const STEP_DELAY_MS = 80;
const REFRESH_MS = 2_500;
const MAX_STEPS = CYCLE.length + 1;

type TargetMode = "plan" | "auto";

function normalize(mode: PermissionMode | null): CycleMode | null {
  if (mode === "plan" || mode === "auto" || mode === "acceptEdits" || mode === "default") {
    return mode;
  }
  return null;
}

function toDisplay(mode: CycleMode | null): DisplayMode {
  if (!mode) return "unknown";
  return mode;
}

async function stepUntil(from: CycleMode, to: CycleMode): Promise<void> {
  if (from === to) return;
  let idx = CYCLE.indexOf(from);
  for (let i = 0; i < MAX_STEPS && CYCLE[idx] !== to; i++) {
    await sendSpecialKey("tab", ["shift"]);
    idx = (idx + 1) % CYCLE.length;
    if (CYCLE[idx] !== to) {
      await new Promise((r) => setTimeout(r, STEP_DELAY_MS));
    }
  }
}

@action({ UUID: "com.siming.claude-code.plan-mode" })
export class PlanMode extends SingletonAction {
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

  override async onKeyDown(ev: KeyDownEvent): Promise<void> {
    const detected = await detectCurrentMode();
    const current = normalize(detected.mode);
    // If detection failed (no session, unknown mode), default the cycle
    // start to "default" — most user sessions begin there anyway.
    const from: CycleMode = current ?? "default";
    const targetDisplay: TargetMode = from === "plan" ? "auto" : "plan";
    const targetCycle: CycleMode = targetDisplay;

    await stepUntil(from, targetCycle);

    if (ev.action.isKey()) {
      await ev.action.setImage(tileForMode(targetDisplay));
      await ev.action.setTitle("");
    }
  }

  private async refreshAll(): Promise<void> {
    for (const a of this.visible.values()) await this.render(a);
  }

  private async render(target: KeyAction): Promise<void> {
    const detected = await detectCurrentMode();
    const display = toDisplay(normalize(detected.mode));
    await target.setImage(tileForMode(display));
    await target.setTitle("");
  }
}
