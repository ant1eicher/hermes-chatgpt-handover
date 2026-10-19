# ChatGPT Handover for Hermes

Browse your ChatGPT conversations inside Hermes Desktop, pick one (or some of its messages),
preview a faithful Markdown export, and continue it in a new Hermes chat.

- `desktop/plugin.js` — the Desktop page (`/chatgpt`), sidebar row, ⌘K command, status-bar chip.
- `dashboard/` — backend routes at `/api/plugins/chatgpt-handover/*` (FastAPI, stdlib-only core).
- `plugin.yaml` + `__init__.py` — agent manifest; registers no tools or hooks.

The plugin only **reads** a local store (`$HERMES_HOME/chatgpt-handover/`, override with
`CHATGPT_HANDOVER_DIR`). Filling that store is a separate collector that is not part of this
repo. It uses chatgpt.com's undocumented web endpoints, because OpenAI offers no supported
API for consumer ChatGPT history. Expect breakage when that web app changes.

The handover never auto-sends: it prefills the composer with an `@file:` reference to the saved
export, and you press Send.

## Install

Hermes Desktop → Capabilities → Plugins → Install from Git →
`https://github.com/ant1eicher/hermes-chatgpt-handover`

Install the agent half on the machine running the Hermes backend, then
`hermes plugins enable chatgpt-handover`.
