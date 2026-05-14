# Claude Code — Stream Deck plugin

Physical-key controls for [Claude Code](https://claude.com/claude-code) on macOS.

Approve / deny permission prompts, watch your 5-hour usage with a live reset
countdown, fire slash commands, and see local-log cost and token counters — all
on your Stream Deck.

> Personal-use plugin. macOS only. Not affiliated with Elgato or Anthropic.

## Actions

| Action | What it does |
| --- | --- |
| **Approve** | Sends `1` + Return to the frontmost app — accepts a Claude Code permission prompt. |
| **Deny** | Sends Escape to the frontmost app — cancels the current prompt. |
| **/compact** | Types `/compact` + Return. |
| **/clear** | Types `/clear` + Return. |
| **Slash Command** | Configurable text + Return. Set the command in the property inspector (`/review`, `/security-review`, anything). |
| **Usage (5h)** | Polls `api.anthropic.com/api/oauth/usage` every 30 s. Shows percent used and time until reset. Press to force-refresh. Color thresholds: green <50 %, yellow 50–79, orange 80–94, red ≥95. |
| **Cost (5h window)** | Sums approximate $ from `~/.claude/projects/**/*.jsonl` over the last 5 hours, using a local pricing table. |
| **Session Tokens** | Tails the most-recently-modified Claude Code session log and shows total input+output tokens. |

The Approve / Deny / slash-command keys work by sending macOS keystrokes to
**whatever app is in focus** via `osascript`. Bring your terminal running
`claude` to the front before pressing.

## Requirements

- macOS 12+
- [Stream Deck](https://www.elgato.com/streamdeck) software ≥ 6.5 (uses
  bundled Node 20)
- Node.js 20+ for building from source
- A Claude Code installation that has signed in at least once (the Usage tile
  reads the OAuth token from the macOS Keychain under the
  `Claude Code-credentials` service, the same place Claude Code itself stores
  it)

## Install from source

```bash
git clone https://github.com/songsense/claude-code-streamdeck.git
cd claude-code-streamdeck
npm install
npm run build
ln -s "$PWD/com.siming.claude-code.sdPlugin" \
  "$HOME/Library/Application Support/com.elgato.StreamDeck/Plugins/com.siming.claude-code.sdPlugin"
# Quit and reopen Stream Deck.app, or:
osascript -e 'tell application "Elgato Stream Deck" to quit'
open -a "Elgato Stream Deck"
```

The first time the Usage tile fires, macOS will prompt to allow Stream Deck to
read `Claude Code-credentials` from the Keychain. Click **Always Allow** — if
you click **Allow** once, you'll be re-prompted on every refresh.

## Development

```bash
npm run watch        # esbuild watch mode
npm run typecheck    # tsc --noEmit
npm run gen:icons    # regenerate placeholder PNGs
```

After a code change the Stream Deck app needs to relaunch the plugin process.
The fastest way is removing and re-adding any one of the plugin's keys on your
deck.

## Layout

```
src/
  plugin.ts                # entry — registers the 8 actions
  actions/
    approve.ts deny.ts
    compact.ts clear.ts slash-command.ts
    usage-5h.ts            # API-driven tile
    cost-window.ts session-tokens.ts   # local-log tiles
  lib/
    keystroke.ts           # osascript wrapper
    usage-api.ts           # Keychain + OAuth + 60 s cache
    usage-local.ts         # .jsonl scanner + pricing table
    render.ts              # SVG → data: URI key images
  ui/
    slash-command.html     # property inspector (uses sdpi-components)
scripts/
  gen-icons.mjs            # generates placeholder PNGs
com.siming.claude-code.sdPlugin/
  manifest.json            # action registrations
  bin/plugin.js            # (build output — gitignored)
  imgs/                    # (build output — gitignored)
```

## Customizing pricing

`src/lib/usage-local.ts` has a `PRICING` table for Opus / Sonnet / Haiku. The
numbers are approximate per-million-token USD rates — edit them to match your
plan or to add a new family.

## Privacy and data handling

- No data is sent anywhere except `api.anthropic.com/api/oauth/usage` (the
  same endpoint the official Claude Code statusline uses).
- The OAuth access token is read from your local Keychain at refresh time and
  is never written to disk or logged.
- The local cost / session tiles read `~/.claude/projects/**/*.jsonl` files
  only — the same files Claude Code already writes for itself.

## License

MIT
