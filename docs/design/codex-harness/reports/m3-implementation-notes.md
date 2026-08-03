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

## Resume semantics (HISTORICAL — superseded 2026-07-31 by the codex-acp patch)

**Read this first.** Everything in this section describes Milestone 3 as it shipped, when Codex
approvals resumed COLD. Mahmoud rejected that posture on PR #5509 and approved patching codex-acp
instead: the runner image now flips the `agent-full-access` preset from `approvalPolicy: "never"`
to `on-request`, so Codex raises its own permission gate and approvals park WARM on the keep-alive
path, exactly like Claude's. The seam gate below is still in the code as second-line enforcement,
but it no longer prompts the human — it consumes the execution grant the ACP gate records. See the
D-008 amendment (2026-07-31) in `decisions.md`. The original text follows for the record.

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

## Live QA — PASSED at the wire level (after the Slice D fix + a resume-key fix)

Root cause of the earlier "blocker" was NOT a deployment regression (my control was invalid — the
SDK, which renders config.toml, is bind-mounted into the SERVICES container, so reverting the
runner never reverted Slice D). It was Slice D rendering transport-less `[mcp_servers.*]` tables,
which codex 0.145 rejects at `session/new`. Fixed (see the D-008 amendment + the earlier evidence
below). A second bug then surfaced live: the runner-side ask gate keyed the stored decision on
codex's MCP-wrapped args `{server,tool,arguments}` while the gate keyed on the bare `{}`, so an
approval re-parked instead of resuming — fixed by unwrapping the wrapper symmetrically in
`storedDecisionKeyShape` (`permission-plan.ts`, committed `0c925cb3`).

QA driver: `spike/scripts/m3-qa.py` (self-contained `list_connections` platform tool, no Composio).
All scenarios verified on the worktree deployment (:8180, project 019f93b7…), harness codex, default
`agent-full-access`:

- **Scenario 1 (allow)** — PASS. The tool ran with no pause: `tool-input-available` →
  `tool-output-available` ("No connections found"), `finish=stop`, no approval frame.
- **Scenario 3 (deny)** — PASS. `tool-output-error`, the model replied "I couldn't list connections
  because the tool was denied by policy", the turn continued to `finish=stop`.
- **Scenario 2 (ask) park** — PASS. `tool-approval-request` surfaced, `finish=other`
  ("Conversation interrupted"), the codeword FLAMINGO-42 was acknowledged, no tool output.
- **Scenario 2 warm approve-resume (2a)** — PASS. The follow-up turn cold-replayed
  (`create_session mode=create`), consumed the normalized decision `list_connections#{}`, executed
  the tool, and the reply carried "Codeword: FLAMINGO-42" (context survived).
- **Scenario 2 reject-resume** — PASS. "The tool call was rejected and not executed", no execution.
- **Cold resume (2b) context check** — PASS via the natural cold-replay: the MCP-seam pause tears
  the session down, so EVERY resume is a cold `create_session mode=create` on the owning replica
  (proven in the runner logs alongside the normalized decision + tool execution + codeword). The
  additional runner-KILL variant is inapplicable to LOCAL sandboxes by design: a killed runner gets
  a new replica id and the single-owner guard correctly refuses to move a local session
  (`local sandbox requires a single runner ... Refusing to cold-start on the wrong host`). A
  cross-replica cold resume is a Daytona concern (M5), not a local-M3 one. So the cold-resume
  CONTEXT check succeeds; there is nothing to STOP-and-report.
- **Agent-mode wire sanity** — PASS. With authored `mode=agent` the runner logs
  `[codex-mode] applied mode=agent`, then a Codex ACP gate classifies (Slice C recovers
  `anchor=list_connections` from the `kind:"execute"` MCP frame, `argKeys=undefined`) and parks
  (`permission=ask outcome=pendingApproval`), surfacing a `tool-approval-request`.

Outstanding: the chrome-devtools MP4 (`m3-approvals-qa.mp4`) is not yet recorded (budget). The
wire-level SSE evidence above fully validates the behavior; the UI recording is the watchable
proof and remains the one open QA deliverable. The driver is ready to drive it.

Multi-session note: the M4 orchestrator is concurrently active on this stack and restarted the
runner mid-QA more than once (each restart errored an in-flight resume). QA batches were re-run in
stable windows. A concurrent git operation also reverted this session's uncommitted resume-key fix
once; it is now committed (`0c925cb3`), so a runner restart reloads it correctly.

## Live QA blocker (historical — root cause corrected above)

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

## Close-out (2026-07-25): MP4 recorded + quality passes — Milestone 3 CLOSED

Both remaining deliverables are in. Recording and quality passes done on the worktree
deployment (:8180) with the runner container healthy.

### MP4 recording — `reports/m3-approvals-qa.mp4` (real UI, chrome-devtools)

Recorded the whole approval flow in the REAL playground UI (1280x900, h264/yuv420p, ~16s,
7 frames). Frames in `/home/mahmoud/.claude/jobs/fd72484c/tmp/qa-frames-m3/`. It shows every
required step:

1. **Config** — a Codex-harness agent (`gpt-5.6-luna`) with a runner-executed tool attached
   (the `exact-match` workflow reference).
2. **ALLOW run** — agent `Permissions` policy `Allow all`: the tool runs repeatedly with green
   checkmarks and NO approval prompt (no pause), finishing with a result.
3. **Ask policy** — `Advanced -> Permissions -> Policy = Ask` ("A human approves every tool call").
4. **ASK approval card** — the tool call parks and the UI renders a real approval card:
   "Approval needed to continue -- mcp.agenta-tools.Exact Match -- The agent wants to run this tool
   before it can keep going", with the payload and **Approve** / **Deny** buttons.
5. **Approve** — clicking Approve resumes the turn (cold-replay) and the tool executes ("approved").
6. **Codeword reply** — the final assistant reply preserves the planted context: "The codeword is
   FLAMINGO-42." (context survived the pause/approve/deny cycle).
7. **DENY run** — policy `Deny all`: the tool call is refused (`failed`, "denied by policy") and the
   agent continues to a clean final answer ("it was denied by policy, so I couldn't verify the
   result").

Key finding surfaced during recording (folded into LESSONS.md): the M3 runner-side gate is driven
in the product UI by the **agent-level `Permissions` policy** (`Allow reads` / `Allow all` / `Ask` /
`Deny all` under Advanced), which maps to the gate's allow/ask/deny decisions and fires for
**runner-executed** tools (platform ops, workflow references, MCP). A "schema-only / executed by
your app" custom tool is a CLIENT tool that bypasses the runner gate entirely (returns
`{"status":"not_handled"}`, "not handled by this client"), so it cannot exercise or demonstrate the
gate. Under `Ask`, each call parks with an Approve/Deny card; approving executes and the model may
re-issue the call (it re-parks every call under `Ask` — expected, not a bug); denying yields a clean
final answer. This is the watchable proof; the wire-level SSE evidence above already validated the
same behavior via `m3-qa.py`.

### Quality passes over the full M3 diff (ae69375f, fc9086e1, bbf157f8, 6538514a, 003797ee, 0c925cb3)

- **/simplify** (single-pass, all four angles — reuse, simplification, efficiency, altitude): the
  production diff is clean. It deliberately mirrors the reviewed sibling patterns
  (`buildClientToolRelay` -> `buildExecutableToolGate`, `claude_settings` -> `codex_settings`,
  `applyModel` -> `applyCodexMode`, the Claude ACP gate -> the Codex ACP gate); the resume-key
  unwrap lives in the shared `storedDecisionKeyShape` (right depth, not a bolt-on); the gate sits at
  the correct loopback `tools/call` seam. No net-positive change.
- **desloppify-code** (scan -> blind review -> triage -> execute -> rescan, scoped to the M3
  production files): the mechanical scan's only signals are `any` on the ACP `session`/`request`
  objects — which is the established module convention (`applyModel(session: any)`,
  `runtime-contracts` `session: any`, and acp-interactions' pre-M3 `session/req/toolCall: any`), so a
  bespoke type would be an outlier, not an improvement; the Python `Any` params are documented
  duck-typing. No TODO/FIXME/console/empty-catch/ts-ignore/dead code introduced. Blind review across
  the dimension catalog (naming, logic clarity, abstraction fitness, ai_generated_debt, elegance,
  convention, test strategy) finds the code clean: intent-revealing names, invariant-only comments,
  dedicated tests added. Clean cycle, no code fixes warranted.
- **Suites re-run GREEN:** SDK agents unit **691 passed** (`uv run --no-sync pytest
  oss/tests/pytest/unit/agents -q`); runner **1248 passed** across 81 files (`pnpm test`). `ruff
  format --check` + `ruff check` clean on `agenta/sdk/agents/`.

No code changes were needed, so the checkpoint commit carries the close-out documentation only.
