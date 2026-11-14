# Dubhe Agent features and settings guide

## Pages
- `index.html` is the landing page redesigned by six design rules (typography, physics motion, restrained color, linear icons, broken grid, obsessive craft); the rules live in the system prompt, not on the page.
- `app.html` is the chat workspace; `docs.html` holds docs and price tables. A first-visit dialog asks for a display name (preset or custom), stored locally only.

## Models and gateways
- Settings → Gateway: TeamoRouter (default), Anthropic, OpenAI, Gemini, DeepSeek, GLM, Grok, Kimi, Doubao, Qwen, Cloudflare Workers AI, custom. Each gateway keeps its own API key, model list and base URL.
- The model picker uses only Popular / Cheap badges. Cloudflare Workers AI is unpriced in-app; billing is set by the Cloudflare account.
- Image families: GPT Image 2 / 2.5 / 2.6, Nano Banana, Midjourney, Cloudflare FLUX (only on the Cloudflare gateway). Midjourney returns a 2×2 grid which the app splits into four images.
- Vision / video / audio models are chosen separately; their tags describe positioning (Cheap / General / High accuracy / Docs), not capability rankings.

## Tuner (standalone page)
- Temperature presets; Agent mode (all tools + system prompts) or Chat mode.
- **Chat mode is a pure model conversation**: no system/task/prompt text, no tool-capability declaration, no tool table; only user/assistant history is sent. The toolbar hides Sandbox, Web, Fast, Project and Panel; the thinking button becomes Thinking on/off; text-only attachments are parsed into the message body.
- Personal system prompt is an independent supplementary layer and is not sent in Chat mode.
- Self-registered tool approvals appear as confirmation cards in the chat output; management lives in Settings → Tool capabilities.

## Settings
- Tool capabilities: live tool table plus self-registered tools (read full definition, enable/disable, two-step delete). Code handlers require a static security review before user confirmation.
- Moderation: disabling it skips local review for both chat and project-mode imports; upstream policies still apply.
- Offline local model: GGUF in browser OPFS, context 8192 with automatic history trimming.
- Optional gateway access token: localStorage only, never exported; Workers AI gateway supports `GATEWAY_TOKEN` and `ALLOWED_ORIGINS`.

## Tools and deliverables
- File tools operate on the session virtual filesystem; `internal/` and `uploads/` always persist. `write_file` can write `internal/`; only the execute_javascript / execute_python write-back channel forbids `internal/` and `.git/`.
- `set_final_report` marks a non-internal workspace file as the deliverable; the sandbox panel opens it at turn end.
- `:::choice` single-select, `:::choice multi Title` multi-select; `:::chart`, `:::flow`, `:::mind`, Mermaid and DOT render structured diagrams.
- `::flag[us]::` renders flags; copying restores Unicode emoji or uses `[flag]` for PUA-only designs.

## Design rules (default when generating UI)
Typography first → physics motion → restrained color → linear icons → broken-but-measured grid → obsessive 1px craft. Aim for an authored work, never a template.
