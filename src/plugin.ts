import streamDeck, { LogLevel } from "@elgato/streamdeck";

import { Approve } from "./actions/approve.js";
import { Clear } from "./actions/clear.js";
import { Compact } from "./actions/compact.js";
import { CostWindow } from "./actions/cost-window.js";
import { Deny } from "./actions/deny.js";
import { PlanMode } from "./actions/plan-mode.js";
import { SessionTokens } from "./actions/session-tokens.js";
import { SlashCommand } from "./actions/slash-command.js";
import { Usage5h } from "./actions/usage-5h.js";

streamDeck.logger.setLevel(LogLevel.INFO);

streamDeck.actions.registerAction(new Approve());
streamDeck.actions.registerAction(new Deny());
streamDeck.actions.registerAction(new Compact());
streamDeck.actions.registerAction(new Clear());
streamDeck.actions.registerAction(new SlashCommand());
streamDeck.actions.registerAction(new PlanMode());
streamDeck.actions.registerAction(new Usage5h());
streamDeck.actions.registerAction(new CostWindow());
streamDeck.actions.registerAction(new SessionTokens());

streamDeck.connect();
