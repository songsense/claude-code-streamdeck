import {
  action,
  KeyDownEvent,
  SingletonAction,
  WillAppearEvent,
} from "@elgato/streamdeck";
import { sendSpecialKey } from "../lib/keystroke.js";
import { tileForMode } from "../lib/render.js";

// Claude Code's Shift+Tab steps forward through a mode cycle. We track our
// assumed position in the cycle as the user-visible mode (plan or auto) and
// keep tapping Shift+Tab until we land on the target. If Claude Code changes
// its cycle order or adds a mode, update `CYCLE` — no other code change.
const CYCLE = ["default", "auto", "plan"] as const;
type CycleMode = (typeof CYCLE)[number];

const STEP_DELAY_MS = 60;
const MAX_STEPS = CYCLE.length + 1; // safety bound

type Mode = "plan" | "auto";
type Settings = { mode?: Mode };

function readMode(raw: unknown): Mode {
  const m = (raw as Settings | undefined)?.mode;
  return m === "plan" || m === "auto" ? m : "auto";
}

async function stepCycle(from: CycleMode, to: Mode): Promise<void> {
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
  override async onWillAppear(ev: WillAppearEvent): Promise<void> {
    if (!ev.action.isKey()) return;
    const mode = readMode(ev.payload.settings);
    await ev.action.setImage(tileForMode(mode));
    await ev.action.setTitle("");
  }

  override async onKeyDown(ev: KeyDownEvent): Promise<void> {
    const current = readMode(ev.payload.settings);
    const next: Mode = current === "plan" ? "auto" : "plan";

    await stepCycle(current, next);

    if (ev.action.isKey()) {
      await ev.action.setSettings({ mode: next } satisfies Settings);
      await ev.action.setImage(tileForMode(next));
      await ev.action.setTitle("");
    }
  }
}
