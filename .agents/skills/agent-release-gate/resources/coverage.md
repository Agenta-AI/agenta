# Coverage: the cells and the journeys

The gate is the product of two lists: **cells** (the configurations under test) and **journeys**
(the user actions run against each cell). `qa_product.py` defines both; this file is the reference.

## Cells (harness × sandbox × auth)

The core axis is harness × sandbox. Provider and auth mode are a sub-matrix run inside the Pi cells
only, because that is an authentication question, not a sandbox one — re-running it in all four core
cells would test the same code twice.

| Cell | Harness | Sandbox | Model | Auth mode | Why this cell exists |
|---|---|---|---|---|---|
| C1 | `claude` | `local` | `sonnet` (alias) | subscription (OAuth) | Claude on the local sandbox; the default "use my subscription" path. A full model id gets dropped to the default on the Claude ACP path, so the gate pins the `sonnet` alias (finding F-007). |
| C2 | `claude` | `daytona` | `sonnet` | vault key | Claude in a cloud sandbox. Daytona rejects subscription auth by design, so this cell genuinely needs a funded Anthropic vault key. |
| C3 | `pi_core` | `local` | `gpt-5.6-luna` | vault key (OpenAI) | Pi on the local sandbox with a managed OpenAI key. |
| C4 | `pi_core` | `daytona` | `gpt-5.6-luna` | vault key (OpenAI) | Pi in a cloud sandbox; the remote-mount path that surfaced the silent file-loss finding (F-7). |
| P1 | `pi_core` | `local` | `openrouter/deepseek/deepseek-v4-flash` | vault key (OpenRouter) | OpenRouter as a first-class native provider. |
| S1 | `pi_core` | `local` | `gpt-5.6-luna` | subscription (Codex OAuth) | The ChatGPT/Codex subscription path via the sidecar, independent of any vault key. |
| P2 | `pi_core` | `local` | `deepseek/deepseek-v4-flash` | custom OpenAI-compatible provider | OpenRouter reached as a custom OpenAI-compatible endpoint — the path every self-hoster with a proxy or local vLLM uses, and the least-travelled one. Needs a `custom_provider` vault slug; pass `--custom-slug`. |

The pinned models and connection modes are the gate's **fixtures**: each is chosen for a reason
(alias vs full id on Claude, subscription vs vault where the sandbox forces it, a healthy provider
for the long-context probe). The inline comments in `qa_product.py` carry the specific reason per
cell — keep them in sync if a cell changes.

## Journeys (run in every applicable cell)

| Journey | What it does | Passes when |
|---|---|---|
| `chat` | Create an agent, send one message. | The turn completes with a `finish` frame, not an `error`. |
| `mount` | Write a file in turn 1, read it back in turn 2. | The file survives across turns — proof the durable mount is real, not a throwaway `/tmp` cwd. |
| `tool` | Call a tool whose return bakes in an unguessable token. | The token appears in the reply, so the tool provably ran (the model cannot guess it). |
| `approve` | Raise an approval, then approve it. | The approved tool call continues via the in-band approval protocol the browser uses. |
| `deny` | Raise an approval, then deny it. | The denied path is handled cleanly (no phantom failure, no re-parking forever). |
| `commit` | Save an agent config as a new workflow revision, then fetch it back. | The changed parameter survives the round trip and the version bumps (v0 seed → v1; see LESSONS #14). Harness-agnostic — it drives the config REST API, not a turn. |
| `warm` | Run three turns, watch latency and the runner log. | Turns 2-3 are faster and the log confirms the session was genuinely **loaded**, not silently cold. |
| `mcp` | Deliver an MCP server in the agent config and call one of its tools. | A `tool-output-available` frame fires for an `mcp__*` tool. **Claude only** — Pi rejects user MCP, so this `SKIP`s on every Pi cell. Uses the public DeepWiki server by default; override with `--mcp-url`. |

Triggers are deliberately **out of scope** for this gate.

## Optional probes (`qa_longctx.py`)

Separate from the gate, these need live **Gmail and GitHub Composio connections** in the target
project. Skip them if the project has none.

| Probe | What it catches |
|---|---|
| `memory` | Plant a token, flood the context with bulky tool output across many turns, then ask for the token back. Catches compaction dropping early context. |
| `gmail` | The Gmail/GitHub gateway tools resolve and actually execute. Read-only actions only — writes (SEND/REPLY/CREATE/…) are filtered before they reach an agent. |
| `concurrent` | N sessions run at once, each holding a different token. Catches cross-session bleed a single-session test can never see. |
