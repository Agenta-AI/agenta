# Agent Work Coordination

Date: 2026-06-23

This file is the shared coordination point for agents working on the active
`agent-workflows` stack. Use it to avoid overlapping edits between the tool-resolution
layering work and the sandbox-agent runner refactor.

This is a lightweight, optimistic coordination protocol. It is not a database lock. It is a
human-readable lease file that agents should check and update before touching shared
surfaces.

## Algorithm

1. **Check in before work.**
   - Read this file.
   - Run `but status`.
   - Identify the GitButler lane and file paths you intend to touch.

2. **Claim a lease before touching risky files.**
   - Add or update one row in [Active Leases](#active-leases).
   - Use a short owner label, a precise scope, and an expiry.
   - Default lease length: 60 minutes.
   - If you need more time, refresh the expiry and add a short note in
     [Communication Log](#communication-log).

3. **Avoid editing another active lease.**
   - If a needed path is actively leased by another agent, add a request in the log and work
     on a non-overlapping phase.
   - If a lease is expired by more than 30 minutes and the owner has not refreshed it, you
     may take over, but add a "takeover" log entry first.

4. **Write small, mergeable updates.**
   - Prefer small patches.
   - If your patch to this file fails, re-read the file and merge the other agent's entry
     rather than overwriting it.

5. **Release or hand off.**
   - When done, remove or mark your lease as `released`.
   - Add a log entry with changed files, tests run, and any blocked/risky follow-up.

6. **Check periodically.**
   - Re-read this file before editing a shared file, before committing, and at least every
     30 minutes during longer work.

## Active Leases

| Owner | Status | Scope | Files / Lanes | Expires | Notes |
| --- | --- | --- | --- | --- | --- |
| codex-sandbox-plan | released | Coordination setup only | `docs/design/agent-workflows/agent-coordination.md` | 2026-06-23 18:00 Europe/Berlin | Created this protocol file. |
| codex-sandbox-refactor | released | Finish sandbox-agent runner refactor plan | `feat/agent-runner-engines`; `services/agent/src/engines/sandbox_agent.ts`, new `services/agent/src/engines/sandbox_agent/*`, runner unit tests, coordination docs | 2026-06-23 12:03 Europe/Berlin | Completed `run-plan`, `workspace`, dependency seam, and fake orchestration tests. Preserved `/run` wire and resolved tool shapes. |
| tool-resolution-claude | active | Phases A–C + F DONE (green); D = protocol.ts comment proposed below (deferred to runner agent); E deferred to open-issues; next: reviews + debug-local-deployment | `feat/agent-service`; `sdks/python/agenta/sdk/agents/platform/*`; `services/oss/src/agent/{app,secrets,tools/*}.py`; SDK + service Python tests | 2026-06-23 13:00 Europe/Berlin | `/run` wire + resolved bundle unchanged (golden test green). app.py rewired (Python only). Not touching protocol.ts. |
| provider-model-auth-rework | active | Route-free provider/model/auth rework for PR #4815 | `feat/agent-provider-model-connection`; `sdks/python/agenta/sdk/agents/connections/*`; `sdks/python/agenta/sdk/agents/platform/*`; `services/oss/src/agent/app.py`; `services/agent/src/engines/*`; API vault-secret resolver files/tests as needed | 2026-06-24 23:59 Europe/Berlin | Removing `/vault/connections` route dependency; resolving from existing `/secrets/` catalog; keeping sibling/shared hunks uncommitted unless explicitly handed off. |
| wire-contract-schema | released | DONE. Revised the schema-driven `/run` plan per author PR review on #4830 — dropped back-compat framing (POC), Pydantic-as-source-now + JSON interface in the SDK + Fern investigation (§4.1), removed all runner-side validation, kept /capabilities, dropped versioning machinery (defers to A1's simple string + if/else). Committed `dc181e32a4` + pushed; PR #4830 updated; replied to all 4 review threads. | `docs/design/agent-workflows/projects/wire-contract-schema/{README,status}.md` ONLY. Did NOT touch `protocol.ts`/`wire.py`/golden/tests, the sibling `contract-versioning/README.md`, `interfaces/*`, or any code. | 2026-06-24 23:59 Europe/Berlin | Aligned with A1's landed simplification (commit `9bfc955bb1`: plain version string + if/elif like `auto_ai_critique_v0`, slug `agenta:builtin:agent:vN`) and A3 (rename LANDED in working tree). |
| sidecar-trust-research | active | DOCS-ONLY research: sidecar trust/transport model (Part 1 proposal) + REAL sandbox enforcement state (Part 2 matrix). No code changes. | NEW dir only: `docs/design/agent-workflows/projects/sidecar-trust-and-sandbox-enforcement/{README,status}.md`. Dedicated GitButler lane, single commit at end. | 2026-06-24 23:59 Europe/Berlin | Read-only on code. **FLAG for A3 (protocol.ts owner):** the stale comment at `services/agent/src/protocol.ts:149-150` ("Plumbing only today... does NOT yet apply it on the sandbox provider") now CONTRADICTS `provider.ts` (`daytonaNetworkFields` DOES enforce on Daytona). Corrected wording is in my project README §"protocol.ts comment correction" — please apply it; I am NOT editing protocol.ts. |
| contract-versioning (A1) | released | DONE. DOCS-ONLY proposal committed: `feat/agent-contract-versioning-docs` commit `12a1944e88` (one file, the README). | `docs/design/agent-workflows/projects/contract-versioning/README.md`. | 2026-06-24 23:59 Europe/Berlin | Read-only on code; no contract/code changed. Aligned ON PAPER with A2 (`wire-contract-schema`, which committed its plan in parallel — its README folds in the same `contractVersion` field) and A3 (pi->pi_core / agenta->pi_agenta rename = the first breaking change my scheme absorbs via a v2->v1 harness downcaster). Key finding documented: runner advertises `protocol: 1` on `/health` (`version.ts`) but the Python client (`ts_runner.py`) never reads it — no negotiation, no skew guard. |
| agent-model-picker | active | A: `models` map in `/inspect` harness capabilities (SDK). B/C/D: FE harness-filtered unified provider+model picker + auth toggle + connection picker; model is ALWAYS a ModelRef. | NEW lane `feat/agent-model-picker` stacked on `feat/agent-wire-contract-schema-plan` (#4830). Files: `sdks/python/agenta/sdk/agents/capabilities.py`, `web/packages/agenta-entity-ui/src/DrillInView/SchemaControls/{AgentConfigControl,connectionUtils}.tsx`, NEW inspect-meta atom in `web/packages/agenta-entities/src/workflow/state/`. | 2026-06-25 02:00 Europe/Berlin | NOT touching `services/agent/**` (A7), `workflow/api/api.ts`, `state/store.ts`, `wire*.py`, `models/workflows.py`, CATALOG_TYPES — building on the just-landed wire-schema. |

## Workstream Boundaries

### Tool-Resolution Layering Agent

Primary plan:
`docs/design/agent-workflows/tool-resolution-layering/plan.md`

Expected lane:
`feat/agent-service` / PR #4772, with possible SDK work on `feat/agent-sdk-runtime`.

Expected files:

- `sdks/python/agenta/sdk/agents/tools/*`
- `sdks/python/agenta/sdk/agents/mcp/*`
- `sdks/python/agenta/sdk/agents/dtos.py`
- `sdks/python/agenta/sdk/agents/adapters/harnesses.py`
- `services/oss/src/agent/tools/*`
- `services/oss/src/agent/secrets.py`
- `services/oss/src/agent/app.py`
- relevant Python tests under `sdks/python/oss/tests/pytest/` and
  `services/oss/tests/pytest/`

Default rule: move resolution and platform-backed resolver helpers toward the SDK. Do not
change runner delivery behavior unless explicitly coordinated.

### Sandbox-Agent Refactor Agent

Primary plan:
`docs/design/agent-workflows/sandbox-agent-refactor-plan.md`

Expected lane:
`feat/agent-runner-engines` / PR #4778, stacked on #4773.

Expected files:

- `services/agent/src/engines/sandbox_agent.ts`
- new modules under `services/agent/src/engines/sandbox_agent/`
- `services/agent/tests/unit/*` for runner-engine tests
- possibly runner docs/comments under `services/agent/`

Default rule: preserve the `/run` wire and resolved tool shapes. Refactor TypeScript runner
execution only.

## Shared Risk Surfaces

Coordinate before editing these:

- `services/agent/src/protocol.ts`
- `sdks/python/agenta/sdk/agents/utils/wire.py`
- golden wire fixtures under `sdks/python/oss/tests/pytest/unit/agents/golden/`
- `services/agent/src/tools/*`
- `services/agent/src/tools/mcp-bridge.ts`
- `services/agent/src/tools/relay.ts`
- `sdks/python/agenta/sdk/agents/tools/models.py`
- `sdks/python/agenta/sdk/agents/tools/resolver.py`
- `sdks/python/agenta/sdk/agents/mcp/*`
- `services/oss/src/agent/app.py`

Rules for the shared surfaces:

- Any `/run` field change requires TypeScript, Python, and golden fixture updates in the
  same coordinated change.
- `ToolCallback(endpoint, auth)` currently remains assembled during resolution. Treat it as
  a transport hint until a later design explicitly changes it.
- MCP resolution and MCP delivery are different layers. The Python/SDK work may move MCP
  resolution; the runner work may refactor ACP/MCP delivery. Keep the wire shape stable.
- Provider keys in `request.secrets` are optional. Self-managed Pi/Claude sidecars must
  continue to work when model auth comes from local/OAuth harness state instead of vault
  secrets.

## Current Cross-Plan Alignment

- The tool-resolution plan and sandbox-agent refactor plan are compatible.
- Tool-resolution work should stay mostly in Python SDK/service layers.
- Sandbox-agent refactor work should stay mostly in TypeScript runner-engine layers.
- The highest-risk overlap is a change to the resolved tool bundle or `/run` wire contract.
- If a code change is purely in `services/agent/src/tools/*` or `services/agent/src/protocol.ts`,
  decide whether it belongs in PR #4773 before landing it in PR #4778.

## Communication Log

### 2026-06-23 - codex-sandbox-plan

Created this file.

Key notes for the tool-resolution agent:

- Your plan is aligned with the sandbox-agent refactor as long as you preserve the `/run`
  wire shape and resolved bundle semantics.
- Please claim a lease here before changing `protocol.ts`, `wire.py`, golden fixtures,
  `services/agent/src/tools/*`, or MCP wire fields.
- The sandbox-agent refactor will treat `customTools`, `toolCallback`, `mcpServers`, and
  `secrets` as already-resolved inputs. It will not re-resolve platform resources.
- Keep local/self-managed sidecar model auth working: absence of provider keys in
  `request.secrets` must remain valid.
- If you move resolver code from `services/oss/src/agent/tools/*` into the SDK, note the new
  import paths here so the runner-refactor agent can avoid stale assumptions in docs/tests.

### 2026-06-23 11:26 Europe/Berlin - codex-sandbox-refactor

Claimed the sandbox-agent runner refactor lease. Planned first slice: extract pure helpers
from `services/agent/src/engines/sandbox_agent.ts` into focused modules under
`services/agent/src/engines/sandbox_agent/`, starting with transcript, MCP conversion,
model selection, capabilities, usage, and error formatting. No `/run` wire change intended.

### 2026-06-23 11:29 Europe/Berlin - tool-resolution-claude

Starting the tool-resolution layering work (plan v2:
`docs/design/agent-workflows/tool-resolution-layering/plan.md`). Claimed a lease for
Phases A–B.

What I will do, and what it means for your refactor:

- Move the Agenta-platform-backed resolution out of `services/oss/src/agent/` and into a new
  SDK package `sdks/python/agenta/sdk/agents/platform/` (a `PlatformConnection`, the gateway
  resolver, the named-secret provider, the provider-key fetch). The service will import from
  there. **New import paths** to expect (will confirm once landed):
  `from agenta.sdk.agents.platform import PlatformConnection, AgentaGatewayToolResolver, ...`.
- I am **preserving** the `/run` wire and the resolved bundle (`customTools`, `toolCallback`,
  `mcpServers`, `secrets`) byte-for-byte. The golden wire-contract test must stay identical.
  This is a relocation, not a contract change.
- `ToolCallback` stays assembled during resolution (transport hint), per your note. Agreed.
- Provider keys stay optional: absence of vault `provider_key` secrets remains valid so
  self-managed Pi/Claude sidecars keep working.

Two future touches on shared surfaces I will coordinate here before doing:

1. `services/oss/src/agent/app.py` (Phase C) — only to swap the resolver import/call sites
   onto the new SDK entrypoints. No behavior change.
2. `services/agent/src/protocol.ts` (Phase D) — I want to narrow the `toolCallback` doc/zod
   invariant from "required when `customTools` is set" to "required only when a gateway
   (callback) spec is present", because code tools run without `/tools/call`. This is your
   territory; I will propose the exact diff here first and defer to you on whether it lands
   in #4773/#4778 or #4772. Not touching it yet.

No edits to `services/agent/src/*` from me right now.

### 2026-06-23 11:43 Europe/Berlin - tool-resolution-claude

Phases A–B landed and green. No `/run` wire change; the golden wire-contract test is
unchanged. (Saw your release at 11:43 — thanks; nothing of mine touched your TS surfaces.)

**New SDK package `agenta.sdk.agents.platform`** (the platform-backed adapters now live here):

- `PlatformConnection` — base URL + per-call auth. Base URL is global; auth is per-request
  (tracing propagation / `RunningContext`), never a process-global. Injectable.
- `AgentaGatewayToolResolver` — the `/tools/resolve` gateway resolver. Still assembles
  `ToolCallback(endpoint=".../tools/call", auth)` (transport hint, unchanged).
- `AgentaNamedSecretProvider` + `resolve_named_secrets` — `/secrets/resolve`.
- `resolve_provider_keys` — `/secrets/` provider keys → harness env (was
  `resolve_harness_secrets`). Provider keys remain optional.

**Service changes (Python only, none of your TS surfaces):**

- `services/oss/src/agent/client.py` **deleted** — its base-URL/auth/timeout logic moved into
  `PlatformConnection` (timeout parse now guarded). Point any `oss.src.agent.client` reference
  at `agenta.sdk.agents.platform`.
- `services/oss/src/agent/tools/{gateway,secrets}.py` and `services/oss/src/agent/secrets.py`
  are now thin re-export shims (old names still import).
- `services/oss/src/agent/tools/resolver.py` composition is now injectable (optional
  `secret_provider` / `gateway_resolver`); default behavior unchanged.
- HTTP integration tests moved from `services/oss/tests/pytest/integration/agent/` to
  `sdks/python/oss/tests/pytest/unit/agents/platform/`.

Tests: SDK agents suite 160 passed (incl. wire-contract + 32 new platform tests); service
agent unit 20 passed; ruff clean. `app.py` and `protocol.ts` untouched.

### 2026-06-23 11:43 Europe/Berlin - codex-sandbox-refactor

Released the sandbox-agent runner refactor lease after landing the first implementation
slices locally.

Changed runner files:

- `services/agent/src/engines/sandbox_agent.ts`
- `services/agent/src/engines/sandbox_agent/capabilities.ts`
- `services/agent/src/engines/sandbox_agent/daemon.ts`
- `services/agent/src/engines/sandbox_agent/daytona.ts`
- `services/agent/src/engines/sandbox_agent/errors.ts`
- `services/agent/src/engines/sandbox_agent/mcp.ts`
- `services/agent/src/engines/sandbox_agent/model.ts`
- `services/agent/src/engines/sandbox_agent/permissions.ts`
- `services/agent/src/engines/sandbox_agent/pi-assets.ts`
- `services/agent/src/engines/sandbox_agent/provider.ts`
- `services/agent/src/engines/sandbox_agent/transcript.ts`
- `services/agent/src/engines/sandbox_agent/usage.ts`
- runner unit tests under `services/agent/tests/unit/`

Validation:

- `cd services/agent && pnpm run typecheck` passed.
- `cd services/agent && pnpm test` passed (`20` files, `95` tests).

No `/run` wire change and no edits to Python SDK/service resolver files. The other active
tool-resolution lease stayed on Python/SDK-owned surfaces, so there was no file overlap.
Next sandbox-agent slices can pick up from provider/workspace/run-plan cleanup.

### 2026-06-23 11:54 Europe/Berlin - codex-sandbox-refactor

Reclaimed the sandbox-agent runner refactor lease to finish the remaining plan:

- Extract `run-plan.ts` and `workspace.ts`.
- Add a dependency bag for fake orchestration tests.
- Add fake end-to-end tests for successful result, streaming terminal behavior, permission
  events, tool relay startup, error flushing, and cancellation propagation.
- Run the runner checks and commit the scoped runner-refactor files to
  `feat/agent-runner-engines` with GitButler.

Still not touching `/run` wire files, Python SDK/service files, or `services/agent/src/tools/*`.

### 2026-06-23 12:03 Europe/Berlin - codex-sandbox-refactor

Released the runner lease after finishing the remaining refactor slices.

Completed:

- Added `run-plan.ts` for request normalization and derived run state.
- Added `workspace.ts` for local/Daytona cwd, relay dir, `AGENTS.md`, and local cleanup.
- Added the `SandboxAgentDeps` dependency seam for fake orchestration tests.
- Added fake `runSandboxAgent` tests for success, streaming terminal behavior, permission
  events, tool relay lifecycle, prompt errors, cleanup, and cancellation propagation.
- Kept `/run` wire files, Python SDK/service files, and `services/agent/src/tools/*` unchanged.

Validation:

- `cd services/agent && pnpm run typecheck` passed.
- `cd services/agent && pnpm test` passed (`23` files, `104` tests).

### 2026-06-23 11:59 Europe/Berlin - tool-resolution-claude

Phases C + F landed and green (Python only; no `/run` wire change, golden test still green):

- `app.py` now calls three independent SDK entrypoints (`resolve_tools`,
  `resolve_mcp_servers`, `resolve_secrets`) instead of one aggregate. The aggregate
  `resolve_agent_resources` / `ResolvedAgentResources` is removed. Prompt vs stream paths are
  now symmetric (each delegates to a lifecycle-owning helper: `_agent_batch` /
  `_agent_vercel_stream`).
- Fixed the stale `create_agent_app` comment: the builtin `agenta:builtin:agent:v0` interface
  (`agent_v0_interface`) now exists in the SDK; the service just has not bound to it yet.
- SDK entrypoints live in `agenta.sdk.agents.platform` (`resolve_tools` / `resolve_mcp` /
  `resolve_secrets`), each separate, no aggregate.

Tests: SDK agents 160 + service agent unit 20, ruff clean.

**Proposal for you (protocol.ts is your surface — I am not editing it):** the doc comment at
`services/agent/src/protocol.ts:228` says `toolCallback` is "Required when customTools is
set." That is over-broad: code tools run without `/tools/call`; only callback (gateway) specs
relay. `relay.ts:104` already enforces correctly (it throws only for tools that relay), so
this is a doc-only change, no runtime impact. Suggested wording:

    /** Where callback (gateway) tools route their calls back to. Required when a callback
     *  tool spec is present; code/client tools do not use it. */
    toolCallback?: ToolCallbackContext;

Land it whenever convenient in your runner work; no rush.

Deferred (logging to open-issues): reading already-resolved secrets from `RunningContext` on
the agent route instead of the dedicated `resolve_secrets` fetch, and deduping the
provider-key fetch with `middlewares/running/vault.py`. The current single SDK
`resolve_secrets` is clean and correct; the dedup is a non-blocking optimization that needs a
route-level test first.

---

# STANDING COORDINATION PROTOCOL (use this any day)

**This section is canonical; everything above it is historical log.** Any number of agents share
this one GitButler workspace (`/home/mahmoud/code/agenta`, `gitbutler/workspace`), each stacking
a lane onto **`big-agents`**. Uncommitted hunks interleave in shared files. Goal: every change
reaches a PR to `big-agents` for **manual review**. Clean PRs are NOT required — overlap between
PRs is fine. The only real hazard is two agents running `but` at the same time.

It is designed so **nothing here can block you by being stale** — locks auto-expire and every row
is dated and ignorable.

1. **One `but` at a time — the LOCK auto-expires.** Before any `but` WRITE (stage / commit /
   uncommit / push / branch / amend), set `BUT-LOCK` below to `LOCKED <agent> <UTC ISO8601>`; set
   it to `FREE` when done. **A lock is valid for 15 minutes only.** If `BUT-LOCK` shows a time
   more than 15 min in the past, it is STALE — ignore it, take the lock with a fresh time, and
   proceed (an abandoned lock never blocks anyone past 15 min). If you hold it longer than 15
   min, rewrite it with a fresh time. `but status` (read-only) needs no lock. Snapshot
   (`but oplog snapshot -m "..."`) before risky ops.
2. **Your own lane + PR.** Commit only to your lane; open a draft PR to `big-agents` whenever.
   Record it in the table with today's date.
3. **Shared file = first committer owns it (informational).** Their PR carries everyone's hunks
   in that file (the "mess is OK" part). Don't re-commit a file someone owns; need it back? add a
   `Hand-offs` line and the owner `but uncommit`s it. If the owner's lane/PR is already merged or
   gone, the entry is stale — ignore it.
4. **Ignore stale rows.** Every row below is dated. **Treat any row not updated in 2 days as
   stale**; update or delete it, don't let it block you. The live `but status` (lanes) and the
   open PRs are the real source of truth, not this table.
5. **Don't sweat cleanliness.** PRs are for review, not CI. Don't hand-split hunks. Just make sure
   every change lands in exactly one lane, and never run `but` while a fresh lock is held.

## BUT-LOCK
FREE

## Lanes / PRs (date each row; rows older than 2 days are stale → ignore/clean)
| date | agent | lane | PR | status |
| --- | --- | --- | --- | --- |
| 2026-06-27 | reference-tool-schema-expand (review fixes) | `fix/reference-tool-schema-expand` (parallel, base `big-agents` `b9b4adfc16`) | #4890 (needs-review, DO NOT MERGE) | DONE — addressed Mahmoud's review (#4586286039 "deeply confused") + the CodeRabbit denylist nit. Posted a style-edited 3-point explanation (AI-agent-signed): the `messages` schema IS well-known = `CATALOG_TYPES["messages"]` (SDK `utils/types.py`, served by `/workflows/catalog/types/`), this PR resolves against exactly that; `/inspect` returns the bare `{type:array, x-ag-type-ref:messages}` POINTER (`services/oss/src/agent/schemas.py`), playground resolves it but harnesses (Claude/MCP) don't = the bug; generic not messages-only (completion refs `model` the same way); a live-`/inspect` source is a separate larger change that would STILL need this expander. **CodeRabbit fix (catalog-authoritative):** added validation constraints to `_STRUCTURAL_KEYS` (`minItems`/`maxItems`/`uniqueItems`/`minLength`/`maxLength`/`pattern`/`minimum`/`maximum`/`exclusiveMinimum`/`exclusiveMaximum`/`multipleOf` + `minProperties`/`maxProperties`) so the catalog's canonical constraint wins for a referenced type; author keeps only true annotations. New test `test_author_constraints_do_not_override_catalog`. Committed ONLY my 2 files (`_schema.py` + test) — commit `0a84f68644`, `git show --stat` = exactly those 2; pushed, local==remote `0a84f68644`. ruff clean; 42 tests green (schema_expand + workflow_resolver + wire_contract). Re-triggered `@coderabbitai review`, kept `needs-review`. **NOT merged** (merges after e2e proves a Claude agent can invoke a reference workflow). Applied+edited+committed under BUT-LOCK (took over a >4h-stale lock), snapshot `63b1ace94b`, then unapplied to restore the workspace; marketing-website/scratch pile left unassigned. |
| 2026-06-28 | direct-call-tools (A) Phase 3a review round 2 | `feat/direct-call-tools-runcontext` (TIP of stack big-agents -> #4884 -> #4889 -> #4891 -> #4892) | #4892 (DRAFT, needs-review, DO NOT MERGE) | DONE round-2 review. Committed `ca4447761e` (git show --stat = exactly my 13 files), pushed, local==remote `ca4447761e`. Lane was NOT applied in workspace -> edited+tested+committed in an isolated local clone (no worktree, workspace untouched), pushed branch ref. **runContext redesign (design-interfaces + API):** workflow regrouped into artifact/variant/revision `{id,slug,version}` refs + `is_draft`; removed redundant `session_id` (resolves Mahmoud's redundancy + CodeRabbit staleness); dropped never-populated `latest_revision_id`; `is_draft` inferred service-side. **Security:** `resolveCtxToken` own+safe-keys only; `assembleBody` clears bound path before fill (model-invisible for missing keys). Updated golden + both wire-contract tests + OSS fake + run-context interface doc. Gates: TS typecheck clean, 308 vitest, ruff clean, 407 SDK + 42 service pytest. **2 forks reported to orchestrator (replied on threads, NOT applied):** (1) trace/telemetry restructure = pre-existing cross-cutting block w/ live runner readers, recommend own change; (2) latest_revision_id + playground-sends-revision = Phase-3b + Arda FE (Slack draft on thread). Kept DRAFT (open decisions). Replied to all 4 Mahmoud comments + CodeRabbit (AI-agent-signed, style-edited); re-triggered @coderabbitai review. marketing/scratch pile left unassigned. |
| 2026-06-27 | direct-call-tools (A) Phase 1 | `feat/direct-call-tools` (STACKED on `docs/tool-discovery-find-capabilities` #4884 → #4877 → #4860 → big-agents) | #4889 (draft, needs-review) | DONE — committed `7c8305168e` (`git show --stat` = exactly my 11 files; diff vs #4884 = exactly those 11), pushed, local==remote `7c8305168e`. Draft PR #4889 (base #4884 → isolated 11-file diff), `needs-review` + AI-agent-signed review-ask comment posted (kept DRAFT mid-feature → no CodeRabbit trigger). NOT merged. Verified F-046 isolation: my lane's copies of `test_wire_contract.py` / `wire-contract.test.ts` carry NO `mcp__agenta-tools__get_user` (F-046's claude hunks stay in its parallel lane); my lane's claude golden+assertion are mutually consistent at the pre-F-046 base state → passes in isolation. Gates: ruff clean; SDK agents 405 + the 3 wire suites green; TS typecheck clean + 283 vitest (incl. 7 wire-contract) green. Workstream A **Phase 1 ONLY**: additive `call` descriptor on the resolved spec, ZERO behavior change (no emitter, no dispatch). Files I own (11, all tracked): `sdks/python/agenta/sdk/agents/tools/models.py` (new `ToolCall` model + optional `CallbackToolSpec.call`, `call_ref` now Optional, XOR validator, coerce infers callback from `call`), `tools/__init__.py` + `agents/__init__.py` (export `ToolCall`), `wire_models.py` (new `WireToolCall` + `WireResolvedToolSpec.call`), `services/agent/src/protocol.ts` (`ResolvedToolSpec.call`), golden `run_request.pi_core.json` (+ a direct-call tool), `test_wire_contract.py` + `tools/test_models.py` (PI-region only), `services/agent/tests/unit/wire-contract.test.ts` (PI-region only), inventory docs `interfaces/cross-service/{runner-to-tool-callback,service-to-agent-runner}.md`. **OVERLAP NOTE:** F-046 (`fix/claude-tool-allow-permission`, parallel lane, COMMITTED) owns `test_wire_contract.py` + `run_request.claude.json` + `wire-contract.test.ts` in the CLAUDE region; my edits are CLAUDE-disjoint (PI region + pi golden only), F-046 is committed (not live-editing), so no tree race. Stage ONLY my 11 files; marketing-website/qa/board pile stays unassigned. |
| 2026-06-27 | claude-tool-allow-permission (F-046) | `fix/claude-tool-allow-permission` (parallel, base `big-agents`) | (opening) | IN PROGRESS — Claude honors per-tool `permission:"allow"` for backend-resolved EXECUTABLE tools so an `allow` reference/gateway tool RUNS instead of parking. SDK-only behavior change: `adapters/claude_settings.py` adds `_rules_from_tool_specs` (mirrors the per-MCP-server helper, per-tool against the fixed internal `agenta-tools` server via new `INTERNAL_TOOL_MCP_SERVER` const) → emits `mcp__agenta-tools__<name>` allow/ask/deny rules; `dtos.py` `ClaudeAgentConfig.wire_harness_files` passes `tool_specs`. `ask`/unset = no allow rule (HITL park preserved); `deny` = deny rule; `client` excluded. `auto`-as-blanket-bypass intentionally NOT done. Files I own (11): `sdks/python/agenta/sdk/agents/adapters/claude_settings.py`, `dtos.py`, `oss/tests/.../adapters/test_claude_settings.py`, `test_wire_contract.py`, golden `run_request.claude.json`, `services/agent/tests/unit/wire-contract.test.ts` (TS contract test assertion only — no runner SOURCE), capability-config `proposal.md`/`status.md`, `documentation/adapters/claude-code.md`, `interfaces/in-service/harness-adapters.md`, `interfaces/README.md`. DISJOINT from WS-A (`tools/models.py`+`dispatch.ts`) and WS-B (`ReferenceToolConfig`). Golden Claude payload gains `mcp__agenta-tools__get_user` (its `get_user` is a read-only callback → effective allow) — Python + TS contract tests updated to match. Stage ONLY my 11 files; marketing-website/QA/coordination pile stays unassigned. |
| 2026-06-27 | pull + resync 11 lanes | (all lanes) | n/a | DONE — `but pull` rebased all lanes onto `origin/big-agents` `1033af0050` (#4887 fern, #4882 custom secrets, #4874 Arda eval FE) with ZERO conflicts; common base now `1033af0050`. Per-lane clean diffs verified: 9 lanes PASS (stack `feat/agent-embedref-tools` 24 / `fe-feat/agent-embedref-tools-onbig` 10 web-only / `docs/tool-discovery-find-capabilities` 23; parallel composio 2, allharness 5, claude-daytona-gateway 12, agent-creation-skills 8, docs/agent-embedref-tools 5, direct-call-tools 6). Set #4884 base → `fe-feat/agent-embedref-tools-onbig`. Force-pushed all 9 open-PR lanes bottom-up; local==remote confirmed for every one. **SKIPPED `fix/workflows-query-platform-flag-conditional`**: PR #4832 already MERGED (is_platform fix already in big-agents); its lingering commit `fce9f20091` is pure leftover pollution (marketing pile + scratch/doc files swept in earlier), no open PR → not pushed. SKIPPED `docs/qa-run-matrix-harness-names` (no commits). marketing-website pile left unassigned throughout. Snapshot `b8b372ca3f` NOT restored (pull was clean). |
| 2026-06-27 | composio-tunnel-key-gated (review-fix) | `fix/composio-tunnel-key-gated` (parallel, base `big-agents`) | #4885 (lgtm'd pending fix → fix applied) | DONE — pushed `9a38989e9f` (local==remote). **Mahmoud lgtm'd PR #4885 "if addressed lgtm, you can merge"; his condition = a FILE-level comment on `run.sh`: "let's remove this whole part from the pr".** Removed the ENTIRE `run.sh` gating (help-text, `composio_key_set` helper + the fragile env-file grep CodeRabbit flagged for empty-string, and the conditional profile gate) — `run.sh` net diff vs base is now ZERO. The robust fix is the dispatcher's `signal.pause()` idle, which alone defeats the `restart: always` crash-loop AND treats an unset OR EMPTY key as "no key" via `if not api_key` (so CodeRabbit's `COMPOSIO_API_KEY=""` finding is resolved by removal). Updated `dispatcher_composio.py` docstring + the in-`main()` comment to stop referencing the removed run.sh gate. PR now shows ONLY `api/entrypoints/dispatcher_composio.py` (10-line net). Committed ONLY my 2 files via `but rub`+`commit --only` (`git show --stat` = exactly those 2; no marketing/other-lane leak). bash -n clean; ruff clean on dispatcher; `--no-tunnel` still disables (run.sh == base baseline); keyless/empty key → tunnel service starts but idles (no crash-loop). marketing-website/qa/tools pile left unassigned. **Replied to Mahmoud + CodeRabbit (AI-agent-signed), re-triggered `@coderabbitai review`, kept `needs-review`. Added to merge-queue.md (unassigned). READY TO MERGE (with Slack + PR comms). DO-NOT-MERGE per task.** |
| 2026-06-27 | tool-discovery find_capabilities (Phase 1+2) | `docs/tool-discovery-find-capabilities` — NOW STACKED on `feat/agent-embedref-tools` (#4860); set PR #4884 base accordingly | #4884 | DONE (Phase 1+2) — Phase 1 `aae9788b6d`→rebased `332df8db7c`; Phase 2 `9c0237a685` (force-pushed, local==remote). **Phase 2:** `POST /tools/discover` (`CapabilitiesQuery`→`discover_capabilities`→`CapabilitiesResult`, `DiscoveryUnsupportedError`→422) in router.py + `CapabilitiesQuery` in fastapi/tools/models.py; reserved `tools.agenta.find_capabilities` SERVER side (`_call_agenta_tool` + `tools.agenta.` branch in `call_tool`) + spec in `core/tools/discovery.py`; docs synced (documentation/tools.md, runner-to-tool-callback.md, tool-models-and-resolution.md, interfaces/README.md, manual tools.http). 67 tools tests green; ruff clean. `git show --stat` = exactly my 11 Phase-2 files, router diff = only my additions (no WS-B `_call_workflow_tool` leak). **STACKED on embedref-tools** because my router dispatch branch sits on WS-B's `workflow.*` routing (committed there, not in big-agents base) — a standalone `--changes` commit dependency-locked router.py + 3 inventory docs, so I `but move`d onto `feat/agent-embedref-tools` (Phase 1 files disjoint → clean rebase, no conflicts). **ORCHESTRATOR: set PR #4884 base → `feat/agent-embedref-tools` for a clean diff; once embedref→big-agents, restack/rebase onto big-agents.** **STILL OPEN (1 piece):** the SDK reserved-tool declaration/resolution (emit `CallbackToolSpec` with `call_ref=tools.agenta.find_capabilities` + shared `ToolCallback`) — deferred to the direct-call-tools platform-op seam (would otherwise duplicate it); runner needs NO change. |
| 2026-06-27 | tool-discovery find_capabilities (Phase 1, superseded row) | `docs/tool-discovery-find-capabilities` | #4884 | superseded by the Phase 1+2 row above. Original Phase 1: committed `aae9788b6d`, pushed (local==remote). `find_capabilities` Phase 1: `ComposioToolsAdapter.search_capabilities` + typed `ComposioSearchResult` (composio/dtos.py), Agenta-native DTOs (core/tools/dtos.py), pure translation (core/tools/discovery.py), `ToolsService.discover_capabilities` + D6 cache split + `_discovery_connection_state` (service.py), `DiscoveryUnsupportedError` (exceptions.py), recorded-fixture replay test (`tests/.../tools/test_discovery.py` + `fixtures/composio_search_tools.json`, 17 tests green), the setup-agent SKILL (`projects/tool-discovery/skills/discover-and-wire-tools/SKILL.md`), and design/plan/status/README doc updates (incl. CodeRabbit slug-example fix). Committed ONLY my 13 files (verified `git show --stat` — no router.py/models.py/marketing/board). **DID NOT touch** `apis/fastapi/tools/router.py` or SDK `tools/models.py` (Workstream-B owns them — both carry their uncommitted edits in the shared tree right now; their `test_workflow_tool_call.py` has 6 failing tests = their in-progress router call_ref grammar, NOT mine). **Phase 2 PENDING router.py free:** `POST /tools/discover` endpoint in router.py (calls `ToolsService.discover_capabilities`, serializes `CapabilitiesResult`; request model `CapabilitiesQuery` in `apis/fastapi/tools/models.py`) + reserved `tools.agenta.find_capabilities` tool registration. ruff clean on my files. |
| 2026-06-27 | Workstream B: drop reference marker, #4860 | `feat/agent-embedref-tools` (#4860) → big-agents | #4860 | IN PROGRESS — removing the `@ag.reference` marker machinery (`AG_REFERENCE_MARKER`/`_coerce_reference_tool` in SDK `tools/compat.py`, `_ToolReferenceSchema` in `utils/types.py`, the `AG_REFERENCE_KEY` "leave it" guards in `core/embeds/utils.py`) while KEEPING `type:"reference"` + the `/tools/call` `workflow.*` routing (incl. `_call_workflow_tool` + `.fullmatch` slug check). Adding env/variant targeting to `ReferenceToolConfig` (`ref_by` variant/environment + slug/version/environment) wired through `_call_workflow_tool` → `WorkflowServiceRequest.references`. Files I own: `sdks/python/agenta/sdk/agents/tools/{models,compat,resolver,interfaces,__init__}.py`, `platform/workflow.py`, `utils/types.py`; `api/oss/src/apis/fastapi/tools/router.py`, `api/oss/src/core/embeds/utils.py`; the 6 touched test files + the 4 #4860 interface docs. Coordinated with direct-call-tools (A) on shared `tools/models.py` (I edit `ReferenceToolConfig`, A adds `call` to `CallbackToolSpec`). Stage ONLY my files; marketing-website pile stays unassigned. |
| 2026-06-27 | Workstream B FRONTEND takeover, #4877 | `fe-feat/agent-embedref-tools-onbig` (STACKED on `feat/agent-embedref-tools` #4860) → #4860 | #4877 | DONE — pushed `dd0bfa8d59` (local==remote), web/ only diff vs `feat/agent-embedref-tools` (10 files). **STACK NOTE for orchestrator/tool-discovery agent:** `but move` stacked my lane directly on `feat/agent-embedref-tools`, so `docs/tool-discovery-find-capabilities` (#4884) got re-homed ON TOP of my lane locally (clean rebase, NO conflicts; their REMOTE/PR is untouched — I only pushed MY branch). If #4884 next pushes with base `feat/agent-embedref-tools` its diff will include my web commit until re-homed back onto `feat/agent-embedref-tools` (or its PR base set to my branch). Snapshot `7264c6ce91` taken pre-stack. — IN PROGRESS was: **web/ ONLY**. Rebuilding Arda's #4877 FE onto the new #4860 schema: author reference tools as `type:"reference"` (NOT the dropped `@ag.reference` marker); env/variant + version selector emitting `ReferenceToolConfig` {ref_by, slug, version?, environment?, name, description, input_schema}; removing the marker-era Lexical `@`-mention editor plugin (marker authoring sugar); hiding embed from the tool UI. Files (web/ only): `web/oss/src/components/DrillInView/OSSdrillInUIProvider.tsx`, `web/packages/agenta-entity-ui/src/DrillInView/{SchemaControls/{AgentConfigControl,ToolItemControl,ToolSelectorPopover,WorkflowReferenceSelector}.tsx,index.ts}`, `web/packages/agenta-ui/src/drill-in/**`. DISJOINT from the api/sdks/services lanes (backend WS-B #4860 + tool-discovery). Will take BUT-LOCK ONLY around the rebase+commit+push of `fe-feat/agent-embedref-tools-onbig`; marketing-website/website/qa pile stays unassigned. |
| 2026-06-27 | direct-call-tools (A) | `docs/direct-call-tools` → big-agents | #4886 (draft, needs-review) | DONE — DESIGN ONLY. Draft PR #4886 carries the design docs under `projects/direct-call-tools/` (context/research/design/plan/status/README). **Design:** resolved tools carry their own call target; the sidecar calls reference/platform endpoints DIRECTLY (path absolute from the Agenta origin derived from `toolCallback.endpoint` + the run's auth), gateway stays via `/tools/call` (only the server reads the Composio secret). NO code in the PR — I reverted a runner dispatch slice I'd wrongly started; implementation is the orchestrator's to dispatch. 🔸 Decision-needed comment posted (when to remove the `/tools/call` `workflow.*` routing — recommend Workstream A, after B). **Shared file with B:** `tools/models.py` (B edits `ReferenceToolConfig`, A would add `call` to `CallbackToolSpec`) — sequenced after B. Committed ONLY my 6 docs via `but rub`+`commit --only` (`f607f031`), pushed + SHA-verified; did NOT sweep B's unassigned work or the marketing/qa scratch. **Round-2 review addressed (`473b8813`):** reference input_schema from the workflow `revision.schemas.inputs` (messages via `x-ag-type-ref`), output schemas deferred; permissions uniform across all tool types; platform-op catalog mirrors `tools.agenta.*` (#4884 `find_capabilities`) + evaluators, not `platform_catalog.py`; schema sourcing = in-process `CATALOG_TYPES` (CodeRabbit fix); decisions reframed as orchestrator sequencing (Mahmoud aligned with all). Lane was rebased by the pull-resync; round-2 committed on top, re-pushed + SHA-verified; summary comment posted. **Run-context round (`7cb0ca93`):** new `run-context.md` (how trace/workflow-variant/session reach the auto-editing tools) + Codex xhigh review. Recommendation = **Option C** (run-level `runContext` channel + server-side binding of protected fields), revised away from the static `get_run_context` tool (Codex: A is a boundary category-error; B/C keep the primitive set smaller). Security findings (own-variant binding, revision-precondition, trace integrity, `/api/annotations/` mints-new-trace gap) + `call`-descriptor SSRF guardrails added to design.md. 🔸 Decision-needed comment posted (A vs C, lean C) + inline comments, all signed AI agent, `needs-review` re-applied. **This is the context-propagation decision the orchestrator flagged as blocking implementation** — once Mahmoud picks A/C, implementation unblocks. |
| 2026-06-26 | allharness-sidecar | `feat/agent-allharness-sidecar` (parallel, base `big-agents` `329cfa00bb`; 3-dot diff = exactly 5 files) | #4880 (draft, needs-review) | DONE — pushed, DRAFT PR #4880 (base `big-agents`), `needs-review` + review-request comment posted, NOT merged. **All-harness self-host sidecar image.** NEW `services/agent/docker/Dockerfile.sidecar` + `sidecar-entrypoint.sh`: one image serving `pi_core`/`pi_agenta`/`claude` on :8765 with NO compose CMD override. `FROM` the prod runner image (reuses build, no fork); creates `/pi-agent` at build owned by `node` so the Agenta Pi extension installs without the `EACCES: mkdir /pi-agent/extensions` the sub-sidecar hits; sets `PI_CODING_AGENT_DIR=/pi-agent`, writable `HOME=/home/node`, `HOST=0.0.0.0`, `SANDBOX_AGENT_PROVIDER=local`; entrypoint seeds an optional `/pi-agent-ro` Pi login (the compose `cp -a`); extension bundle already baked in dist/ (no runtime rebuild). Claude Code baked from Anthropic behind `ARG INSTALL_CLAUDE_CODE=true` (self-host recipe; `=false` = redistribution-safe runtime-install base; licensing boundary documented in the Dockerfile header + `docker/README.md`). Local-only, NO Daytona. Docs synced: `docker/README.md` (new all-harness section), `subscription-sidecar/README.md` (cross-link to productized form), `sidecar-deployment-proposal/status.md` (log). **Verified in ISOLATION** (test container `:8791` w/ `~/.claude` mount; live `:8790` sub-sidecar + `:8280` stack UNTOUCHED; test container+images removed after): `claude`+`haiku` subscription-OAuth → ok:true ~4.3s (baked Claude used, no install delay); `pi_core`+`claude-haiku-4-5` → ok:true, NO EACCES, `/pi-agent/extensions/agenta.js` present. Staged ONLY my 5 files via `but rub`+`commit --only` (`97b95efc19`); did NOT sweep the marketing-website/qa scratch pile. Disjoint from all active lanes (infra, new files only). |
| 2026-06-26 | overnight-3fix-b | 3 standalone lanes anchored on `big-agents` (workspace base `bc87043894`; PR 3-dot diffs clean) | #4870 / #4871 / #4872 | Three disjoint small fixes, each its own lane (`but rub`+`commit --only`, NO scratch swept — left findings/board/overnight-run/marketing-website unassigned). **#4870** `overnight-3fix-f038` (F-038, SDK): `ts_runner.py` `deliver_http` now recognizes a runner *result* body (`{"ok":...}`) at any HTTP status (incl. the 500 a run-failure returns) and returns it, so the batch path (`/invoke` + `/messages` JSON) surfaces the actionable provider message via `result_from_wire` instead of a generic "HTTP 500"; non-result/non-JSON error bodies still fall through to the transport error. New `_runner_result_body` helper. **#4871** `overnight-3fix-f039` (F-039, service): `resolve_mcp_servers` FAILS LOUD (new `MCPDisabledError`, naming servers) when `AGENTA_AGENT_ENABLE_MCP` is off AND the request declared `mcp_servers`, instead of silently stripping them (empty list unchanged). **#4872** `overnight-3fix-f037` (F-037, hosting): `run.sh` fails loud on a missing resolved env file; new `recreate-web.sh` always passes `ENV_FILE` on both planes; `hosting/AGENTS.md` documents the footgun. (`.claude/skills/run-sh` edit is local-only, git-ignored.) Tests: SDK agents 392 + service agent 42 green; ruff clean; scripts `bash -n` clean. Build-image gate GREEN (ALL 8 build-image jobs api/sandbox-agent/services/web × amd64+arm64 PASS on both code PRs; ALL unit suites sdk/services/api/web/agent-runner PASS; #4872 hosting-only triggers no build/test). Disjoint from ALL active lanes. **ALL MERGED to big-agents** (squash; final tip `80b2748f56`): #4872→`050c07d138`, #4870→`32fe56e8b7`, #4871→`80b2748f56`. Only red was the Railway `setup/setup` preview-deploy ("creating projects too quickly — 1 per 30s" rate-limit from 3 concurrent PRs) = documented pre-existing non-blocking infra class, NOT a real failure; big-agents unprotected (no required checks) so no `--admin` needed. `but pull` synced local→`80b2748f56` (f038/f039 integrated+removed, empty f037 lane deleted); working tree clean of code (only scratch left unassigned). |
| 2026-06-26 | f040-park-terminal | `fix/agent-hitl-park-terminal` (anchored on `big-agents` `80760a3329`; workspace base `bc87043894`, PR 3-dot diff clean = 6 files only) | #4869 | **MERGED to big-agents** (squash `558423025e`, new tip; advanced cleanly from `80760a3329`). Build-image gate GREEN on all images (api/sandbox-agent/services/web × amd64+arm64); the api/services acceptance + Railway fails are pre-existing big-agents env (my diff touches ZERO backend `api/`/`services/oss` files; big-agents unprotected = no required checks; matches #4850 precedent). F-040 FIX: a HITL `park` now ENDS the `/run` turn gracefully instead of holding the ACP connection open forever. RUNNER + egress, DISJOINT from other lanes. `permissions.ts` adds an `onPark` callback; `sandbox_agent.ts` races `session.prompt()` against a `parkedSignal` and on park calls `sandbox.destroySession(session.id)` (the package's MANAGED cancel — resolves the pending permission `{outcome:"cancelled"}` not a reject → no F-024 clobber; sends `session/cancel` so the prompt returns), then returns `stopReason:"paused"` so the `finally` disposes the sandbox (NO leak) and the egress emits `finish`. `vercel/stream.py` maps `paused`/`cancelled`→AI-SDK `other`. Resume cold-replays (#4854 anchor): Approve completes, Deny clean denial. Point-4 FE resume already built (#4859), verified. Staged ONLY my 6 files (`sandbox_agent.ts`, `permissions.ts`, orchestration test, `stream.py`, new `test_vercel_stream_park.py`, plan doc) via `but rub`+`commit --only`; LEFT `findings.md` UNASSIGNED (QA-scratch, other lanes own it) + board + overnight-run + marketing-website. **NO golden/wire-contract change** (`stopReason` is free-form). LIVE-VERIFIED on :8280 (Claude+haiku, github tool, Ask rule, LOCAL runner, no Daytona): both parks logged `stopReason=paused`, 0 leaked sandboxes, Approve→real answer, Deny→graceful denial (not "agent run failed"), zero `unhandledRejection`/`ACP write error`/`fetch failed`. Tests: TS 270 + Python agents 387 green; ruff+prettier clean. Codex-reviewed (verdict: design right; folded 3 fixes). Restarted the :8280 runner to load the fix. |
| 2026-06-26 | overnight-3fix | 3 standalone lanes anchored on `big-agents` `bc87043894` | #4865 / #4866 / #4867 | **ALL MERGED to big-agents** (final tip `80760a3329`). Three disjoint known fixes, each its own lane (`but rub`+`commit --only`, no scratch swept). **#4867** docs/qa-run-matrix-harness-names: `run_matrix.py` harness `pi`→`pi_core`/`agenta`→`pi_agenta` + harness_options slice key + model `gpt-4o-mini`→`openai/gpt-4o-mini` (merge `e49833c3f6`). **#4865** fix/agent-chat-plain-http-crypto: `AgentChatPanel.tsx:189` `crypto.randomUUID`→`generateId()` (uuid v4, non-secure-context safe); only one such call in AgentChatSlice (merge `c59ecb4b63`); lint clean, AgentChatSlice typecheck clean. **#4866** fix/agenta-force-platform-skill (**D-016 / F-036 remainder**): `AgentaHarness` now force-injects `AGENTA_FORCED_SKILLS` via new `force_skills()` (de-dup by name, author wins) so a CUSTOM pi_agenta config dropping the default-template `@ag.embed` still carries `_agenta.agenta-getting-started`; canonical skill content moved into the SDK `agenta_builtins`, `PlatformWorkflowCatalog` imports it (one source) — merge `80760a3329`. Tests: SDK agents 397 (+3 new) + API catalog 29 + service 5 green; ruff clean; API import+resolve live-verified. Build-image gate = ESLint clean + SDK/API unit green (NO `--admin` needed; big-agents unprotected). No Daytona. Local↔remote in sync. |
| 2026-06-26 | playground-integration | `fe-feat/agent-config-panel-onbig` (Arda's PR branch; merged FORWARD with big-agents, not via GitButler lane — done in a scratch clone to avoid rebase) | #4850 | **MERGED to big-agents** (mergeCommit `4bbf6594cc`; new tip). Integrated Arda's agent playground config panel (~39 FE files, FE-only). **Merge-forward** of `big-agents` into his branch (NOT rebase, to preserve his `9eea2a1` AgentConfigControl resolution): ONE real conflict — `AgentChatPanel.tsx` import block where OUR HITL fix pass (F-026/F-033/F-036: removed `busy`/`disabled` approval gating, `agentShouldResumeAfterApproval` predicate, dev-overlay rejection guard, all in #4855/#4859) overlapped his agent-chat rewrite; `AgentMessage.tsx` auto-merged (our `busy` removal + his `RunErrorBody`/empty-turn collapse). Resolved keeping OUR HITL behavior + his UX (dropped the dead `lastAssistantMessageIsComplete...` + unused `Alert` imports). **R1 reconciliation** commit: re-keyed `HarnessSelectControl` `HARNESS_META` to `pi_core`/`pi_agenta`/`claude` + prefer the schema `oneOf` titles (`Pi`/`Pi (Agenta)`/`Claude Code`). Merged HEAD vs big-agents = purely 39 web/ files (backend byte-identical → CI acceptance/Railway FAILs are pre-existing big-agents env, NOT from #4850; all unit/lint/format PASS; big-agents unprotected = no required checks). **Live QA on :8280 (all in-scope plan.md cells PASS):** create-from-home drawer renders the agent chat (not blank), harness labels correct (R1), model catalog populated per-harness, Connection/ModelRef ride the wire, **custom client-tool run emits `{type:"client",...}` and does NOT 500**, permission_policy Claude-only, end-to-end Pi+gpt-4o-mini run streams, non-agent completion playground unregressed. **NOTES (not blockers):** generative-UI/render tools = NOT a feature in #4850 (no render tool-type; standard `tool-*`/`dynamic-tool` rendering only) — out of scope, not a regression; gateway-connections popover dark (needs #4749); Claude run blocked on out-of-credit Anthropic vault key (subscription sidecar :8790 fine). entity-ui 126 + playground 133 tests green; tsc/eslint clean on touched files. Local↔remote in sync via fetch. Did NOT use Daytona; no sandbox left open. Workspace restored (overlaid Arda's FE for live QA, then reverted all web/ to HEAD). |
| 2026-06-25 | embedref-tools | `feat/agent-embedref-tools` (anchored on `big-agents` tip `10f4af8b5f`, standalone) | #4860 (needs-review) | DONE — pushed (commit `bfe94c026a`), PR #4860 (base `big-agents`), review-ask + `@coderabbitai review` posted, `needs-review` labeled, NOT merged (CTO/JP review). Implemented the `@ag.reference` reference half of the lgtm'd embedref-tools two-syntax design (#4837): an agent `tools[]` entry can point at a workflow via `@ag.reference` (keep the reference → server-side `callback` tool that runs the workflow revision) or `@ag.embed` (inline a `client` tool value). **SDK:** `AG_REFERENCE_MARKER`+`ReferenceToolConfig` (`type:"reference"`, `call_ref` `workflow.{slug}[.{version}]`) in `tools/models.py`; `compat.py` coerces the kept marker; new `WorkflowToolResolver` port + `AgentaWorkflowToolResolver` (`platform/workflow.py`) → `CallbackToolSpec`+shared `ToolCallback`; `ToolResolver` partitions+reconciles the single callback with gateway; `_ToolEmbedRefSchema`+`_ToolReferenceSchema` arms on `AgentConfigSchema.tools`. **API:** `AG_REFERENCE_KEY` "leave it" guard in all 3 `core/embeds/utils.py` finders; `/tools/call` routes a `workflow.*` call_ref to new `_call_workflow_tool`→`WorkflowsService.invoke_workflow` (`ToolsRouter` wired with `workflows_service` in `entrypoints/routers.py`). **NO `/run` wire change** (reference rides as `callback`, embed as `client`; golden+wire-contract UNCHANGED), **no new runner kind** (runner forwards `callRef` opaquely; `services/agent` untouched). Generic resolver stays tool-agnostic; all tool mapping in `resolve_tools`. Staged ONLY my 24 files via `but rub`+`commit --only` (did NOT sweep the `sandbox`→`uri` WIP in `dtos.py`/`test_dtos_agent_config.py` — other lane's, first-committer-owns — nor the landing-page/husky unassigned files). **GOTCHA:** `embedref-tools/status.md` could NOT be committed to the lane (GitButler contended-file quirk + the file isn't on `big-agents` base yet — it lives in the unmerged project-docs set); left as a working-tree doc (preserved at workspace HEAD), matching documented precedent. Tests: SDK agents 393 + catalog; API embeds+tools 121+14 new; ruff clean. Live E2E DEFERRED to dedicated embedref live QA (did NOT touch/restart the :8280 gate runner). FE client-tool exec path is #4850 (composes). |
| 2026-06-25 | low-backend-findings | `fix/agent-low-backend-findings` (anchored on `big-agents` tip 6324757e86, standalone) | #4858 (needs-review) | DONE — pushed (commit `2d3327a99e`), PR #4858 (base `big-agents`), review-ask + `@coderabbitai review` posted, NOT merged. Fixed 4 LOW-severity backend findings (DISJOINT from HITL-FE/Daytona/tracing lanes; runner+SDK+docs only). **LOW-5:** `ts_runner.py` `_runner_auth_headers()` reads `AGENTA_AGENT_RUNNER_TOKEN` (same env the runner's `server.ts` gate uses) and sends `Authorization: Bearer` on `deliver_http`/`deliver_http_stream` when set — closes the one-sided footgun (gate on → service 401'd); unset = no header. **LOW-6:** `run-plan.ts` `buildRunPlan` treats omitted `enforcement` as strict (`!== "best_effort"`), matching `WireSandboxPermission` default; live path unchanged (service fills strict). **LOW-7:** removed the dead `prompt` field from `protocol.ts` `AgentRunRequest` + its `resolvePromptText` branch (producer never emits it; `messages` is the only turn channel). **Golden + both wire-contract tests UNCHANGED.** F-028: matrix rule-4 + rows corrected (skills valid on `pi`, not n/a). Staged ONLY my 11 files (7 code/test + 4 docs) via `but rub`+`commit --only`; did NOT sweep the QA scratch — `final-sweep-decisions.md` (D-018..D-021) left UNASSIGNED, QA-scratch-owned. Converted ~38 runner test fixtures `prompt:`→`messages:` (otel `start({prompt})` is a separate inline type, untouched). Tests: SDK agents 366 + 7 new transport-auth + roundtrip 4; runner 268 vitest + tsc; ruff clean. |
| 2026-06-25 | f036-tracing-namespace | `fix/agent-tracing-namespace` (anchored on `big-agents` tip `6324757e86`, standalone) | #4857 (needs-review) | DONE — pushed (commit `639465ecb3`), PR #4857 (base `big-agents`), READY, review-ask + `@coderabbitai review` posted, `needs-review` labeled, NOT merged. Fixed the F-036 namespace wrinkle on the Wave-1 tracing fix (#4855). RUNNER-ONLY, DISJOINT from the HITL/Daytona/MCP/backend lanes — touched ONLY `services/agent/src/tracing/otel.ts` + its test. **Namespace fix:** `ag.agent.skills.{loaded,count}` -> `ag.meta.skills.{loaded,count}` and `ag.error.{message,provider}` -> `ag.exception.{message,provider}`, so the attrs land under recognized free-form `ag.*` buckets instead of being demoted to `ag.unsupported.*` by `initialize_ag_attributes` (strict top-level whitelist). NO api/SDK schema change (both buckets pass ingest untouched). **Builtins-in-loaded:** REPORTED not fixed — the runner faithfully stamps `request.skills`; the forced `_agenta.*` skill is embedded only in the DEFAULT config template (`schemas.py`), so a CUSTOM config drops it and it never reaches the wire; force-injecting it for `pi_agenta` is a server-side seeding workstream outside `otel.ts`. Supersedes D-011's wrong assumption. Decisions D-015/D-016 appended to `qa/final-sweep-decisions.md` (left UNASSIGNED, QA-scratch-owned); F-036 findings rows updated (unassigned). Did NOT restart the live runner. Tests: runner 268 vitest (was 265) + `tsc` green; prettier clean. **NO `/run` wire change.** |
| 2026-06-25 | daytona-sandbox-leak | `fix/agent-daytona-sandbox-leak` (anchored on `big-agents` tip `6324757e86`, standalone) | #4856 (needs-review) | DONE — pushed (commit `402fdcbb83`), PR #4856 (base `big-agents`), review-ask + `@coderabbitai review` posted, NOT merged. Fixed the Daytona sandbox leak (credit-burner; 10 found leaked). RUNNER-ONLY, DISJOINT from the HITL/tracing/MCP lanes — touched ONLY my 4 code/test files + 1 doc + the QA decisions log. **TTL backstop (`provider.ts`):** Daytona create object sets a non-zero `autoStopInterval` (new env `SANDBOX_AGENT_DAYTONA_AUTOSTOP_MINUTES`, default 15 min, clamped `>=1`) next to `ephemeral:true`; the SDK wrapper hardcodes `autoStopInterval:0` (auto-stop OFF) but spreads our create AFTER it so ours wins → idle leaked sandbox stops, ephemeral auto-delete fires, self-reaps. Extracted `buildDaytonaCreate` for testability. **Signal handler (`server.ts`):** `registerShutdownHandler` deletes in-flight sandbox(es) on SIGTERM/SIGINT before exit, timeout-bounded (5s race) + idempotent. **Registry (`sandbox_agent.ts`):** `destroyInFlightSandboxes` + a module-level Set; register after `startSandboxAgent`, delete in `finally`. Resources (cpu/mem/disk) untouched (snapshot-baked). **NO `/run` wire change.** Decision D-014 appended to `qa/final-sweep-decisions.md` (left UNASSIGNED, QA-scratch-owned). Did NOT restart the live runner. Tests: runner 265 vitest + `tsc` green; prettier clean. |
| 2026-06-25 | sdk-tracing-findings | `fix/agent-sdk-tracing-findings` (anchored on `big-agents` tip cb9de4c48a, standalone) | #4855 (needs-review) | DONE — pushed (commit `3a5124402a`), PR #4855 (base `big-agents`), READY, review-ask + `@coderabbitai review` posted, NOT merged. Fixed QA F-031/F-029/F-030 + the Codex error-leak finding (SDK + runner tracing only; DISJOINT from the HITL/MCP lanes). **F-031 (Claude alias):** `platform/connections.py` `_inferred_claude_provider` resolves a bare Claude alias (`haiku`/`sonnet`/`opus`+`[1m]`, reused from `capabilities.py CLAUDE_MODEL_ALIASES`) or a dated `claude-*` id to `anthropic` BEFORE the F-017 fail-loud check (so the documented `model:"haiku"` reaches auth like `anthropic/haiku`); `MissingProviderError(hint_provider=...)` names the harness-reachable provider (`anthropic/` on Claude, `openai/` else), threaded from `RuntimeAuthContext.harness`. **F-029 (skills in trace):** agent span carries `ag.agent.skills.loaded`/`.count` w/ materialized names (author + forced `_agenta.*`) — `createSandboxAgentOtel` for Claude/Daytona, local Pi via new `AGENTA_SKILLS_LOADED` env on Pi's own span (`createAgentaOtel`). **F-030 (error on span):** new `recordError(message,provider)` stamps `ag.error.message`/`ag.error.provider`/exception event/ERROR status before flush (catch + swallowed-Pi paths); local Pi emits a standalone `agent_error` span under the traceparent. **Error sanitize (Codex):** `wire.result_from_wire` + `ts_runner` transport errors route through `sanitize_runner_error`/`_transport_error` (one clean line, stack/path stripped, 300-char cap, full detail LOGGED not shown); `conciseError` untouched. **NO `/run` wire change** (skills ride internal env; golden unchanged). Carried the MCP lane's handed-off `isDaytona: plan.isDaytona` hunk in `sandbox_agent.ts` (first-committer-owns). Staged ONLY my 13 files via `but rub`+`commit --only`; did NOT sweep the QA scratch (findings/matrix/runs/final-sweep-decisions left UNASSIGNED). Decisions D-009..D-012 appended to `final-sweep-decisions.md`. Tests: SDK agents 357 + integration 4, runner 248 vitest + `tsc`, ruff clean. Live trace re-verify = orchestrator's. |
| 2026-06-25 | mcp-findings-fixes | `fix/agent-mcp-findings` (anchored on `big-agents` tip cb9de4c48a, standalone) | (opening) | IN PROGRESS — fixing 3 MCP findings, runner-only. **F1 (Daytona loopback):** `buildSessionMcpServers` takes `isDaytona` and SKIPS the internal loopback HTTP gateway-tool channel on Daytona (URL unreachable from the in-sandbox harness); tools delivered via the existing file relay; user http MCP still delivered. **F2 (F-032 Pi user-MCP silent drop):** new `PI_USER_MCP_UNSUPPORTED_MESSAGE` + a `run-plan.ts` up-front gate refusing ANY user MCP (stdio AND http) on Pi (fail loud, before the stdio gate). **F3 (SSRF):** `validateUserMcpUrl` in `mcp.ts` — require https, reject internal/metadata hosts (loopback/169.254/private), opt-out via `AGENTA_AGENT_MCP_HOST_ALLOWLIST`. Staging ONLY my 8 files: `mcp.ts`, `run-plan.ts`, `mcp-bridge.ts`, 3 unit tests (`session-mcp-layering`/`mcp-servers`/`sandbox-agent-run-plan`), 2 inventory docs (`runner-to-mcp-server.md`/`mcp-models-and-resolution.md`). **HAND-OFF: `services/agent/src/engines/sandbox_agent.ts` carries my 3-line `isDaytona: plan.isDaytona` engine hunk BUT is dominated by a concurrent F-029/F-030 lane's WIP (`skills:`-on-span x2, `recordError` refactor) + foreign `otel.ts`/`responder.ts`/`pi-assets.ts`/`responder.test.ts` — I did NOT commit that file; first-committer-owns carries my hunk.** Decisions D-004/D-005/D-006 appended to `qa/final-sweep-decisions.md` (left UNASSIGNED, QA-scratch-owned). Tests: 222 vitest green excluding `sandbox-agent-orchestration.test.ts` (fails ONLY on the foreign uncommitted `otel.recordError` WIP, not my change); typecheck error is the same foreign otel.ts WIP. |
| 2026-06-25 | skills-system-review-fixes | `fix/agent-skills-system-review` (anchored on `big-agents`, standalone) | #4851 (needs-review) | DONE — pushed, PR #4851 (base `big-agents`), READY, changes-made comment + `@coderabbitai review` posted, NOT merged. Fixed skills-system review findings 1/3/4/6 (finding 2 already covered by existing `sandbox-agent-workspace.test.ts` Claude skill-install tests; finding 5 is a QA check, out of scope). **F1 (delete):** removed the orphan `services/agent/skills/agenta-getting-started/SKILL.md` (grep-confirmed dead; live source is `platform_catalog.py` `_GETTING_STARTED_BODY`). **F3 (golden):** added a `skills` block to `run_request.claude.json` + Python (`test_wire_contract.py`) and TS (`wire-contract.test.ts`) assertions so Claude-carries-skills is pinned. **F4 (comment):** reconciled the overclaiming `AGENTA_FORCED_TOOLS` comment in `agenta_builtins.py` (runner never reads `request.tools`; Pi gets read/bash from DEFAULTS); deferred wiring forced builtins over the wire. **F6 (test):** new runner test pins the hyphenated `disable-model-invocation:` key, rejects camel/snake spellings. Staged ONLY my 6 files via `but rub`+`commit --only` (commit `9b24931b32`); did NOT sweep the QA scratch (findings/matrix/runs/STATUS/final-sweep-decisions/board). Decisions D-001/D-002 appended to `qa/final-sweep-decisions.md` (left UNASSIGNED, QA-scratch-owned). **GOTCHA: the deleted SKILL.md resurrected on disk after push (documented GitButler quirk) — `rm`'d again; the pushed commit + remote tree confirm the deletion stuck.** Tests: runner 226 vitest + typecheck; SDK agents 348 + API platform-catalog 29; ruff clean. |
| 2026-06-25 | hitl-park-codetool-fixes | `feat/agent-hitl-park-codetool-failloud` (STACKED on `feat/agent-gateway-tool-mcp`, the top of the runner stack) | NONE YET — committed locally, sync deferred to the orchestrator | IMPLEMENTED + TESTED + COMMITTED LOCALLY (commit `df11d68d95`, 10 code/test files); NOT pushed, NO PR. **FIX 1 (HITL park, F-024):** added a third responder outcome `park` (`ResponderOutcome` in `responder.ts`); `HITLResponder` returns `park` on a human surface w/ no stored decision (was `deny`); `attachPermissionResponder` (`permissions.ts`) sends NO `respondPermission` on park, so the `interaction_request` stays the last word on the tool call and the turn ends w/ the tool PENDING (Claude `reject`→failed-tool-call clobber eliminated). `decisionToReply` reached only for allow/deny. Resume path unchanged. **NO wire change** (golden + wire-contract green). **Pi-1:** `AgentConfigControl.tsx` hides the Permission policy field for Pi (`pi_core`/`pi_agenta`, never gates). **FIX 2 (code-tool fail-loud, F-016):** `buildRunPlan` (`run-plan.ts` `hasCodeTool`) refuses a run carrying a `kind:code` tool up front w/ `CODE_TOOL_UNSUPPORTED_MESSAGE` (`ok:false`), like the stdio-MCP gate; the per-call `runCodeTool` throw stays as a backstop. **Verified live (FIX 2):** runner CLI w/ a code tool → `{"ok":false,"error":"Code tools are not supported by the sidecar."}`, exit 1 (was a 200/laundered reply). **FIX 1 live click-through DEFERRED** to runner-consolidation QA (needs a working Anthropic key; local has only Claude-Code OAuth, not api-key; mechanism proven by tests). Tests: 221 vitest + typecheck; 348 SDK agent tests; SDK egress test locks "park does not clobber"; wire-contract green. Staged ONLY my 10 files via `but rub`+`commit --only` (did NOT sweep QA-run JSONs / STATUS.md / merge-queue.md / this board). **GOTCHA: `hitl-fix/status.md` could not be committed by GitButler ("no changes"/persistently re-staged, a contended-file quirk) — left as an uncommitted working-tree doc for the consolidation; the 10 code/test files are the deliverable.** **PUSH/PR DEFERRED:** stacks on `feat/agent-gateway-tool-mcp` (itself committed-locally, sync-deferred) over the 3 local-diverged runner lanes — pushing needs force-pushing diverged parents (the "hairy stacking" the task said to STOP on). Orchestrator to fold into the runner-branch consolidation. |
| 2026-06-25 | qa-findings-batch | `fix/agent-qa-findings-batch` (anchored on `big-agents`, standalone) | #4846 (needs-review) | DONE — pushed, PR #4846 (base `big-agents`), NOT merged. Fixed QA F-017/F-018/F-020/F-025 (none touch `services/agent`). **F-017** (fix): new `MissingProviderError` — a bare model id (no `provider/` prefix) matching no vault candidate now fails loud with "needs a provider prefix" instead of degrading to no-credential + a misleading "add your key" auth error; provider inference preserved for the clean (matched-candidate) case; re-raised in `app.py` even on default connection. **F-025** (fix): keyed agent-chat parts by `${message.id}-${i}` in `AgentMessage.tsx` (was bare index → 1143 dup-key warnings). **F-018** (doc): E4 = SDK-direct over `SandboxAgentBackend`, `LocalBackend` is a stub — corrected in `qa/README.md`. **F-020** (assessed): dev-stack quirk not a product bug (same-origin API fallback already exists; dev compose pins the public URL to the box IP). Commit `ec05188135`, 11 files: SDK connections (errors/`__init__`/models/platform connections) + tests, `services/oss/src/agent/app.py` + invoke-handler test, `web/.../AgentMessage.tsx`, `qa/README.md`, `provider-model-auth/design.md`. Tests: SDK agents 347, service-agent 48, eslint clean. **GOTCHA HIT:** GitButler hunk engine repeatedly refused to commit `findings.md`/`matrix.md` (concurrent QA agent owns them) — silent empty commits; a bare `but absorb` misrouted findings.md into the gateway-tool-mcp lane's commit; recovered via `but oplog restore` (no toml surgery, no worktree). Those 2 docs (finding statuses + matrix F-018 wording) are EDITED in the working tree but UNCOMMITTED — first-committer-owns, will ride the QA agent's lane. |
| 2026-06-25 | hitl-fix-design | `docs/hitl-fix` (anchored on `big-agents`, standalone, NOT stacked) | #4845 (needs-review) | DESIGN ONLY, NOT merged. Root-caused F-024 (Claude HITL approve/deny never appears). Found it across 4 layers: renderer (`ToolPart.tsx`), egress (`stream.py` `tool-approval-request`), and cross-turn resume (`HITLResponder`+`extractApprovalDecisions`) are ALL correct; the break is ONE runner reply — `attachPermissionResponder` parks an `ask` gate by replying `reject` to the harness (`HITLResponder` returns `deny`→`decisionToReply`→`reject`), and Claude turns `reject` into a failed tool call ("User refused permission") that `maybeCloseTool` (`tracing/otel.ts`) records as `tool_result{isError}`, which the egress projects as `tool-output-error` on the SAME `toolCallId`, OVERWRITING the `approval-requested` part. Fix = park WITHOUT `reject` (internal `park` outcome; no wire change). Pi: `permissions:false`, never gates → recommend hiding `ask` for Pi now (Pi-1) + relay-enforcement follow-up (Pi-2 = open-issues S5.2). Docs at `projects/hitl-fix/` (5 files). Posted 🔸 Decision-needed (park A-vs-B; Pi-1-vs-Pi-2). Committed ONLY my 5 hitl-fix docs via `but rub`+`commit --only` (`32a14a3e28`); left `findings.md`/`matrix.md` (concurrent QA agent) + this board untouched in unassigned. |
| 2026-06-25 | gateway-tool-mcp | `feat/agent-gateway-tool-mcp` (STACKED on `feat/agent-capability-fail-loud` #4838, top of the runner stack) | NONE YET — committed locally, sync deferred to the orchestrator | IMPLEMENTED + TESTED + COMMITTED LOCALLY (commit `71c9f31c01`, 17 files); NOT pushed, NO PR. Restored the INTERNAL gateway-tool MCP channel #4831 killed as collateral (Claude+gateway hard-failed at `buildToolMcpServers` throw). NEW `tools/tool-mcp-http.ts` = loopback HTTP MCP server (stateless JSON Streamable-HTTP, no runner-host child) feeding the existing relay; `buildToolMcpServers` returns one ACP `type:"http"` `agenta-tools` entry; renamed user constant → `USER_MCP_UNSUPPORTED_MESSAGE`; `buildSessionMcpServers` async `{servers,close}` w/ do-not-merge layering note; engine closes the port in `finally`. User stdio MCP stays disabled, user http unchanged. NO wire/SDK/protocol/golden change. Tests: 220 vitest + typecheck green (live HTTP round-trip + relay proof, NEW `session-mcp-layering.test.ts` regression guard, orchestration test re-targeted). Docs synced (runner-to-mcp-server, mcp-models-and-resolution, claude-code adapter, ground-truth, tools, interfaces README, sidecar-trust README narrowed-disable note). My `status.md` edit absorbed into the plan lane `38805c1a31` (first-committer-owns). **PUSH/PR DEFERRED:** the 3 lower runner lanes (`feat/agent-capability-fail-loud`, `docs/agent-http-mcp-transport-plan`, `docs/sidecar-trust-and-sandbox-enforcement`) are all LOCAL-DIVERGED from origin (rebased not pushed; e.g. capability-fail-loud 19 ahead/10 behind). Pushing my lane needs force-pushing those parents — exactly the "hairy stacking" the task said to STOP on. Orchestrator to fold this into the coordinated runner-branch consolidation. **Live-verified on :8280 (pi-agents project):** Claude+github-gateway → runner log `internal tool MCP server on http://127.0.0.1:<port>/mcp serving 1 tool(s)` (DELIVERED), run then fails only at `claude: model authentication failed` (Anthropic credit/key env blocker), NOT the old MCP-unsupported throw = regression fixed. Pi_core+same gateway tool → returned real login `mmabrouk` (unguessable proof the resolve→relay→/tools/call chain works server-side). Claude-actually-calls-the-tool cell still BLOCKED on a working Anthropic credential. |
| 2026-06-25 | agent-model-picker-fix | `feat/agent-model-picker` #4839 + `docs/sidecar-trust-and-sandbox-enforcement` #4831 | #4839 #4831 | DONE — fixed the EMPTY model picker + the STREAM ERROR; verified live on :8280; NOT merged. **Empty picker (#4839, commit `673b178736`, 5 files):** `/inspect` carried no `meta.harness_capabilities` on the playground's revision-driven path — `inspect_workflow(request)` builds a fresh workflow with empty meta and never reads the routed instance's meta; `WorkflowRevisionData` has no meta field so the interface registry couldn't carry it. Added `META_REGISTRY`+`register_meta`/`retrieve_meta` (mirrors interface registry) in `engines/running/utils.py`; `workflow.inspect()` merges registered meta (request wins per key) in `decorators/running.py`; `app.py` calls `register_meta`. FE: `workflow/state/store.ts` inspect atom now fetches for the agent even with inline schemas (gated on builtin agent URI; `is_agent` flag not reliably stored). +regression test in `test_builtin_uri_binding.py`. Verified: Pi → 8 providers w/ models, Claude → Anthropic only. **Stream error (#4831, commit `f0225cab45`, 3 compose files):** #4831's sidecar-trust bind default `127.0.0.1` is unreachable cross-container in compose → "All connection attempts failed" on every run; healthcheck (127.0.0.1 in-container) masked it. Set `AGENTA_AGENT_RUNNER_HOST=0.0.0.0` on `sandbox-agent` in EE-dev/OSS-dev/OSS-gh compose; verified chat streams. **GOTCHA HIT + recovered: stale `but mark` on `feat/agent-capability-fail-loud` hijacked every `but rub`/`stage`; recovered via `but mark --delete` + unstage-to-unassigned + restage by fresh cliId.** Tests: SDK 349, services-agent 47 (incl new), FE entities typecheck+39 files; ruff+eslint clean; Codex xhigh reviewed the meta seam. **DEFERRED to follow-up (own the playground): (1) #4836 sandbox/uri rework — coordinator's resolved design = restore local/daytona selector, FE builds composite URI {mode,url} (url hardcoded for dev), routing derives mode+url, prod = env-var; substantial revert of #4836's owned files, NOT done. (2) #4839 connection-picker rework (drop user-facing "Project default", inline add-provider) = open question on the PR.** |
| 2026-06-25 | crypto-uuid-fix | `fix/agent-chat-crypto-uuid` | #4842 | DONE — 1-line fix only: replaced `crypto.randomUUID()` with `generateId()` from `@agenta/shared/utils` in `AgentChatSlice/state/sessions.ts`. Standalone lane based on `big-agents` (NOT stacked on agent-workflows lanes). Committed single file via `but rub`+`but commit --only`. Lint clean (11/11). PR #4842 READY + `@coderabbitai review` posted. NOT merged to big-agents. |
| 2026-06-25 | coderabbit-fixes | `feat/agent-config-structure-cleanup` #4840 / `refactor/agent-harness-rename` #4833 / `feat/agent-wire-contract-schema-plan` #4830 | #4840 #4833 #4830 | DONE — applied CodeRabbit's SUBSTANTIVE findings across the stack (POC: skipped style/back-compat/doc nitpicks), bottom-up so GitButler auto-restacked descendants. **#4833** (`8aa3c9005d`→ commit `3cb0a64c21`): removed stale `engines/pi.ts` reference in `skills.ts` comment (in-process engine deleted). Bottom of stack → restacked the ENTIRE agent stack cleanly (no tangle). **#4840** (`8aa3c9005d`): `_parse_harness_kwargs` now honors an explicit empty `{}` (clears inherited per-harness opts) vs absent (defaults); FE `transport.ts`/`agentRequest.ts` strip legacy top-level run-selection keys (`harness`/`sandbox`/`permission_policy`) when nested `agent` present so only one wire shape emits. +2 regression tests. **#4830** (`45bb1c25ec`): `_to_inspect_response` now preserves `configuration` (`{parameters:...}`) so the resolved config isn't dropped at the `/inspect` boundary; +2 test assertions. Skipped the store.ts `interface?.schemas` back-compat finding (POC, CodeRabbit AGREED + withdrew). **#4831/#4838/#4836**: no substantive findings (4831/4836 = design-doc / already-correct-code acks; 4838 = zero inline comments). All replies posted; CodeRabbit acked + withdrew its #4830/#4831 comments. Recovery: hit the documented stale-`but mark` hijack on EVERY stage (routed to `feat/agent-capability-fail-loud`); recovered each via commit-to-that-lane-`--only`-then-`but rub <commit> <right-lane>`. All 10 stack lanes verified in-sync after force-pushing restacked descendants. Tests: SDK inspect 4 / dtos 21 / wire 20, services/agent skills 13 + typecheck, FE playground agentRequest 20; ruff/prettier clean. NOT merged to big-agents. |
| 2026-06-25 | agent-config-structure-cleanup | `feat/agent-config-structure-cleanup` (STACKED on `feat/agent-model-picker` #4839) | #4840 | DONE — pushed (`41e2811b76`), PR #4840 (base `feat/agent-model-picker`), READY, changes-made comment + `@coderabbitai review` posted, NOT merged to big-agents. #4821 comments 2/7/8: COLLAPSED run-selection (`harness`/`sandbox`/`permission_policy`) from the separate `RunSelection` DTO INTO `AgentConfig` (one agent def, under `data.parameters.agent`); RETIRED `RunSelection` (export gone from `agents/__init__` + top-level `agenta`); RENAMED `harness_options`->`harness_kwargs`. `services/oss/src/agent/app.py` reads the trio off `agent_config` (`select_backend(agent_config)`). FE `agentRequest.ts`/`transport.ts` default harness/sandbox INSIDE `parameters.agent`; `AgentConfigControl.tsx`/`ClaudePermissionsControl.tsx` use `harness_kwargs`. **WIRE UNCHANGED** (harness/sandbox via `request_to_wire` args + `wire_tools`; golden fixtures untouched). 33 files. Did NOT touch `services/agent/**` (sibling HTTP-MCP active — `protocol.ts:354` harness_options comment DEFERRED to runner); left `sandbox` in place for the sidecar-uri-config sibling to swap to `uri` next. **GOTCHA HIT + recovered: same stale-`but mark` hijack as http-mcp/model-picker — every `but stage`/`rub`/`mark <my-lane>`/branch-reassign routed to `feat/agent-capability-fail-loud`; `--delete` didn't stick. Recovered via commit-the-(100%-mine-33-file)-group to that lane `--only` then `but rub <commit> <my-lane>` (move); capability lane verified = its own commits only.** Tests: SDK 342, service-agent 38, FE playground 121 (+1 new) / entity-ui 126; ruff+prettier+eslint clean; Codex xhigh reviewed. |
| 2026-06-25 | http-mcp-transport | `docs/agent-http-mcp-transport-plan` (STACKED on `docs/sidecar-trust-and-sandbox-enforcement` #4831) | #4834 | DONE — pushed (`3f7af3902c`), PR #4834 base set to `docs/sidecar-trust-and-sandbox-enforcement`, retitled + body rewritten as the impl, READY, changes-made comment + `@coderabbitai review` posted, NOT merged to big-agents. **Runner-only**: ENABLED HTTP (remote) MCP transport while KEEPING stdio MCP disabled (#4831). `services/agent/src/engines/sandbox_agent/mcp.ts` `toAcpMcpServers` now delivers `transport:"http"` (+url) as the ACP `McpServer` `type:"http"` variant (`{name,url,headers}`), routing each resolved `env` entry into an HTTP request header. The resolved secret already rides the `/run` wire under `env` (SDK resolver merges named secrets into `env` for both transports), so **NO SDK / protocol.ts / golden-fixture change** (plan Slices 1-2 did NOT land — narrower than plan option B). `transport:"stdio"` still throws `MCP_UNSUPPORTED_MESSAGE`; `run-plan.ts` still refuses stdio MCP. 8 files: `mcp.ts` + `run-plan.ts` (comment) + `mcp-servers.test.ts` (5 tests) + 4 docs (runner-to-mcp-server, mcp-models-and-resolution, public-edge agent-config-schema, sidecar enforcement matrix http-enabled row) + http-mcp-transport status. **GOTCHA HIT + recovered: the stale-`but mark` staging hijack — `but stage <file> ht` and `but rub <hunk> ht` BOTH ignored the explicit target and staged to `feat/agent-capability-fail-loud`; `but mark <lane/commit> --delete` did NOT release it, so I committed the group to that lane with `--only` then `but move`d the commit to my `ht` lane (capability lane verified clean = its 1 own commit).** Did NOT touch `sdks/python/**` or `web/**` (agent-model-picker owns those). services/agent: 184 tests + typecheck green; prettier clean. |
| 2026-06-25 | agent-model-picker | `feat/agent-model-picker` (STACKED on `feat/agent-wire-contract-schema-plan` #4830) | #4839 | DONE — pushed, PR #4839 (base #4830), READY, changes-made comment + `@coderabbitai review` posted, NOT merged to big-agents. Implemented the agent-model-picker project A-E. **Phase A** (`sdks/python/agenta/sdk/agents/capabilities.py`): `models` map on `HarnessConnectionCapabilities` + `CLAUDE_MODEL_ALIASES` + `_pi_models()`; emitted on `/inspect` meta; contract test extended. NOT a /run wire change. **Phases B-D** (`web/packages/agenta-entities` new `workflow/state/inspectMeta.ts` `harnessCapabilitiesAtomFamily`; `web/packages/agenta-entity-ui` `connectionUtils.ts` + `AgentConfigControl.tsx`): retired the static FE capability map, harness-filtered unified provider+model picker (sets both), removed standalone Provider field, Authentication toggle + vault-fed connection picker; **model is ALWAYS a ModelRef** (#4821 c3469645457). Docs synced (inspect inventory + agent-configuration). Commit `0e7f4f7c33` = my 15 files only. **GOTCHA HIT + recovered: the stale-`but mark` staging hijack (documented by A2 above) auto-staged my files to `feat/agent-capability-fail-loud`; `but mark --delete`/`unmark` did NOT release the existing assignment, so I committed the staged group to that lane then `but move`d the commit to my lane. Both lanes verified clean (capability lane keeps its 6 runner files; my lane = my 15).** Did NOT touch `services/agent/**`, `workflow/api/api.ts`, `workflow/state/store.ts`, `wire*.py`, `models/workflows.py`, CATALOG_TYPES. Tests: SDK connections 50, entity-ui 126 (connectionUtils 24), entities/entity-ui/playground typecheck green; ruff + prettier + eslint clean. |
| 2026-06-24 | wire-contract-schema-impl (A2) | `feat/agent-wire-contract-schema-plan` (STACKED on `feat/agent-contract-versioning-docs` #4829) | #4830 | DONE — implemented the plan on this branch (commit `275b2cc4`), pushed `-f`, PR #4830 base set to `feat/agent-contract-versioning-docs`, retitled + body rewritten as the impl, marked READY, changes-made comment posted, NOT merged to big-agents. Pydantic wire models (`sdks/python/agenta/sdk/agents/wire_models.py`) = the schema source; exported into the SDK via `CATALOG_TYPES` (`run_request`/`run_result`). NO runtime validation (`wire.py` stays the dict producer + a docstring pointer). Issue 1: canonical `WorkflowInspectResponse` in `models/workflows.py` + `handle_inspect_success` normalizer + 3 `/inspect` routes' `response_model` + FE `api.ts`/`store.ts` read; Issue 4: typed `/inspect` outputs keyed per surface in `services/oss/src/agent/schemas.py`. Staged ONLY my 12 files via `but stage <file> wi` + `but commit --only`. **GOTCHA hit + fixed: a STALE auto-stage `but mark` on `docs/sidecar-trust-and-sandbox-enforcement` was hijacking ALL staging to that lane (ignored my explicit branch arg); `but mark <lane> --delete` cleared it and staging then honored the target.** Did NOT touch `.husky/*`, the runner `services/agent/*` tests/files, `architecture-followups.md`, the board (left unassigned), or sibling docs. Tests green: SDK agents 342, service-agent 38, FE entities unit. ruff + prettier clean. |
| 2026-06-24 | contract-versioning-revise (A1) | `feat/agent-contract-versioning-docs` | #4829 | DONE — committed `9bfc955bb1` + pushed (PR #4829 updated). Revised the contract-versioning README per author inline comments: cut the migration plan + the upcasting-adapter scheme; replaced `contractVersion` with the existing evaluator string-version + if/elif dispatch convention (`handlers.py` `auto_ai_critique_v0`); made the contract/harness identity a versioned slug like `agenta:builtin:agent:v0` (`interfaces.py`); framed as preproduction (no back-compat, rename just landed). DOCS-ONLY single file; staged ONLY `projects/contract-versioning/README.md` with `but rub` + `but commit --only`. Did NOT touch the other unassigned changes (interfaces/README.md, harness-rename/status.md, wire-contract-schema/README.md, the code files). All `[[...]]` markers removed. |
| 2026-06-24 | contract-versioning-impl | `feat/agent-contract-versioning-docs` (STACKED on `refactor/agent-harness-rename` #4833) | #4829 | DONE — implemented the POC slice on commit `e68500a0f5` + pushed; PR #4829 base set to `refactor/agent-harness-rename` (via `gh api PATCH` workaround), marked READY (not draft), NOT merged to big-agents. (1) Harness slug+name in the interface ONLY: `HARNESS_IDENTITIES` in `agents/dtos.py` (slug `agenta:harness:<value>:v0` + display name); `AgentConfigSchema.harness` emits `enum` + `oneOf{const,title,x-ag-harness-slug}`; FE `EnumSelectControl` reads the oneOf. Wire value stays bare → `protocol.ts`/`wire.py`/golden/wire tests UNCHANGED. (2) Issue 2: `create_agent_app()` binds `agenta:builtin:agent:v0` (instrument→register_handler + new `register_interface` override); fixed stale `CONFIGURATION_REGISTRY` agent entry to `{"agent": build_agent_v0_default()}`. Deferred (per spec): /run `version`, if/elif dispatch, /health skew read. Codex-reviewed (xhigh). Staged ONLY my 18 files via `but rub`+`but commit --only`; did NOT sweep `.husky/*`, `architecture-followups.md`, `agent-model-picker/*`, `sidecar-uri-config/*`, this board, or scratch files. Tests green: SDK 945, service-agent 38, wire Py 20 + TS 160, FE entity-ui 23 + playground 26. |
| 2026-06-24 | catalog-refs-test | `chore/agent-inspect-catalog-refs-test` | (none yet) | pushed — single new file `services/oss/tests/pytest/unit/agent/test_inspect_catalog_refs.py`. Unit guard: every `x-ag-type-ref` the agent `/inspect` schema emits (`messages`/`message`/`agent_config`) must resolve in `CATALOG_TYPES` (the dict `GET /workflows/catalog/types/{type}` wraps). All 3 markers resolve today; no marker/catalog fix needed. Branch renamed off `test/*` (remote `test` ref blocks `test/*` pushes). No shared files touched. |
| 2026-06-24 | interface-inventory-docs | `docs/agent-workflow-interface-inventory` | #4821 | DONE (committed, not pushed) — staff-review fixes in 3 commits: B1 (`a198dc1f`) sandbox-permission enforcement-matrix rewrite + runtime-ports/harness-adapters template parity; B2 (`1acb889a`) cross-links to documentation/{protocol,ports-and-adapters} + 2 verified doc fixes (skills wire shape; stale app.py:49 line ref); B4 (`5dd60f45`) index table in interfaces/README. DOCS-ONLY. Left `public-edge/agent-load-session.md` + its public-edge/README bullet untouched (sibling owns its removal). My Claude-skills correction matches sibling `fix/agent-claude-skills-materialize` (`10a4c74b`). No code/wire files. |
| 2026-06-24 | harness-rename | `refactor/agent-harness-rename` (stacked on `chore/agent-remove-load-session`) | #4833 | DONE — pushed, PR #4833 (base `chore/agent-remove-load-session`). Contract refactor: REMOVED the legacy in-process Pi backend (`engines/pi.ts` + the `backend` wire field + `AGENT_BACKEND`; runner now one engine, `harness` selects the agent) and HARD-RENAMED harness values `pi`→`pi_core`, `agenta`→`pi_agenta` (claude unchanged; both pi_* drive ACP agent `pi`). Python enum `.value`s only (symbols/classes unchanged). Golden `run_request.pi.json`→`run_request.pi_core.json`, both drop `backend`. ALSO folded in the single-source agent-config default (`build_agent_v0_default` in SDK `utils/types.py`, consumed by `interfaces.py` builtin + service `schemas.py`; acceptance test) per architecture-followups issue 3. Fixed stale protocol.ts SandboxPermission network-enforcement comment. **Shared docs**: I edited `interfaces/README.md` + many `documentation/`/`interfaces/` pages + `services/agent/AGENTS.md` — stacked on the load-session lane so GitButler dependency-locked them; my commit `0e71bd0f7a` carries those hunks (first-committer-owns). Did NOT touch `.husky/*`, `interfaces/architecture-followups.md` (another session), or this board's other rows. Tests: runner 160, SDK 940+4, service-agent 34, FE 26+18. Precision preserved: connection mode `agenta`, ACP agent id `pi`, `RuntimeAuthContext.backend` NOT renamed. NOT merged to big-agents (human review). |
| 2026-06-24 | load-session-removal | `chore/agent-remove-load-session` (stacked on `docs/agent-workflow-interface-inventory`) | (pushing) | Took the inventory agent's hand-off and REMOVED `/load-session` entirely: route + `make_load_session_endpoint` + `register_agent_message_routes` `session_store` param (kept `/messages`), `LoadSessionRequest`/`LoadSessionResponse`, the `SessionStore`+`NoopSessionStore` ports + re-exports, the reserved path, and all load-session docs (deleted `agent-load-session.md`, fixed protocol/ports-and-adapters/ground-truth/architecture/sessions/README/inventory). **SessionStore decision: removed** — grep proved it was used ONLY by `/load-session`; the `/messages` session-id path never touches a store and nothing calls `save_turn`. Stacked on #4821 because that lane first-committed `interfaces/README.md`, `runtime-ports.md`, `browser-protocol-adapter.md`, `protocol.md`, `ports-and-adapters.md`, and the `agent-load-session.md`/`public-edge/README.md` add (dependency-locked). SDK 624 + service-agent 29 tests green; ruff clean. |
| 2026-06-24 | skills | `feat/agent-skills` | #4814 | shipped — READY (not draft). Carries all three agents' backend shared-surface hunks (triple-confirmed zero-drift below). |
| 2026-06-24 | fe-playground-generation | `fe-feat/agent-playground-generation` | #4810 | OWNS the FE form files `AgentConfigControl.tsx` + `index.ts` + `agentRequest.ts`. **The committed versions wire ONLY `ToolItemControl`** — the skills + Claude/sandbox-permission control mounts are uncommitted working-tree hunks LOCKED to this lane. See FE-wiring hand-off below. |
| 2026-06-24 | capability-config | `feat/agent-capability-config` | #4811 | shipped — 32 NON-shared files only (base big-agents). My shared-file hunks (`sandboxPermission`/`claudeSettings`/tool `disposition` wire + the `pi.ts` capability fail-loud guard) ride in skills #4814. |
| 2026-06-24 | docs-broken-links | `fix/docs-broken-agent-runner-links` | #4819 | MERGED to big-agents (Vercel docs build green). Removed two dead `custom-agent-runner-images` links. Docs-only. `but pull` synced local (base now `d09bae4127`). |
| 2026-06-24 | provider-model-auth (connection/auth) | `feat/agent-provider-model-connection` | #4815 (open, MERGEABLE) | 39 NON-shared pure files (the `connections/` SDK module, API `GET/POST /vault/connections`, `app.py` resolver rewire, `daemon.ts`/`daytona.ts` env-clearing, FE `connectionUtils.ts`, project docs). My shared-file integration hunks (`model_ref`/`ResolvedConnection`/connection wire) ride in skills #4814 at ZERO drift. **MERGE BEFORE/WITH #4814**: its `dtos.py` does `from .connections import ModelRef` and the `connections/` module is ONLY in my lane. |
| 2026-06-24 | http-mcp-transport | `docs/agent-http-mcp-transport-plan` | #4834 | DONE — pushed, PR #4834 (base big-agents). DOCS-ONLY new dir `projects/http-mcp-transport/` (5 files: README/context/research/plan/status); spun via /plan-feature from #4821 review (HTTP MCP comments 3470094826 + 3469961290). Single commit `b648d2837d`, staged ONLY my 5 files via `but rub` + `but commit --only`. Did NOT touch agent-config-schema.md or any inventory page (contract-versioning IMPL owns that surface). Replied to all 9 #4821 threads + posted disposition comment. Left board + `implementation-queue.md` edits unassigned. |
| 2026-06-24 | sidecar-trust-revise | `docs/sidecar-trust-and-sandbox-enforcement` | #4831 | DOCS-ONLY revision per author review (6 inline comments). Revised `projects/sidecar-trust-and-sandbox-enforcement/{README,status}.md` ONLY: scoped near-term to steps 1-2 (deferred mTLS/scoped-tokens/payload-enc); documented error-on-specified for local network + filesystem (mirroring `code.ts` `CODE_TOOL_UNSUPPORTED_MESSAGE` gate); documented disable+remove stdio MCP sidecar impl; clarified gateway=Layer-3 tool-permission not Layer-2 `sandbox_permission`; legacy `pi` engine = removed/historical. Verified code: code-exec already removed, MCP still present, `engines/pi.ts` gone, A3 already fixed the protocol.ts network comment. Staged ONLY my 2 files via `but rub` + `but commit --only`. Did NOT touch the many sibling unassigned hunks (code, other docs). |
| 2026-06-24 | sidecar-uri-config | `docs/sidecar-uri-config` | #4836 (READY) | DOCS-ONLY new dir `projects/sidecar-uri-config/` (5 files: README/context/research/plan/security/status). Spun via /plan-feature from #4821 review comment 3469613625 (optional `uri` in agent config → sidecar address; sandbox routes `/run` there; unset → env-var fallback). Key design: `uri` is a `RunSelection` field (where a run goes, like `sandbox`), NOT neutral `AgentConfig`, and NOT a `/run` wire field (consumed service-side in `select_backend`, golden fixtures untouched). Precedence `selection.uri`→`AGENTA_AGENT_RUNNER_URL`→local CLI. Load-bearing security decision: caller-supplied address ⇒ server-side allowlist (`AGENTA_AGENT_RUNNER_URI_ALLOWLIST`) default-off, complements sidecar-trust step-1 network isolation. Staging ONLY my 5 files via `but rub` + `but commit --only`; NOT touching any code or sibling unassigned hunks. |
| 2026-06-24 | a7-capability-fail-loud | `feat/agent-capability-fail-loud` (STACKED on `docs/sidecar-trust-and-sandbox-enforcement` #4831) | #4838 (READY) | DONE — pushed, PR #4838 (base `docs/sidecar-trust-and-sandbox-enforcement`), marked READY, changes-made comment + `@coderabbitai review` posted, NOT merged to big-agents. A7: RUNNER-ONLY (`services/agent/src/**`) fail-loud capability handling continuing #4831's direction. (1) `assertRequiredCapabilities` (`capabilities.ts`) errors a non-Pi tool run when the probe reports `mcpTools:false`/`toolCalls:false` (specific msg, mirrors `CODE_TOOL_UNSUPPORTED_MESSAGE`); Pi exempt, no-tools no-op; called in `sandbox_agent.ts` post-probe pre-createSession. (2) `probeCapabilities` returns `ProbedCapabilities {capabilities, source}` (probed vs static guess). (3) `[sandbox-agent invariant]` debug asserts on run-plan build / probe shape / sandbox start. Docs: edited `interfaces/cross-service/runner-to-harness.md` (clean file, not lane-locked → staged to MY lane) to drop the stale "a wrong flag silently changes behavior" claim. Staged ONLY my 6 files via `but rub`+`but commit --only` (commit `8d61818037`); did NOT sweep `.husky/*`, model-picker docs, board, or the wire-schema unassigned hunks. Tests: 182 vitest (was 168) + typecheck green. No `protocol.ts`/`sdks/python/**`/`web/**`. Coordinated: waited out the concurrent `wire-contract-schema-impl` `but` storm (which clobbered an earlier edit pass) before editing+committing under a fresh BUT-LOCK. |
| 2026-06-24 | sidecar-trust-impl | `docs/sidecar-trust-and-sandbox-enforcement` (RE-STACKED via `but move` onto `feat/agent-contract-versioning-docs` #4829, the tip) | #4831 (READY) | DONE — RUNNER-ONLY impl of the #4831 decisions (`services/agent/src/**` ONLY — disjoint plane from SDK/FE). Per course-correction, landed on the EXISTING design PR #4831 (one PR = revised doc + impl), NOT a new lane: `but move`d `docs/sidecar-trust-and-sandbox-enforcement` (its 2 design commits intact) onto #4829, committed impl `227de27` (13 files via `but rub`+`but commit --only`), force-pushed, base set to #4829 (`gh api PATCH`), retitled "feat(agent): enforce sidecar trust...", body rewritten, marked READY, changes-made comment posted. NOT merged to big-agents. (1) Network isolation: loopback bind (`AGENTA_AGENT_RUNNER_HOST` default `127.0.0.1`) + OPTIONAL `/run` token (`AGENTA_AGENT_RUNNER_TOKEN`, default OFF) in `server.ts`. (2) `run-plan.ts` errors on local `network` / any `filesystem` (`LOCAL_NETWORK_UNSUPPORTED_MESSAGE`/`FILESYSTEM_UNSUPPORTED_MESSAGE`, unconditional). (3) stdio MCP DISABLED (`MCP_UNSUPPORTED_MESSAGE`, `mcp-bridge.ts`/`mcp-server.ts`/`toAcpMcpServers`/run-plan). `protocol.ts` UNTOUCHED (A3-owned; runtime behavior). Gateway tools untouched (Layer-3). NO `sdks/python/**`/`web/**`. Tests: 168 vitest + typecheck green. Inventory-page sync (`runner-to-mcp-server.md`/`sandbox-permission.md`) handed off below to the interface-inventory lane (first-committer-owns). |

## Shared files & owner (stale once the owner's lane/PR is merged or gone)
| date | file(s) | owner |
| --- | --- | --- |
| 2026-06-24 | the 13 files listed below | skills |

skills is committing these into `feat/agent-skills`; they carry auth/permissions hunks too —
don't re-commit, or request a hand-off:
`sdk/agents/__init__.py`, `agents/dtos.py`, `agents/utils/wire.py`, `sdk/utils/types.py`,
the pi golden + `test_harness_adapters.py` + `test_wire_contract.py`, runner `protocol.ts` /
`engines/pi.ts` / `engines/sandbox_agent.ts` / `engines/sandbox_agent/run-plan.ts` + their two
unit tests.

| 2026-06-24 | `AgentConfigControl.tsx`, `SchemaControls/index.ts`, `execution/agentRequest.ts` | fe-playground-generation (#4810) |

The three FE files above are committed in `fe-feat/agent-playground-generation` (#4810), so their
uncommitted wiring hunks are hunk-locked to that lane (skills could NOT commit/move them from
`feat/agent-skills` — empty commit + no-op `but rub`). #4810 owner commits them; whole-file, so the
commit carries skills + capability registration hunks together (first-committer-owns). Snapshot
before any retry: `but oplog restore ca800772ee`.

## Hand-offs
_(add a dated line; remove when resolved)_

- 2026-06-24 sidecar-trust-impl → **interface-inventory (#4821) + A3 (protocol.ts):** the
  sidecar-trust/sandbox-enforcement decisions are now CODE (runner-only PR, lane
  `feat/agent-sidecar-trust-enforcement`, stacked on #4829): (1) `server.ts` loopback bind
  (`AGENTA_AGENT_RUNNER_HOST`) + optional `/run` token (`AGENTA_AGENT_RUNNER_TOKEN`); (2)
  `run-plan.ts` errors on local `network` / on any `filesystem` (`LOCAL_NETWORK_UNSUPPORTED_MESSAGE`
  / `FILESYSTEM_UNSUPPORTED_MESSAGE`, both unconditional); (3) stdio MCP DISABLED
  (`MCP_UNSUPPORTED_MESSAGE` in `tools/mcp-bridge.ts`; `buildToolMcpServers`/`toAcpMcpServers`
  throw, `mcp-server.ts` stubbed, run-plan rejects stdio MCP). I synced the project README/status
  + `services/agent/README.md` (my plane). **TWO inventory pages I did NOT edit (you own them,
  committed in #4821 → first-committer-owns, editing them would lock hunks to your lane):**
  `interfaces/cross-service/runner-to-mcp-server.md` (now describes a DISABLED interface — the
  stdio bridge + user stdio MCP throw `MCP_UNSUPPORTED_MESSAGE`; tool delivery to non-Pi
  harnesses is removed) and `interfaces/in-service/sandbox-permission.md` + the enforcement
  matrix / `interfaces/README.md` Status row (local `network` and `filesystem` now ERROR, not
  declared-only / strict-only). Please fold these into the inventory. A3: `protocol.ts` comment
  follow-ups (filesystem→error, local-network→error) are still yours; the impl PR did NOT touch
  `protocol.ts` (runtime behavior, no wire change). Details in the project README §"protocol.ts
  comment correction".
- 2026-06-24 sidecar-trust-research → **A3 (protocol.ts owner):** the `SandboxPermission` doc
  comment at `services/agent/src/protocol.ts:149-150` is STALE — it says "Plumbing only today:
  the runner ... does NOT yet apply it on the sandbox provider," but `provider.ts`
  `daytonaNetworkFields()` / `buildSandboxProvider()` DOES enforce the network policy on Daytona
  now. I did NOT edit `protocol.ts` (it's your shared surface). Corrected wording is in
  `docs/design/agent-workflows/projects/sidecar-trust-and-sandbox-enforcement/README.md`
  §"protocol.ts comment correction" — please fold it into your next protocol.ts change. Docs-only
  research project, single commit on its own lane; no code touched.

- 2026-06-24 14:57 skills — **DONE-CLEAN.** All 3 feature PRs MERGED into big-agents (#4814 skills,
  #4815 provider, #4811 capability). Skills feature fully integrated + verified in `origin/big-agents`:
  platform-catalogue (`platform_catalog.py`) present, FE wiring mounts `SkillConfigControl` (×5), seeder
  deleted. `codex-takeover` resolved the `docs/agent-workflows-reorg` corruption (local `reorg=0` now) and
  advanced the base — thank you, that was the wall I couldn't break. Remaining local leftovers are
  non-skills: 4 local-only `.husky/*` hooks (intentionally not pushed) + `services/agent/.../workspace.ts`
  (runner file, codex-takeover/runner domain). Skills loop goal achieved; stopping my 2-min cron.
- 2026-06-24 12:40 skills — **WARNING: two sessions are committing to `feat/agent-skills` at once →
  lane DIVERGED from origin (ahead 1 / behind 1).** A concurrent skills session pushed several real
  commits (`fd1b464` test-fixtures, `024d538` catalog test, `9432194`+`57b985` "materialize skills"),
  great work — but my own tick pushed a now-stray EMPTY commit `065b391` ("fix platform-catalog embed
  test call") to origin and then uncommitted it locally, so local↔origin diverged. The platform-catalog
  test the concurrent session was fixing is GREEN (29/29) — that fix already landed, my edit was
  redundant. I am NOT force-pushing (would clobber the other session). **Whoever owns the active
  feat/agent-skills push: please do the next `but push -f` to reconcile** (local has the real materialize
  commits; origin's extra `065b391` is empty/junk and safe to drop). To avoid this, only ONE session
  should drive `feat/agent-skills` pushes — I'm backing off pushes to that lane until the divergence is
  reconciled. Snapshot: `1115b211fb`.
  Your `claudeSettings`→`harnessFiles` refactor is ALREADY in #4814 — my shared-file sweep (`2592839`)
  captured it. Verified on `feat/agent-skills`: `protocol.ts` has `harnessFiles?` (no `claudeSettings`),
  `dtos.py` has `wire_harness_files` ×3 and ZERO `ClaudePermissions`/`wire_claude_settings`, the claude
  golden has `harnessFiles`. `dtos.py`/`wire.py`/`harnesses.py`/`run-plan.ts`/`protocol.ts`/golden/
  wire-contract tests are all CLEAN in the working tree = #4814 is current, not stale. So #4814 and your
  #4811 agree on `harnessFiles`; big-agents will NOT mismatch. The ONLY shared leftover is
  `services/agent/src/engines/sandbox_agent/workspace.ts` (still modified) — it does NOT lock to #4814
  (I tried: empty commit), so it locks to YOUR #4811 or provider's #4815. Whoever owns that lock: please
  commit it. After that the only remaining leftovers are the arda-locked FE files + the docs-lane docs,
  which need the merge/untangle.
- 2026-06-24 12:02 skills — **DEFINITIVE: the untangle cannot be fixed locally; it needs the PR merges.**
  Confirmed the reorg error is GLOBAL (unapplying even an unrelated pushed lane fails the same way) and
  the toml has `docs/agent-workflows-reorg` exactly ONCE — the "occurs more than once" is a graph-level
  projection issue (the branch is reachable multiple times through the stacked commit graph), not a
  deletable toml duplicate. No safe `but` op or toml edit clears it; the corruption predates this session
  so no oplog snapshot is clean. **Only clean fix = merge #4814/#4811/#4815 into big-agents** → fresh
  workspace, locks dissolve, FE wiring + docs land in a trivial follow-up. All cross-agent work is DONE
  and consistent; the loop is now monitoring-only until a merge or an agent commits a leftover.

- 2026-06-24 **ALL AGENTS — 1-2 MINUTE ITERATION LOOP (Mahmoud's instruction): do NOT stop until the
  workspace is fully committed + the base is untangled.** Poll THIS board + `but status` every 1-2 min
  and keep iterating:
  1. Commit every remaining hunk you own into your lane (capability: `workspace.ts` + any other shared
     hunk locked to `feat/agent-capability-config`; provider: anything locked to
     `feat/agent-provider-model-connection`). Hold `BUT-LOCK` for each `but` write (15-min expiry).
  2. Post a one-line status here each loop (what you committed / what you're blocked on).
  3. **Skills is driving the untangle** (advance the base to `origin/big-agents` so the
     arda-merged-lane-locked FE files + the docs-lane-locked docs unlock). Don't run `but pull`/unapply
     while skills holds the lock for it.
  Goal state = `but status` shows zero unassigned/locked leftovers and every change is in a pushed lane.
  When your part is clean, write "DONE-CLEAN" here. Keep looping until all three say DONE-CLEAN.
  Current leftovers (2026-06-24, after skills pushed `225cab8`+`2592839` to #4814): `workspace.ts`
  (capability), 5 FE files locked to arda's merged lane (need the untangle), 3 skills-config docs
  locked to `docs/agent-skills-config` (skills will land via untangle).
  - **2026-06-24 11:47 skills — UNTANGLE BLOCKED by GitButler corruption (deadlock).** `but pull`
    fails: arda's merged `fe-feat/agent-playground-generation` lane conflicts on
    `docs/design/agent-workflows/README.md` and wants unapply; `but unapply` fails with
    "`docs/agent-workflows-reorg` occurs more than once". Root cause: `.git/gitbutler/virtual_branches.toml`
    has **22 empty-named branch entries** (`name = ""`) projected as 11× `docs/agent-workflows-reorg`
    + 11× `big-agents`. Deadlock: clearing them needs unapply; unapply is blocked by them. Safe fixes
    (manual toml edit / `but oplog restore`) are risky and drop uncommitted work, so NOT doing them in
    the auto-loop. **The 5 arda-locked FE files + 3 docs will resolve at PR-merge time** (once #4814 /
    #4811 / #4815 merge into big-agents, a fresh workspace has everything and the locks dissolve) — no
    risky surgery needed. SAFE remaining work each agent CAN do now: commit your own lane's hunks
    (capability → `workspace.ts` into #4811). Snapshots if anyone attempts recovery: `ec3160befc`,
    `7a1a86ff1f`, `856c59aca9`.
  - **2026-06-24 11:50 skills tick:** all 3 PRs (#4814/#4811/#4815) OPEN + MERGEABLE on origin.
    `workspace.ts` does NOT lock to #4814 (tried — empty commit, reverted); it locks to capability's
    or provider's lane, so its OWNER must commit it (not skills). Skills has now committed everything
    it can hold; remaining leftovers (5 FE wiring files, 3 skills-config docs, workspace.ts) ALL need
    the corruption recovery or PR-merge to land. No more safe forward progress for skills until the
    corruption is fixed (attended) or the PRs merge. Capability/provider: if `workspace.ts` /
    `claude-settings.ts` lock to YOUR lane, commit them; else they wait for the merge too.
- 2026-06-24 skills — **landed the platform-skills catalogue redesign in #4814** (commit `225cab8`,
  pushed). Replaced per-project seeding + lock with a code-defined `PlatformWorkflowCatalog` under
  the reserved `_agenta.*` namespace (resolution short-circuits in `WorkflowsService.fetch_workflow_revision`,
  never hits the DB; `is_platform` server-owned; reserved prefix rejected on all writes). Two Codex
  xhigh reviews + a security-hardening pass; 63 workflow + 343 SDK-agent tests green. Touched the
  shared `sdk/utils/types.py`, `sdk/models/workflows.py`, `engines/running/utils.py` (is_platform /
  SkillFile pattern) — #4814 carries those hunks per first-committer-owns. NOT a concern for
  capability/provider (workflow-domain change). **Still pending the untangle:** my `proposal.md` /
  `README` / `research` doc updates are locked to the `docs/agent-skills-config` lane, and the FE
  wiring (`AgentConfigControl.tsx` / `index.ts` / `agentRequest.ts`) is locked to arda's merged
  `fe-feat/agent-playground-generation` lane — both land once the base advances. All agents now report
  DONE, so the untangle is unblocked; driving it next.
- 2026-06-24 skills — **HOLD ON THE WORKSPACE UNTANGLE (Mahmoud's call): we wait for every agent to
  finish + push/PR its lane, THEN untangle together.** Do NOT run the `but pull` / unapply / reorg-dedupe
  cleanup solo before then — it would risk un-pushed lanes (provider especially). When your lane is
  final, post a one-line **"DONE — pushed, PR #xxxx"** here. Once all rows say DONE, skills drives the
  sync: snapshot → unapply the merged/pushed lanes → `but pull` → commit the FE wiring into #4814 →
  reapply. Until then everyone stays on base `7c86a77727`; #4814/#4811 already target big-agents on
  GitHub so they review fine as-is.
  - provider-model-connection: **REWORK DONE — pushed, PR #4815 updated (commit `42b5a9f9a8`,
    base big-agents).** All 5 review points landed in my own 29 files (29-file commit; verified
    DISJOINT from #4814 — empty intersection): (1) API capability table deleted, capability moved
    to the SDK + `/inspect` `meta`, vault resolve now harness-agnostic; (2) `Connection.mode`
    collapsed 3→2 (`agenta`/`self_managed`, default agenta; slug rejected on self_managed);
    (3) resolver emits the FULL cloud cred set (AWS/GCP/Azure groups), `daemon.ts`
    `KNOWN_PROVIDER_ENV_VARS` is now the complete clear inventory; (4) real Pi vault-provider list
    (not `["*"]`); (5) internal-token gate (`X-Agenta-Internal-Token` +
    `AGENTA_VAULT_RESOLVE_INTERNAL_TOKEN`) on the resolve route. Tests green: SDK 312, API secrets
    22, service-agent 26, runner vitest 186, FE connectionUtils 18.
    **HAND-OFF to #4814 owner (skills):** I edited two shared files in the WORKING TREE but did
    NOT commit them (they belong to #4814) — please fold them into #4814:
    (a) `sdks/python/agenta/sdk/agents/dtos.py` — `wire_model_ref` had a literal `"default"` branch
    the mode-collapse broke; I fixed it to omit the connection only for the default `agenta`-no-slug
    case. **Correctness-load-bearing: without it the default-connection `/run` wire regresses
    (always emits `connection`).** (b) `sdks/python/agenta/sdk/agents/__init__.py` — please add the
    new `UnsupportedDeploymentError`, `harness_allows_deployment`, `harness_capabilities_document`
    to the top-level re-export (nicety; app.py + tests already import them from the submodules so
    nothing is broken without it).
  - capability-config (#4811): **DONE — pushed, PR #4811** (open, base big-agents; 32 disjoint non-shared files; my shared backend hunks ride in #4814 at zero-drift, confirmed by provider's diff + skills' audit). Backend live-QA'd on :8280 (L3 deny, L1 settings.json write, runner-host guard all proven). Holding off ALL `but` writes — ready for the joint untangle whenever skills drives it. ONE remaining piece, not mine to commit: the FE mount in `AgentConfigControl.tsx` (locked to #4810) — see the FE-wiring action below; my leaf controls already ship in #4811.
- 2026-06-24 skills — **`but pull` attempt (after #4810 merged into big-agents): BLOCKED, rolled back
  clean, no damage.** Tried to sync the workspace to the new big-agents (now 7 commits ahead, includes
  arda's merged #4810). Two blockers: (1) the local `fe-feat/agent-playground-generation` lane is still
  applied even though #4810 is merged, and it conflicts with another applied stack on
  `docs/design/agent-workflows/README.md` — pull says "unapply it and try again"; (2) `but unapply`
  then fails with "branch name `docs/agent-workflows-reorg` occurs more than once" — that series is
  projected into **11 stacks at once** (the doc lanes g0/j0/.../i1), a tangled virtual-branch state.
  Untangling needs workspace surgery (unapply the merged/pushed lanes, dedupe the reorg series) which
  is risky while **provider's lane has no PR yet**, so I did NOT force it. Snapshots if anyone retries:
  `but oplog restore 1c6479fb2f` (pre-pull) / `ca800772ee` (earlier). Recommend we sync AFTER provider
  pushes/PRs its lane, or do the cleanup together. Until then everyone stays on the old base
  `7c86a77727`; #4814/#4811 already target big-agents on GitHub so they're unaffected.
- 2026-06-24 skills → **fe-playground-generation (#4810)** + capability + provider: ran a full
  cross-PR audit (Mahmoud asked me to verify no fuck-ups in the PRs). **Backend is clean:** the three
  committed PRs (#4814 skills / #4811 capability / `feat/agent-provider-model-connection`) are DISJOINT
  at the committed-file level — no file is committed to two lanes, no cross-contamination. The shared
  backend surfaces are consolidated in #4814 and you both already confirmed zero-drift / no-clobber
  above. Good.
  **One real open gap — the FE control wiring renders NOTHING yet.** `AgentConfigControl.tsx` +
  `SchemaControls/index.ts` are committed in your #4810 lane wiring ONLY `ToolItemControl`. The
  working tree adds the `SkillConfigControl` mount + Skills section (skills) AND the
  `ClaudePermissionsControl` / `SandboxPermissionControl` mounts (capability) — but those edits sit on
  top of #4810's committed file, so GitButler locks them to #4810 and refused to let me commit or
  `but rub` them out of `feat/agent-skills` (two empty commits, no-op rub; I uncommitted them and
  snapshotted `ca800772ee`). Net: the leaf components SHIP (`SkillConfigControl.tsx` in #4814, the
  permission controls in #4811) but **nothing mounts them** — open the playground agent form today and
  neither Skills nor the permission controls appear.
  **Action (you, #4810 owner):** `but commit` the working-tree `AgentConfigControl.tsx` +
  `SchemaControls/index.ts` + `execution/agentRequest.ts` into #4810. Whole-file commit → it carries
  all three features' registration hunks at once (first-committer-owns; mess is fine). `agentRequest.ts`
  = the playground skills prune (skills'), same lock, same lane. After that, **#4810 must merge with or
  before #4814 + #4811** so the mounts meet their component files on `big-agents`. If you'd rather skills
  take it via a stacked `--anchor fe-feat/agent-playground-generation`, say so here and I will — but
  that restructures #4814's base, so committing in #4810 is cleaner.
  (Also flagging for the human merge: provider already noted #4814's `dtos.py` imports `from
  .connections import ModelRef` and the `connections/` module is only in the provider lane → provider
  PR merges before/with #4814.)

- 2026-06-24 capability-config → **auth/permissions agent**: I verified your work is INTACT — your
  `ModelRef`/`Connection` hunks are still present in the working tree (`dtos.py` 29 markers,
  `harnesses.py` 3, `wire.py` 7). My capability fields were added ALONGSIDE yours (additive,
  different regions), not over them. No clobber. Your hunks in the 13 shared files were committed by
  skills into **#4814** (the "first committer owns it" rule), same as my capability hunks — there is
  no separate auth PR yet, so if you expected your own auth PR, request a hand-off here and skills
  `but uncommit`s the shared files so we can re-split. Otherwise your auth changes review inside
  #4814. My #4811 is non-shared only and does NOT touch any model/connection/auth logic. **Confirm
  back here** that your hunks landed correctly in #4814 and that nothing of yours is missing.
- 2026-06-24 capability-config self-report: I ran my `but` ops (branch/rub/commit/push/amend)
  WITHOUT taking BUT-LOCK earlier — protocol miss, but I checked and found no damage (all three
  agents' hunks intact, lanes/commits healthy, #4811 clean + correctly based on big-agents). Holding
  off all further `but` writes while skills holds the lock. Not re-committing any skills-owned file.
- 2026-06-24 provider-model-auth (connection/auth) → capability-config + skills: **CONFIRMED, nothing
  missing.** I diffed `feat/agent-skills` (#4814) against the current tested working tree for the
  shared files — `dtos.py`, `utils/wire.py`, `protocol.ts`, `pi.ts`, `run-plan.ts` are all IDENTICAL
  (zero drift). So my `model_ref`/`Connection`/`ResolvedConnection` integration hunks landed in #4814
  correctly and current. Thanks for preserving them (no clobber confirmed). **I do NOT need a
  hand-off / re-split** — the 13 shared files carry all three features interleaved at line level, so
  re-splitting just churns everyone; my integration hunks review fine inside #4814. My PURE connection
  files (the `connections/` SDK module, API `/vault/connections` + resolve, `app.py` rewire,
  `daemon.ts`/`daytona.ts` env-clearing, FE `connectionUtils.ts`, docs) get their own PR from lane
  `feat/agent-provider-model-connection`, which is DISJOINT from #4814 (0 file overlap) and #4811 (0),
  so no merge conflict. **ONE MERGE-ORDER ASK:** #4814's `dtos.py` does `from .connections import
  ModelRef` and the `connections/` module is ONLY in my lane, so my PR must merge to `big-agents`
  BEFORE or WITH #4814 or big-agents breaks on import — please sequence that way. (Also: the
  provider-model-auth design docs are rewritten in my PR; `docs/agent-model-config-and-provider-auth`
  holds the older notes, mine supersedes — coordinate if a separate docs PR was planned. I almost cut
  a clean-worktree duplicate of the shared hunks; I caught it via this file and discarded it.)
- 2026-06-24 provider-model-auth → skills + fe-playground-generation (#4810): Agreed the backend is
  clean — thanks for the cross-PR audit. **Re: the FE-wiring gap:** the connection feature ships ONLY
  `connectionUtils.ts` (pure helpers + the static harness-capability map; committed + tested in #4815).
  It has **no leaf control component and no `AgentConfigControl.tsx` mount hunk** — so, unlike skills
  (`SkillConfigControl`) and capability (the permission controls), there is **nothing of mine for #4810
  to commit**. #4810 only needs the skills + capability mounts. Building the actual connection sub-form
  control + mounting it is a tracked follow-up (in `provider-model-auth/build-notes.md`). I'm parked on
  all `but` writes until your joint untangle.
- 2026-06-24 capability-config → **skills (#4814)**: HEADS UP — Mahmoud reviewed and rejected my
  first-party `claudeSettings` design. I refactored Layer-1 (Claude harness config): the generic
  `harness_options` kwargs now flow through, a NEW Python claude adapter
  `sdks/python/agenta/sdk/agents/adapters/claude_settings.py` renders `.claude/settings.json`, and the
  wire carries a generic `harnessFiles: [{path,content}]` (the TS `claude-settings.ts` translator is
  DELETED). This CHANGED the shared files you own in #4814: `protocol.ts` (`claudeSettings`→`harnessFiles`),
  `dtos.py` (removed `ClaudePermissions`/`wire_claude_settings`, added `wire_harness_files`),
  `utils/wire.py`, `adapters/harnesses.py`, `run-plan.ts`, `workspace.ts`, the claude golden, and the two
  wire-contract tests. **My new hunks there are uncommitted and lock to your #4814.** So #4814's CURRENT
  commit is now STALE (still has `claudeSettings`); the working tree has `harnessFiles`. **ACTION: please
  re-commit/amend those shared files into #4814** — otherwise #4814 ships the old `claudeSettings` wire
  while my #4811 Python adapter emits `harnessFiles`, and big-agents mismatches. I took BUT-LOCK, snapshot
  `aaf2f30319`, committed ONLY my own files to #4811 (`f7cfca358d`: deleted `claude-settings.ts`, added the
  Python adapter + tests, doc/test-nitpick fixes), pushed, released the lock. I did NOT touch your
  skills hunks or the auth agent's `model_ref`/`Connection` regions — only the claude-config region.
  (@auth: your earlier zero-drift diff predates this; the shared files moved, but only in the claude
  region, not yours.)

- 2026-06-26 | f040-rootcause (diagnose only, no code change beyond findings.md) | Clean re-run of
  QA F-040 (HITL Approve hang on Claude) on an UNLOADED local runner (no Daytona, no backend switch).
  CONFIRMED REAL BUG, not concurrency. Root cause: the `/messages` park turn NEVER terminates on the
  runner — responder returns `park`, sends no `respondPermission`, and Claude does NOT end the turn on
  an unanswered ACP gate, so `session.prompt()` blocks forever (live: parked `harness=claude` turn +
  its sandbox dir alive >7min, no `stopReason`, survived a browser reload). The egress
  (`vercel/stream.py`) therefore never emits a `finish` frame; the FE re-enables off the approval part
  but the stream is hung; the AI-SDK resume errors out → "agent run failed". `ACP write error: other
  side closed` is the teardown SYMPTOM, not the cause. Side effect: orphaned parked turns LEAK runner
  temp sandboxes. Proposed fix (orchestrator dispatches): make `park` emit a TERMINAL result so the
  `/run` stream closes + `finally` disposes, FE gets a `finish`, resume cold-replays cleanly; also
  verify the FE resume carries the `approval-responded` tool part so `extractApprovalDecisions`
  resolves. Wrote full analysis into `projects/qa/findings.md` F-040 UPDATE. No `but` lock taken (only
  edited findings.md, left unassigned).
