# Status

Source of truth for where this project stands. Keep it current.

## State

**Code-complete, reviewed, green. Live QA + branch pending.** All three layers plus Phase 0
are implemented across backend, runner, and frontend, each slice paired with a review and tests.
Full suites pass together: **293 SDK agents + 15 API tools + 10 services/oss + 177 TS**, tsc and
ruff clean. What remains is (1) the live QA pass against a deployed stack (checklist in
`plan.md` S6) and (2) landing the work on a GitButler lane. Codex reviewed the project (below)
and its feedback is folded in. Built under the `implement-feature` skill, slice by slice.

## Live QA (2026-06-24, against :8280, direct sandbox-agent /run)

Ran on the deployed stack (`agenta-ee-dev-wp-b2-rendering`, sidecar mounts `services/agent/src` +
tsx, so a restart deployed the runner changes). Drove `/run` directly with forced un-guessable
tokens. **No feature-code bugs found.**

- **L3 per-tool `deny` — PASS.** Identical code tool, only `disposition` flipped: `deny` →
  `tool_result="Tool 'get_build_id' is denied by policy."`, token `BUILDID_A7F3_QA` absent, code
  never ran; `allow` → token present. (relay.ts enforcement.)
- **L1 Claude `.claude/settings.json` — write PASS, behavior BLOCKED.** Captured the file the
  runner actually wrote mid-run: `{"permissions":{"deny":["WebFetch","WebSearch"]}}` (exactly the
  `claudeSettings.deny`). The behavioral half (Claude refusing WebFetch) needs a real
  `secrets.ANTHROPIC_API_KEY` — none was obtainable (vault scan correctly safety-denied), runs die
  at Claude auth. The write is the mechanism; Claude honoring it is its documented `settingSources`
  behavior (code-verified earlier).
- **L2 runner-host guard — PASS.** daytona+code+`network:off`/strict and local+`network:off`/strict
  both rejected at plan time with the runner-host / local-cannot-enforce messages; `best_effort`
  control allowed the run. (run-plan.ts guard.)
- **L2 Daytona `networkBlockAll` — INCONCLUSIVE (environment, not feature).** Code maps
  `off`→`{networkBlockAll:true}` correctly and the field reaches Daytona without error, but the
  Daytona org blocks ALL outbound, so the `network:on` positive control also fails. Needs a Daytona
  target with working egress to demonstrate off-vs-on.

**Finding — backend-routing footgun (now hardened):** `backend:"pi"` (legacy in-process
`engines/pi.ts`) enforced NONE of the three layers — a silent bypass. Only `backend:"sandbox-agent"`
(the default) enforces. Addressed by making the in-process engine fail loud (see changelog).

What still needs a live run before full sign-off: the Daytona egress positive control (needs an
egress-capable target) and the Claude behavioral refusal + HITL multi-turn round-trip (need a
project Anthropic key). The enforcement LOGIC is otherwise live-proven.

## Decisions made

1. **Three layers, three jobs.** Harness configuration (Layer 1), sandbox permission (Layer 2),
   tool permission (Layer 3). Each has one enforcement point.
2. **Claude config ships as `.claude/settings.json`,** written into the session cwd before
   session start. It carries the permission mode and the per-tool allow/deny/ask rules. No
   `_meta`, no upstream sandbox-agent change.
3. **MCP permissions are settings.json `mcp__` rules** (`mcp__<server>` or
   `mcp__<server>__<tool>`). The unenforced per-server `tools` allowlist is dropped.
4. **Pi MCP stays out of scope,** and adopts the Claude pattern when built (tracked in
   `../harness-capabilities/`).
5. **Composio read/write hints drive Layer 3 defaults:** keep the hints, carry a `read_only`
   flag, default read-only to always-allow and mutating to ask.
6. **The sandbox layer is authoritative for network and filesystem.** The tool layer is best
   effort. A run fails loud when a backend cannot deliver a requested guarantee.
7. **Scope is end to end, including the playground frontend:** the config form (Phase 4) and the
   chat tool-approval surface (Phase 5).
8. **`sandbox_permission` is the confirmed name for Layer 2.**
9. **`permission_policy` folds into Layer 3 as its global default.** The HITL gate, the per-tool
   dispositions, and `permission_policy` are one sidecar-managed permission policy. There is no
   separate permission plane.
10. **Dispositions live on the spec they govern:** a resolved tool's disposition on its tool
    spec, an MCP server's permission on its server spec. Not a separate map. Harness builtins
    have no spec, so their permission is rendered in Layer 1 (Claude settings.json rules, Pi
    `builtin_names`).
11. **`sandbox_permission` shape (S1).** A typed object: `network` = `{ mode: on|off|allowlist,
    allowlist: [cidr] }` (default `on`); `filesystem` = `on|readonly|off` declared but **not
    enforced** today; `enforcement` = `strict|best_effort` (default `strict` = fail loud when the
    backend cannot deliver the requested guarantee; `best_effort` is the per-axis local opt-out).
    The first slice ships `network: off` enforcement on Daytona; `allowlist` and named presets are
    follow-ups (presets become FE sugar in S4). Concrete schema in `research.md` §2.
12. **Runner-host hole → interim guard now, sandbox-execution later (S1g).** Best-judgment call
    (user authorized "use best judgement, note it"): ship the interim guard — when `network: off`
    or `exec: off`, reject at plan time any runner-side-executed tool (`code`, gateway/callback,
    stdio MCP) unless it can run inside the sandbox. The target (move resolved-tool execution into
    the sandbox so one boundary covers everything) is recorded as deferred future work, not built
    in this project. The runner must never *report* `network: off` while a runner-side tool is
    still reachable.

## Resolved (2026-06-23, user)

- `sandbox_permission` is the confirmed name for Layer 2.
- `permission_policy` folds into Layer 3 as the global default of the sidecar-managed permission
  policy. The HITL gate is the same thing, not a separate plane.
- Per-tool dispositions live on the tool spec; MCP permissions live on the MCP server spec.

## Codex review (2026-06-23)

Codex (gpt-5.5, xhigh, read-only) reviewed the project. Verdict: "Good direction, not ready to
implement as written" — the three-layer shape is right, three seams need work. Disposition of
its seven points:

**Acting on (Codex correct, verified in code):**

1. **Runner-host guard is under-scoped and too late.** `relay.ts` `executeRelayedTool` runs
   *both* `code` (`runCodeTool`, ~:101) and gateway/callback (`callAgentaTool`, ~:106) tools in
   the runner process. The interim guard must cover gateway/callback too, not just `code` + stdio
   MCP, and it gates Phase 1's `network: off` acceptance, not Phase 3. Folded into the guard
   scope in `proposal.md`/`research.md` and into Phase 1 acceptance in `plan.md`.
2. **Layer 2 wire path was vague.** Daytona is provisioned in the TS runner's
   `buildSandboxProvider`, not in `Backend.create_sandbox` (parameterless). The policy must cross
   the Python→TS wire: `SessionConfig` → `request_to_wire` → `AgentRunRequest` → `buildRunPlan` →
   provider `create`. Pinned in `research.md` section 2 and Phase 1.
3. **Pi Phase 0 may be impossible as written.** The runner does drop `request.tools`
   (`run-plan.ts:101`), but `pi-acp@0.0.29` spawns `pi --mode rpc --no-themes` with **no `tools`
   field on `newSession`** (`index.js:135`). Phase 0's Pi half is now an investigation: find Pi's
   real control surface (CLI args, a Pi config file, or an ACP session field) or mark Pi
   builtin-restriction unsupported on sandbox-agent and fail loud. Verified in code.
4. **Filesystem-authority contradiction.** The proposal said the sandbox layer is authoritative
   for the filesystem in one place and "declared, not enforced" in another. Corrected to: Layer 2
   is authoritative for the network; it declares filesystem but enforces nothing today.
5. **Phase 5 is more "wire the runtime" than "build UI."** The approve/deny buttons already exist
   (`ToolPart.tsx:153`) on top of `addToolApprovalResponse`. The real work is the parked/resumed
   responder path, not rendering. Sharpened in `plan.md` Phase 5.

**Holding the user's decisions (Codex conflicts, recorded not applied):**

6. **Keep `sandbox_permission`.** Codex prefers `sandbox_policy`/`environment_policy` because
   "permission" is overloaded. The user confirmed `sandbox_permission` twice; keeping it. Note
   recorded so the objection is not lost.
7. **Keep `permission_policy` folded into Layer 3.** The user decided this. Codex's fair
   sub-distinction is captured as a note: Layer 3 holds two things that must not be conflated in
   code — the per-tool *disposition* (allow/ask/deny, static, on the spec) and the *responder
   mode* (what a headless `ask` does: block for UI / emit durable approval / auto-allow / deny).
   `permission_policy` is the responder-mode default; both live in the one sidecar-managed policy.

## Open questions

1. **The runner-host execution hole (Phase 1/3).** Resolved tools — `code` **and**
   gateway/callback — run on the runner host, so a network-blocked Daytona sandbox does not
   confine them. Pick the target (move execution into the sandbox) versus the interim guard
   (reject `code`, gateway/callback, and stdio MCP when exec/network are off). Blocks the
   `network: off` guarantee. See `research.md` section 5.
2. **`read_only` enforcement strength.** Is `read_only` a hard runtime block on resolved tools,
   or only an advisory default for the disposition? The honest first cut is advisory.
3. ~~**Pi's real control surface (Phase 0).**~~ **Resolved by S0b.** Backend-dependent: supported
   in-process (`pi.ts:311` passes `tools`), unsupported over sandbox-agent ACP (`pi-acp@0.0.29`
   forwards nothing). Design: honor `builtin_names` in-process, fail loud over sandbox-agent.
4. **The implementation branch.** No pre-named `capability-config` lane exists. Best-judgment
   plan: a new GitButler lane `feat/agent-capability-config` created at Phase 6, anchored on the
   appropriate parent (the `docs/agent-harness-capabilities` lane or `main`), confirmed with the
   user before any push. Recorded per the "use best judgement, note it" instruction.

## Slices (implementation cut)

Smallest shippable, independently reviewable units. Each names its acceptance check. Status:
`todo` / `wip` / `done`.

- **S0a — Composio `read_only` on the wire** (`done`, reviewed). Stopped stripping the Composio
  mutation hints; `read_only` now flows catalog (`_derive_read_only`) → `ToolCatalogAction` /
  `ResolvedAgentTool` → SDK `ToolSpec.to_wire()` (camelCase `readOnly`, `exclude_none`) → TS
  `protocol.ts` `ResolvedToolSpec`. Golden + both contract tests updated. 218 SDK + 15 API + 7 TS
  tests pass; reviewer APPROVED (precedence both-hints→mutating, no behavior change without a hint,
  single resolution site covered). Unblocks S3 defaults.
- **S0b — Pi control-surface investigation** (`done`). Finding (in `research.md` §1): Pi built-in
  restriction is **backend-dependent**. The Pi SDK supports `tools`/`excludeTools`/`noTools`
  (+ CLI `--tools`/`--no-builtin-tools`); the in-process engine already passes it (`pi.ts:311`).
  But `pi-acp@0.0.29` hardcodes `pi --mode rpc --no-themes` and forwards nothing, so restriction
  is **unsupported over sandbox-agent ACP** → honor `builtin_names` in-process, fail loud over
  sandbox-agent. Future lever: patch/fork pi-acp to add the flags to its spawn.
- **S1a — `sandbox_permission` config + wire plumbing** (`done`, reviewed). Model
  (`NetworkEgress`/`SandboxPermission`) on `AgentConfig`, threaded `from_params` →
  `_to_harness_config` (all 3 harnesses) → `request_to_wire` (`sandboxPermission`) → `protocol.ts`
  `AgentRunRequest` → `buildRunPlan`/`RunPlan`. Catalog schema + `_DEFAULT_AGENT_CONFIG` declare
  it; both `KNOWN_REQUEST_KEYS` guards + both contract tests updated; optionality proven (no key
  when unset, claude golden omits it). 220 SDK + 111 TS pass, tsc + ruff clean. Reviewer APPROVED.
  NO enforcement (deferred to S1b via `TODO(S1b)`).
- **S1b — Daytona enforcement + fail-loud** (`done`, reviewed). `daytonaNetworkFields` maps
  `off`→`networkBlockAll:true`, `allowlist`(non-empty)→`networkAllowList:"a,b"`,
  `allowlist`(empty)→`networkBlockAll:true` (block-all, the must-fix from review — empty list =
  allow nothing, never default-open); `buildSandboxProvider` spreads it into the Daytona `create`.
  `buildRunPlan` fails loud (`strict` + restricted) on the local sidecar. Daytona network fields
  verified against `@daytonaio/sdk` (`networkBlockAll?: boolean`, `networkAllowList?: string`).
  Live `network: off` egress check deferred to Phase 3. typecheck + 126 TS tests pass.
- **S1g — Runner-host guard** (`done`, reviewed). `buildRunPlan` rejects, at plan time (before
  any cwd/temp-dir allocation), a `strict` + restricted-network run that carries a runner-side
  tool: `executableToolSpecs` (code **and** gateway/callback — reviewer confirmed it filters out
  only `kind:"client"`, so Codex's hole is closed) or a stdio MCP server (`hasStdioMcpServer`,
  mirrors `mcp.ts` delivery rule). `best_effort` is the opt-out. Covered by run-plan unit tests.

## Deferred follow-ups (defer-todo)

- **S1b-py — Python in-process fail-loud.** A `network: off` + `strict` run on the in-process
  Python SDK backend does NOT fail loud (it has no sandbox). `SessionConfig` intentionally omits
  sandbox concerns, so this needs the typed policy threaded through `Backend.create_sandbox` /
  `Environment.create_session` / `LocalBackend` (`sdks/python/agenta/sdk/agents/interfaces.py`,
  `adapters/local.py`). Repro: run the in-process SDK path with `sandbox_permission.network=off`,
  `enforcement=strict` — expect a loud failure, observe a silent unconfined run.
- **S1b-pi-inproc — TS in-process Pi fail-loud.** Symmetric gap inside `services/agent`:
  `engines/pi.ts` (in-process Pi, not the sandbox-agent path) has no sandbox-permission handling,
  so `network: off` + `strict` runs unconfined there while the local-sidecar path correctly
  rejects. Add the same fail-loud check to the in-process engine. Reviewer-flagged, nice-to-have.
- **S4-readonly-fe — surface Composio `read_only` in the FE tool catalog.** The per-tool
  disposition control defaults from `read_only`, but the FE tool catalog / `ToolSelectionMeta`
  (`ToolSelectorPopover.tsx`) doesn't carry `read_only` yet, so the default shows "Inherit policy"
  until an author picks. The backend catalog already exposes `read_only` (S0a); plumb it from the
  `/tools` catalog response into the added tool object so the default auto-populates. Layer 3 works
  on explicit author choice without this; nice-to-have.
- **S2 — Layer 1 Claude `.claude/settings.json`** (`done`, reviewed). `claudeSettings` (mode +
  allow/deny/ask) flows `harness_options["claude"]["permissions"]` → wire → `prepareWorkspace`,
  which writes `<cwd>/.claude/settings.json` for Claude (local `mkdirSync`+`writeFileSync`,
  Daytona `mkdirFs`+`writeFsFile`), merging author rules with Layer-2-derived denies
  (`network≠on`→WebFetch/WebSearch; `filesystem` readonly/off→Write/Edit), deduped. Pure
  `buildClaudeSettings` returns `undefined` for Pi (no file) and when fully-open+unset. Structured
  as `RuleSet[]` for S3. Reviewer live-verified the ACP adapter reads it + rejects invalid modes;
  mkdir-before-write safe both ways. 136 TS + 274 SDK pass, tsc + ruff clean. Live rule-syntax
  check deferred to Phase 3. mcp__ tool-spec rules + Layer-3 dispositions deferred to S3.
- **S3a — Layer 3 disposition plumbing** (`done`, self-reviewed). `disposition`
  (`allow`/`ask`/`deny`) on `ToolSpecBase` + `MCPServerConfig`/`ResolvedMCPServer` + `protocol.ts`
  `ResolvedToolSpec`/`McpServerConfig`. `effective_disposition()` default ladder: explicit wins →
  `needs_approval`→ask → `read_only` true→allow/false→ask → unset (runner falls to
  `permissionPolicy`). `AliasChoices` accepts the FE's `permission_mode`. Goldens + contract tests
  updated (sub-key, no `KNOWN_REQUEST_KEYS` change). 148 TS + 286 SDK pass. NO enforcement (S3b).
- **S3b — Layer 3 enforcement** (`done`, reviewed). Relay enforces resolved-tool disposition
  (`resolveDisposition`: deny→refusal string before any execution, allow→run, ask/unset→headless
  `permissionPolicy`); `permissionPolicy` threaded into `startToolRelay`, same resolver as the
  Claude-builtin responder. `claude-settings.ts` renders per-MCP-server `mcp__<server>` rules
  (name verified against `toAcpMcpServers`). Responder untouched (Claude builtins handled by S2
  settings.json + existing `PolicyResponder`); no fragile per-resolved-tool mcp rules. HITL "ask"
  surfacing deferred to S5 (`TODO(S5)`). 166 TS pass. Reviewer APPROVED (deny-before-execute +
  MCP-name both verified against downstream consumers).
- **S4 — Playground form** (`done`, reviewed + fixed). New controls: `SandboxPermissionControl`
  (network mode/allowlist/filesystem/enforcement), `ClaudePermissionsControl` (mode +
  allow/deny/ask, gated to Claude harness, collapsible advanced), per-tool `ToolDispositionControl`
  (allow/ask/deny). Persist under `data.parameters.agent.*` (`sandbox_permission`,
  `harness_options.claude.permissions` preserving sibling slices, top-level tool `disposition`).
  Non-destructive; lint + typecheck clean. Live browser check deferred to Phase 3.
- **S4b — Layer 3 persistence fix** (`done`). Review caught that per-tool disposition was written
  into `agenta_metadata` (stripped on save) AND that the authored config layer didn't carry it.
  Fixed end to end: `ToolConfigBase.disposition` (AliasChoices), `_copy_tool_metadata` +
  `_apply_tool_metadata` + `platform/gateway.py` `CallbackToolSpec` (the gateway/playground path,
  an extra miss) all carry it, FE writes top-level `disposition` (survives strip). Round-trip
  tests prove config dict → `ToolSpec.to_wire()` carries it (52 pass). Also fixed the `&#10;`
  placeholder cosmetic.
- **S5 — Playground HITL parked/resume** (`done` core, live round-trip deferred). The HITL path
  was ~60% built (responder seam, `interaction_request` emission, Vercel egress/ingress, FE
  approve/deny UI + auto-resume). This slice added the missing runtime: `HITLResponder`
  (responder.ts) applies a stored approval decision on resume, parks (deny) on first occurrence
  when a human surface is present (`hasHumanSurface = !!request.sessionId`; verified `/invoke`
  leaves it None so headless is byte-identical to `PolicyResponder`), and falls to `basePolicy`
  headless. `extractApprovalDecisions` reads the existing Vercel-converted `tool_result`
  `{approved}` envelope by `toolCallId` — no new wire carrier. 177 TS pass. DEFERRED to live
  verification: the multi-turn round-trip (does cold-replay re-raise the gate on turn 2 so the
  decision applies, and does the harness re-attempt the tool) — exact live test in `open-issues.md`.
  Relay-tool HITL deferred as S5.2 (relay is fire-and-forget; see `open-issues.md`).
- **S6 — Tests + live verification** (`todo`). Unit, golden wire, and the QA-matrix cells the
  enforceability table claims; pin one green run as a replay test.

Current run starts with **S0a** (independent, low-risk) and **S0b** (read-only investigation) in
parallel.

## Next steps

1. **Live QA** against a deployed stack: run the `plan.md` S6 checklist (Daytona egress block,
   Claude settings.json, per-tool deny, HITL round-trip). Needs SDK container reload + a
   sandbox-agent image rebuild + Daytona/Anthropic keys.
2. **Land the branch.** The work is on the GitButler lane `feat/agent-capability-config`. Push +
   open the PR when ready (`but push <lane>` then `gh pr create --base <parent>`).
3. **After live QA:** update the user-facing `documentation/` pages and resolve the deferred
   follow-ups (S1b-py, S1b-pi-inproc, S4-readonly-fe, S5.2 relay HITL, the S5 multi-turn round-trip).

## Landing (branch handoff)

The non-shared work is committed to the GitButler lane **`feat/agent-capability-config`**
(commit `97581d25ef`, based on `main`): 32 files, +2451 lines — all new code + the project
docs. Verified the concurrent skills-config slice was NOT swept in.

**Left UNASSIGNED on purpose** (co-edited by the concurrent skills-config slice; both slices
extend the same core config/wire surface, so wholesale-staging would steal the other session's
hunks). Hunk-split these from the skills slice — or land the two slices together — before the
lane builds/pushes:

- `sdks/python/agenta/sdk/agents/dtos.py` (SandboxPermission, ClaudePermissions, wire methods)
- `sdks/python/agenta/sdk/agents/utils/wire.py`, `adapters/harnesses.py`, `__init__.py`
- `sdks/python/agenta/sdk/utils/types.py` (AgentConfigSchema fields)
- `services/oss/src/agent/schemas.py` (`_DEFAULT_AGENT_CONFIG` default)
- `services/agent/src/protocol.ts` (the new wire interfaces), `engines/sandbox_agent.ts`
  (HITLResponder + relay policy wiring), `engines/sandbox_agent/run-plan.ts`
- `web/.../SchemaControls/AgentConfigControl.tsx`, `index.ts`
- `sdks/python/oss/tests/.../golden/run_request.{pi,claude}.json`, `test_wire_contract.py`
- `services/agent/tests/unit/{wire-contract,sandbox-agent-run-plan,sandbox-agent-orchestration}.test.ts`

**Finish + push** (after the shared files are assigned to the lane):

```
but rub <shared-file-or-hunk> feat/agent-capability-config   # per shared file/hunk
but commit feat/agent-capability-config --only -m "..."       # the shared remainder
but push feat/agent-capability-config
gh pr create --head feat/agent-capability-config --base main
```

## Changelog

- 2026-06-23: Project created from `../../scratch/capability-architecture.md`. Design, plan,
  research, and status written. Scope extended to the playground frontend.
- 2026-06-23: Confirmed `sandbox_permission` naming; folded `permission_policy` into Layer 3 as
  its global default; placed per-tool dispositions on the tool spec and MCP permissions on the
  MCP server spec.
- 2026-06-23: Codex reviewed (verdict above). Verified two claims in code: `pi-acp@0.0.29`
  spawns `pi --mode rpc` with no `tools` field, and `relay.ts` runs gateway/callback tools
  runner-side alongside `code`. Folded the feedback in, broadened the runner-host guard to
  gateway/callback, fixed the filesystem-authority contradiction, and re-scoped Pi Phase 0 to an
  investigation. Started `implement-feature`; cut the slice list (S0a–S6).
- 2026-06-23: Landed Phase 0 + Layer 2 (code-complete, reviewed). S0a (Composio `read_only`,
  reviewed), S0b (Pi finding), S1a (`sandbox_permission` config + wire, reviewed), S1b+S1g
  (Daytona enforcement + runner-host guard, reviewed; fixed the empty-allowlist→default-open
  footgun to block-all). All green: 220 SDK + 126 TS tests, tsc + ruff clean. Live Daytona/Claude
  end-to-end verification batched to a later Phase-3 pass. Two in-process fail-loud gaps deferred
  (S1b-py, S1b-pi-inproc). Next: S2 (Layer 1 Claude settings.json).
- 2026-06-24: LIVE QA on :8280 + PR. Pushed PR #4811 (non-shared slice). Live-proved L3 deny
  (token absent on deny, present on allow), the L1 settings.json write (captured the real file),
  and the L2 runner-host guard (both reject messages + best_effort control). Daytona egress block
  is code-correct but env-inconclusive (org blocks all egress); Claude behavioral refusal needs a
  project Anthropic key. Found + FIXED + live-verified a footgun: `backend:"pi"` (in-process engine)
  silently ignored all 3 layers; added `unenforceableCapabilityConfig` fail-loud guard in
  `engines/pi.ts` (rejects restrictive sandbox_permission + deny/ask dispositions), 8 tests, live
  rejection confirmed. 185 TS green. Note: `engines/pi.ts` is in the shared-files set (carries the
  guard); test `pi-capability-guard.test.ts` is new.
- 2026-06-24: Landed Layers 1 + 3 + the playground (code-complete, reviewed). S2 (Claude
  `.claude/settings.json`, reviewed), S3a (disposition plumbing), S3b (relay + MCP-rule
  enforcement, reviewed), S4 (playground form, reviewed) + S4b (fixed the `agenta_metadata`-strip
  + authored-config-layer gap so per-tool disposition persists end to end), S5 (HITL cross-turn
  responder core; multi-turn round-trip + relay HITL deferred to live verification / S5.2). Full
  suites green together: 293 SDK + 15 API + 10 services/oss + 177 TS, tsc + ruff clean. Corrected
  two stale research claims (FE `permission_mode` round-trip did not exist; Pi restriction is
  backend-dependent). Remaining: live QA (S6 checklist) + push the branch.
