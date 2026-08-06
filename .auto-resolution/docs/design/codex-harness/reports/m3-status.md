# Milestone 3 working status (permissions + HITL for Codex)

Orchestrator: Opus. Implementation engine: Codex (`gpt-5.6-sol`). Local commits only, never pushed.

## Governing facts (from D-008 + spike)

- Default ACP mode = `agent-full-access`; Codex raises NO gate under it. Our ONLY HITL gate is
  the runner-side `agenta-tools` pause seam. F-046 inverts for Codex under full access: allow
  rules do NOT exist to bypass a harness gate (there is none) — the runner seam is the gate.
- Mode mechanism proven: `session.setConfigOption("mode", "agent-full-access")` (spike P1/P2
  e-round). `session.setMode(modeId)` is the ACP-standard sibling and exists in the sandbox-agent
  SDK (`index.d.ts:3064`). Both fit the same post-`createSession` lifecycle as `applyModel`
  (`environment.ts:1078`). `INITIAL_AGENT_MODE` is an unverified daemon-env alternative — NOT used.
- HARD CONSTRAINT: never emit `sandbox_mode` inside CODEX_CONFIG (poison combo). The mode is set
  via the ACP session option, not CODEX_CONFIG, so the constraint is not tripped here.

## Slices

- A. Default mode wiring + per-agent override (`agent`/`read-only`/`agent-full-access`). COVERED
  by D-008. FOUNDATIONAL — building first.
- B. Runner-side executable-tool gate at the loopback `agenta-tools` MCP seam
  (`tool-mcp-http.ts`): allow→execute, deny→tool_result error, ask→park. THE D-008 CORE.
- C. Codex ACP gate classification branch in `acp-interactions.ts` (authored `agent` mode only).
- D. `codex_settings.py` Layers 2/3 (author `agent` mode only) — clean mirror of `claude_settings.py`.
- E. Poison-combo guard where the mode/CODEX_CONFIG is composed.

## Surfaced finding (resume semantics) — see report

The brief frames B's park as "the existing parked-approval architecture (ParkedApproval surfaced,
resume executes/refuses)". The existing `ParkedApproval` is KEEP-ALIVE and ACP-gate-specific: it
answers an ACP permission id via `session.respondPermission`. The loopback MCP seam has NO ACP
permission id, and its `tools/call` is a synchronous HTTP request that dies when the turn parks
(the socket is aborted, exactly like the existing client-tool pause). So B's resume is necessarily
COLD-REPLAY (model re-issues the call next turn; `ApprovalResponder.onPermission` + the existing
`ConversationDecisions` consume the `{approved}` envelope from history → execute or refuse),
identical to the client-tool pause pattern (`tool-mcp-http.ts` MCP_PAUSED). This is a technical
constraint, not a menu choice; recorded so the "keep-alive" framing is not silently reinterpreted.

## Decision needed (mode-override wire shape)

The `agent-full-access` DEFAULT needs no wire field (runner applies it for every Codex run). The
per-agent OVERRIDE must reach the runner (config.toml can't carry an ACP session mode). Chosen: a
dedicated optional wire field `harnessMode` on the /run request (mirrors `model`; explicit;
reversible; follows the protocol.ts+wire.py+golden discipline). Alternative: a generic
`harnessOptions` blob. Recorded per no-implicit-decisions.
