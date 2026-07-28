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
| `records` | Force a tool call, then poll `POST /sessions/records/query` (ingestion is async, worker-drained off Redis). | Record types cover a user message, an assistant message, a `tool_call`, and a `tool_result`; `timestamp` is non-decreasing in returned order; the unguessable bash token appears inside a `tool_result` body; no record is the bare `{"_truncated": true}` legacy drop-in. Harness-agnostic, like `commit`. |
| `sessions` | REST lifecycle over `/api/sessions/*`: create (one cheap turn), list, archive, unarchive, rename (`PUT /sessions/streams/header`), delete. | Each step's effect on `POST /sessions/query` is exactly right: archived hides by default and shows with `include_archived`; unarchive restores it; rename shows in the next query; delete is a real hard delete — gone even with every include flag on. Harness-agnostic, like `commit`; cleans up on every path. |
| `followup` | After an approved resume settles, send ONE more normal user turn on the same session forcing a second tool call. | The followup gets a fresh wire `toolCallId` (never the gated call's) and its own durable `tool_call` record — no `record_id` is shared between the two calls. Probes an open defect prediction (2026-07-24 review: a fresh post-approval turn could silently collide/overwrite the approved call's record) that was never exercised before; live-verified clean in both full-history and `--last-message-only` modes on 2026-07-28. |

**`--last-message-only`** (a global flag, not a journey): mirrors the frontend's minimal-send switch
(`NEXT_PUBLIC_SESSIONS_LAST_MESSAGE_ONLY` / `agentRequest.ts:401-415`) — a fresh user turn sends
only its trailing message instead of full history, while an approval resume still sends full
history, exactly like the browser. Every turn's exact `sent_messages` lands in `results.json` so a
full-history run and a `--last-message-only` run against the same stack can be diffed offline.

Triggers are deliberately **out of scope** for this gate.

## Not covered (sessions rework, as of 2026-07-28)

These feature areas shipped in `feat/sessions-storage-rework` and have no journey in
`qa_product.py` yet. Listed here so the gap is explicit rather than assumed away — flip a row to
covered once a journey lands, do not delete it silently.

| Feature | Status | Note |
|---|---|---|
| Durable-records readback | covered | `records` journey (J8): polls `POST /sessions/records/query`, asserts type coverage, timestamp order, real tool-result content, and no bare-truncated bodies. |
| Last-message-only client mode | covered | `--last-message-only` global flag mirrors `NEXT_PUBLIC_SESSIONS_LAST_MESSAGE_ONLY`'s minimal-send condition and dumps each turn's exact `sent_messages` for an offline diff against a full-history run. |
| Sessions REST surface (query/archive/rename/delete/revive) | covered | `sessions` journey (J9): create → query → archive → unarchive → rename → delete, asserting each state transition's effect on `POST /sessions/query`. |
| Cold-replay approval resume | not covered | The paused-turn + resume transcript fold is UI-side; no wire-level journey exercises it. |
| Batch approvals | not covered | Approve-all/Deny-all with context peek is UI-side; the `approve`/`deny` journeys are single-gate only. |
| Warm Stop | not covered | Cooperative cancel that leaves the session resumable (sandbox destroyed) — no journey. |
| Steer | not covered | Deny + redirect, behind `NEXT_PUBLIC_AGENT_CHAT_STEER` — no journey. |

See `docs/design/agent-workflows/projects/qa/release-2026-07-sessions-storage-rework.md` for the
full flag-gated risk list this table is a slice of.

## Optional probes (`qa_longctx.py`)

Separate from the gate, these need live **Gmail and GitHub Composio connections** in the target
project. Skip them if the project has none.

| Probe | What it catches |
|---|---|
| `memory` | Plant a token, flood the context with bulky tool output across many turns, then ask for the token back. Catches compaction dropping early context. |
| `gmail` | The Gmail/GitHub gateway tools resolve and actually execute. Read-only actions only — writes (SEND/REPLY/CREATE/…) are filtered before they reach an agent. |
| `concurrent` | N sessions run at once, each holding a different token. Catches cross-session bleed a single-session test can never see. |
