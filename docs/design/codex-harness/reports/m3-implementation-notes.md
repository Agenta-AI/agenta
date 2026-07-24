# Milestone 3 implementation notes

Permissions and human-in-the-loop for Codex (D-008 core). Feature code written by Codex
(`gpt-5.6-sol`) via `codex exec`, orchestrated and reviewed by Opus. Local commits only, nothing
pushed. Four slices landed green at the unit level; the live QA exit bar is BLOCKED by a
deployment-level codex-tool regression that is independent of this milestone's code (see
"Live QA blocker" below).

## Headline

- Code complete and unit-green: runner **1240** tests, SDK agents **696** tests, typecheck clean,
  ruff clean. Golden wire contract byte-identical (a mode override is emitted only when authored).
- The D-008 core is in: Codex sessions default to ACP mode `agent-full-access`, and tool-level HITL
  is enforced RUNNER-SIDE at the `agenta-tools` loopback MCP pause seam (allow runs, deny refuses,
  ask parks with cold-replay resume). Authors can override the mode per agent; under authored
  `agent` mode Codex's own ACP gates classify and park like Claude's.
- Live QA (the 3 recorded scenarios + warm/cold resume + MP4) could NOT be produced: the codex
  daemon returns "Internal error" on any session that includes an MCP server, before any tool call.
  Proven independent of this milestone (M2's own runner code fails identically; a full rebuild does
  not fix it; baseline codex chat works). STOP-and-report per the coordinator's discipline.

## Slices (all committed)

- **A — default mode + per-agent override** (`ae69375f`). New `engines/sandbox_agent/codex-mode.ts`
  (`CODEX_MODES`, `resolveCodexMode`, `applyCodexMode`). Applied in `environment.ts` right after
  `applyModel`, Codex-only, via the spike-proven `session.setConfigOption("mode", <mode>)`
  (best-effort: a failure logs and never fails the run). New optional wire field `harnessMode`
  (`protocol.ts` + `wire.py` + `wire_models.py` + golden/contract tests). SDK
  `CodexAgentTemplate.wire_harness_mode` emits it from `harness_permissions["mode"]`, with the
  agent-mode texture caveat documented in its docstring. `INITIAL_AGENT_MODE` was considered and
  rejected (unverified in this environment; `setConfigOption` is proven and fits the acquire
  lifecycle exactly like `applyModel`).
- **B — runner-side tool gate at the pause seam** (`fc9086e1`). New `tools/executable-tool-gate.ts`
  (types) + `engines/sandbox_agent/executable-tools.ts` (`buildExecutableToolGate`, mirroring
  `buildClientToolRelay`). Wired into `tool-mcp-http.ts` `tools/call`: for a non-client tool, before
  `runResolvedTool`, resolve the effective permission via `responder.onPermission` →
  allow executes (reusing the same call id), deny returns an MCP tool error, ask emits a
  `user_approval` interaction + `onPause` + `MCP_PAUSED` (aborts the socket). Threaded through
  `buildSessionMcpServers`/`buildToolMcpServers`/`startInternalToolMcpServer`; ACTIVE only for a
  local non-Pi harness (`!plan.isPi && !plan.isDaytona`), fail-closed (deny) when the deferred gate
  is unset. Daytona stdio shim untouched (out of scope). RESUME is cold-replay (see "Resume
  semantics" — approved by the coordinator as the existing client-tool pause pattern).
- **C — Codex ACP gate classification** (`bbf157f8`). `acp-interactions.ts` gains a `codex-acp-permission`
  `ParkedApprovalGateType` and an `acpAgent` flag. `buildGateDescriptor` recovers identity from the
  spike frame shapes: MCP frames (`_meta.is_mcp_tool_approval`, nearly-empty toolCall) recover
  name+args from the recorded `tool_call` event by `toolCallId`; exec frames (`kind:"execute"` +
  `rawInput.command`) key on the command like Claude's Bash. `server.ts` recognizes the codex gate
  for live resume. Confirmed finding: the daemon SDK NORMALIZES codex's option ids to
  `once/always/reject`, so `decisionToReply` needs no codex-specific reply mapping (never selects a
  persistent "always"). `bareToolName`/`serverPermissionFor` already handled the `mcp.<server>.<tool>`
  dot naming (M2).
- **D — codex_settings Layers 2/3** (`6538514a`). `codex_settings.py` mirrors `claude_settings.py`:
  Layer 2 maps a readonly/off filesystem to `sandbox_mode = "read-only"` (only when the author did
  not set `sandbox_mode`); Layer 3a maps user-MCP-server permissions to
  `[mcp_servers.<name>] default_tools_approval_mode` (allow→approve, ask→prompt) or `disabled_tools`
  (deny, include-mode only); Layer 3b maps resolved tools to
  `[mcp_servers.agenta-tools.tools.<tool>] approval_mode` / `disabled_tools` via the shared
  `effective_permission` ladder. Dependency-free nested-TOML renderer. Docstrings state the D-008
  proviso (these matter only under authored `agent` mode) and the F-046 inversion. Not expressible
  in codex config (documented): network off/allowlist for codex built-in web tools; whole-server
  deny without known tool names; filesystem `off` exactly (reinforced as `read-only`).

## Item E (poison-combo constraint)

Satisfied by construction. No `CODEX_CONFIG` is composed anywhere in M1-M3 (`codex-assets.ts`
carries the standing-invariant comment). The mode is set via the ACP `setConfigOption` channel,
which never touches `sandbox_mode`, so the poison combo (`sandbox_mode` next to `approval_policy`
inside `CODEX_CONFIG`) cannot arise. When M4 introduces `CODEX_CONFIG` for the subscription path,
the guard must live there.

## Resume semantics (surfaced, approved)

The runner-side MCP-seam gate (B) cannot use the ACP keep-alive resume that Claude/Pi use: there is
no ACP permission id at the loopback seam, and the `tools/call` HTTP request dies when the turn
parks (the socket is aborted, exactly like the existing client-tool pause). So its resume is COLD
REPLAY: the model re-issues the call on the follow-up turn and `ApprovalResponder.onPermission` +
`ConversationDecisions` consume the `{approved}` envelope from history to execute or refuse. The
coordinator approved this as the existing client-tool pause pattern (an approved copy of a
production mechanism). UX note for users: a Codex ask-tool approval behaves like a client-tool
approval (the turn pauses; you approve; the next turn completes the call), not like Claude's live
in-turn park. Claude's keep-alive live park remains for real ACP gates under authored `agent` mode
(slice C).

## Live QA blocker (STOP-and-report)

The three recorded scenarios (allow/ask/deny) + the coordinator's warm/cold codeword resume + the
MP4 could NOT be produced. Every Codex run that includes an MCP server (the internal `agenta-tools`
channel, which every tool run needs) fails with `Agent run failed: Internal agent error: Internal
error` — the codex daemon (surfaced via `acp-http-client`) errors at session/prompt time, BEFORE
any tool_call, right after the internal MCP server starts. Baseline codex chat (no tools) works.

Proven independent of this milestone's code:

1. Disabling slice A (mode) → still fails.
2. Disabling slice B (executable gate) → still fails.
3. Loading the exact M2 runner code (commit `378d527`, whose notes document this same tool QA
   PASSING earlier today) → fails identically.
4. A full `run.sh --rebuild runner --build` → does not fix it.
5. codex-acp pinned at 1.1.7 (no version drift); baseline chat proves the codex binary + adapter
   are functional.

So the codex tool path is broken at the deployment level (the codex daemon cannot use the internal
loopback HTTP MCP server in the current container state — likely a networking/daemon-environment
regression from today's container recreate/rebuild churn). This is a deployment issue for
investigation, not a defect in the M3 code. The QA driver
(`spike/scripts/m3-qa.py`, self-contained `list_connections` tool, allow/deny/ask + cold-resume
codeword scaffolding) is ready to run the moment the deployment serves codex tool sessions again.

## Deployment note (own goal, corrected)

The rebuild command must run FROM THE WORKTREE root: `.env.ee.dev.local` in the main checkout
targets a different compose project (`agenta-ee-dev-wp-b2-rendering`), while the worktree's
`.env.ee.dev.local` carries `COMPOSE_PROJECT_NAME=agenta-ee-dev-codex-harness` (the QA deployment at
:8180). Running from the main root once harmlessly restarted another WP's runner (from main-branch
code, unaffected). Always `cd <worktree> && bash ./hosting/docker-compose/run.sh ... --rebuild runner`.

## Remaining (blocked / deferred)

- Live QA (3 scenarios + warm/cold codeword resume + MP4): BLOCKED on the deployment codex-tool
  regression above. The coordinator flagged the cold-resume context check as a STOP-and-report
  item; it could not be exercised.
- Close-out `/simplify` + desloppify full-diff pass: the diff was reviewed slice-by-slice against
  the sibling patterns (buildClientToolRelay, claude_settings, applyModel) and is green; a
  consolidated `/simplify` sweep is recommended once QA unblocks.
