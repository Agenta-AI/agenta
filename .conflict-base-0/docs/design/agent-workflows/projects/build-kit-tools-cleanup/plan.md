# Plan: build-kit tools cleanup

Status: landed (server half), 2026-07-04. Slices 1-4 and the server sub-slices of slice 5
(5a) are committed on the lane `feat/build-kit-tools-cleanup`, one commit per slice group:

- Slice 1 (renames + sweep): **LANDED** (`a8a7a1e170`)
- Slice 2 (overlay cut): **LANDED** (`e8b6eb129c`)
- Slices 3-4 (`query_spans` + skills port): **LANDED** (`25d73b4386`)
- Slice 5a (`test_run` server half, flag-gated off): **LANDED** (`61cf1751b9`)
- Slice 5b (runner half: `callRef` dispatch, context injection, `timeoutMs`, overlay flip,
  flag default-on): **DEFERRED** (open-issues entry in
  [scratch/open-issues.md](../../scratch/open-issues.md))
- Slice 6 (`gateway` -> `server` rename): **DEFERRED** (same log; Codex review scoped it
  to docs/UI labels only)

Everything landed batches into **one PR on one GitButler lane** (decided); the slices are
ordered commits inside that PR, each independently green, so review reads slice by slice.

Decisions: all closed. Option C confirmed (Mahmoud, 2026-07-04). The three formerly-open
calls proceeded on their recommendations as provisional defaults, flagged for PR review:
a static overlay (the 12 ops in `DEFAULT_BUILD_KIT_OPS`), sync+delta `test_run`, and
`query_spans` shipping now. See [status.md](status.md).

## What merged under this plan (2026-07-04 reconcile)

The plan was written 2026-07-03; big-agents has since absorbed:

- **#5041 (approval-boundary) MERGED** 2026-07-04T11:57Z. `needs_approval` is gone;
  approval is now the resolved **permission plan**. `PlatformOp` keeps exactly one
  approval-adjacent field: the `read_only` hint (`op_catalog.py:87`, "Catalog hint for
  the runner's `allow_reads` policy; no hint counts as a write"). The resolved spec
  carries `read_only` plus the author's optional explicit `permission: allow|ask|deny`
  (`platform_tools.py:78-81`, `protocol.ts:133-139`). The runner decides per gate via
  `permission-plan.ts` (`effectivePermission`: spec permission → server permission →
  authored rules → plan default; default default = `allow_reads`, under which
  `readOnlyHint===true` → allow, everything else → **ask** → `pendingApproval`).
  Consequence for us: a new write op defaults to ask by setting `read_only=False` and
  nothing else. Zero approval machinery to touch. The old plan's `op_catalog.py`
  sequencing constraint is DISSOLVED: the `docs/approval-boundary` lane is merged and
  archived, and `op_catalog.py` / `overlay.py` / `static_catalog.py` /
  `agenta_builtins.py` are byte-identical to the workspace base — no lane owns them.
- **#5064 (invoke negotiation) MERGED**: batch = fold(stream), full transcript by
  default (`flags.trim` unset=False, `sdk/models/workflows.py:130-138`;
  `x-ag-messages-transcript` sugar at `sdk/decorators/routing.py:146-151`,
  `apply_invoke_prelude` at `:189`). Already folded into
  [api-design.md](api-design.md); cited symbols verified (`sdk/agents/handler.py`
  `agent_batch` at 221-244, `sdk/agents/fold.py` `fold` at 37 /
  `trim_to_trailing_unit` at 114). One post-merge fact worth carrying: the terminal
  result's `stop_reason` is authoritative over the `done` event
  (`handler.py:236-244`) — the `test_run` digest reads the batch envelope, which
  already encodes that.
- **#5059**: `AGENTA_RUNNER_URL` is gone → `AGENTA_RUNNER_INTERNAL_URL`
  (`services/oss/src/agent/config.py:48`) + `AGENTA_API_INTERNAL_URL`
  (`api/oss/src/utils/env.py:444`); the API accepts both `/x` and `/api/x`. Relatedly,
  the runner's direct-call SSRF guard now DERIVES the mount from the callback path
  instead of hard-coding `/api` (`direct.ts:241-325`). The conclusion research leaned
  on stands: the agent-service invoke mount (`/services/agent/v0/invoke`) is outside
  any callback mount, so a platform op still cannot reach it. Live QA must run against
  post-#5059 env files.
- **#5047/#5057/#5061**: no surface this project cites changed semantics; #5057's
  runner resolved-config log line stays a debug aid, not a `test_run` source.

Full citation drift ledger: [research.md](research.md), "2026-07-04 reconciliation".

## Coordination constraints (read first; replaces the approval-boundary constraint)

1. **`op_catalog.py` is free.** #5041 merged; no applied lane owns it (verified:
   identical to base `80a482b6c2`). Still post a board row before editing — the
   annotate-trace session historically committed against this file.
2. **The runner/wire surface (slice 5) is doubly contended TODAY:**
   - the applied, unpushed lane `feat/claude-client-tools-recut` owns `relay.ts`,
     `protocol.ts` (the `connect` RenderHint), `responder.ts`, `dispatch.ts`,
     `spec-schema.ts`, the sandbox_agent engine files — AND recent edits to
     `documentation/tools.md` + two of the interface pages our slice-1 docs sweep
     touches;
   - another session's UNCOMMITTED working-tree WIP (pi-builtin-gating) sits on
     `relay.ts`, `permission-plan.ts`, `responder.ts`, `sandbox_agent.ts` and the
     runner permission tests.
   Rule: do not edit those files until the WIP is committed to its lane (board:
   first-committer-owns-shared-file) and expect GitButler hunk-locking to the recut
   lane's commits on `tools.md`/`relay.ts`/`protocol.ts` — take a board lease and, if
   locked, stack on that lane rather than fighting the locks.
3. **`docs/agent-skill-packaging` lane** is designing packaging for the same
   build-agent skills slice 4 rewrites. Docs-only overlap; sync direction with its
   owner before finalizing the playbook body.
4. The overlay default list deliberately lives in `overlay.py`, not `op_catalog.py`
   ([research.md](research.md), cut section) to keep the contended surface small.
5. Because slices 1-4 touch no contended file, they can start immediately; slice 5's
   runner sub-slice sequences behind the relay/protocol coordination above; slice 6 is
   last (or dropped).

## Slice 1: renames + sweep (hard migrate, no aliases) [LANDED]

- `op_catalog.py`: rename the two op keys (`find_capabilities` → `discover_tools`,
  entry at 536-543; `find_triggers` → `discover_triggers`, entry at 576-583) and their
  constants (`_FIND_CAPABILITIES_*` 188-216, `_FIND_TRIGGERS_*` 375-402); sweep the
  "returned by find_triggers" description text (lines 475 and 507).
- Delete the legacy `tools.agenta.find_capabilities` `/tools/call` dispatch:
  `_call_agenta_tool` (`api/oss/src/apis/fastapi/tools/router.py:1197-1259`), its
  routing branch in `call_tool` (~:1107) and imports (:54-55), plus
  `FIND_CAPABILITIES_OP` / `FIND_CAPABILITIES_CALL_REF`
  (`core/tools/discovery.py:45-46`) and `parse_find_capabilities_arguments`
  (`discovery.py:78`) — grep first for hidden callers; research found only the router.
- Docstring/comment sweep: `core/tools/dtos.py:234-330`, `core/tools/service.py:55,484`,
  `apis/fastapi/tools/models.py:141`, `core/triggers/dtos.py:104`,
  `sdks/.../agents/tools/models.py:242` (op docstring example).
- **Revision sweep** (committed configs referencing old op keys): agent configs live in
  the `workflow_revisions.data` JSONB column (`dbs/postgres/workflows/dbes.py:94-95`;
  `data` on the shared DBA) at `data.parameters.agent.tools[*].op`. Hard migrate = a
  one-shot SQL/Python sweep script rewriting the two keys across a project's revisions.
  Dev DBs: run the script (uv run, `# /// script` deps). Prod implication (flag in the
  PR): the same sweep must run at deploy, or old committed revisions resolve to
  `UnknownPlatformOpError` at run time — acceptable pre-production, but say it.
- Tests: `sdks/.../unit/agents/platform/test_op_catalog.py` (key list 39-53,
  reserved-id 61-63, error message 143, direct-call 146-186, method/path table 263-283,
  duplicate 345-353), `unit/agents/tools/{test_parsing,test_models,test_resolver}.py`,
  `unit/test_skill_template_catalog.py`,
  `api/.../unit/applications/test_build_kit_overlay.py:188`, api
  `unit/tools/test_discovery.py` + `unit/triggers/test_triggers_discovery.py` (check
  whether they assert op keys), FE `agentRequest.test.ts` op literals (236-372; they now
  also carry `permission` fields — keep those).
- Docs sync (same slice): `documentation/tools.md` (line 38; op table 422-434; the
  "Tool discovery: `find_capabilities`" section at 437+; 529-534), the three interface
  pages (`cross-service/runner-to-tool-callback.md:60-64`,
  `in-service/tool-models-and-resolution.md:35,57,116-152`,
  `public-edge/agent-config-schema.md:156`) + `interfaces/README.md:51` (also drop its
  "legacy route retained during migration" note — the route dies here). Generated-client
  docstrings (`CapabilitiesResult`): update the source docstring
  (`core/tools/dtos.py:330`), defer regeneration (cosmetic; note in the PR).

Acceptance: full-repo grep for `find_capabilities|find_triggers` returns only
design-history docs (projects/ and scratch/ archives stay as-is) and the deferred
generated clients; sweep script leaves zero old-key tools in dev revisions; suites
green (`sdks/python`, `api`, web unit).

## Slice 2: overlay cut (static default list) [LANDED, 12 ops]

- Add an explicit `DEFAULT_BUILD_KIT_OPS` tuple to
  `api/oss/src/apis/fastapi/applications/overlay.py` (the `PLATFORM_OPS` iteration at
  :82) per the provisional static-13 default: core 8 + event 5, minus the seven cut ops
  (`pause_schedule`, `resume_schedule`, `pause_subscription`, `resume_subscription`,
  `query_workflows`, `list_connections`, `list_subscriptions`); `query_spans` joins in
  slice 3. Validate the tuple against `PLATFORM_OPS` keys in the overlay unit test.
- Rewrite `test_build_kit_overlay.py`'s equality assertions (the all-of-PLATFORM_OPS
  assertion at 41-42) against the explicit list; add a test that every cut op still
  resolves from the catalog (opt-in stays alive).
- Docs sync: `documentation/tools.md` op table gains the default-overlay marking;
  `documentation/agent-template.md` if it describes overlay contents.

Acceptance: a fresh playground application response carries exactly the approved list;
cut ops resolve via explicit config.

## Slice 3: `query_spans` (provisional: ship now) [LANDED]

- One catalog entry (`read_only=True`, `POST /api/spans/query`; route registered at
  `api/oss/src/apis/fastapi/tracing/router.py:97-107`, handler at :314), one
  `DEFAULT_BUILD_KIT_OPS` entry, op-catalog tests (key list, method/path table),
  overlay test update.
- Live check: call it through a playground run against a real trace; confirm the payload
  is model-digestible; add the `fields` projection only if it is not.
- Docs sync: `documentation/tools.md` op table.

Acceptance: the builder verifies a past run's tool spans end to end through the tool.

## Slice 4: skills port (single playbook, single overlay embed) [LANDED]

- `sdks/.../adapters/agenta_builtins.py`: add the `build-an-agent` `SkillTemplate` +
  slug (`__ag__build_an_agent`); delete the three old templates, slugs, and bodies
  (slug constants at 68-70; bodies from ~110-318, including the stale availability note
  at 162-164 that dies unported). Renames land inside the new body from day one.
  Persona/preamble (`AGENTA_PREAMBLE` / `AGENTA_FORCED_APPEND_SYSTEM`, :36-51) per
  Mahmoud's call on the [skills-port.md](skills-port.md) proposal.
- `api/oss/src/core/workflows/static_catalog.py`: swap the three rows (146-162) for the
  playbook row; getting-started's row (134-144) stays.
- `overlay.py:69-78`: the playbook becomes the overlay's ONLY skill embed;
  `agenta-getting-started` leaves the overlay and stays harness-forced
  (`AGENTA_FORCED_SKILLS` at `agenta_builtins.py:320`, unioned by `force_skills`,
  applied via the pi_agenta harness adapter).
- **Revision sweep** (same script as slice 1, second pass): skill embeds referencing the
  three deleted slugs live in `workflow_revisions.data` at
  `data.parameters.agent.skills[*]["@ag.embed"]["@ag.references"].workflow.slug`;
  rewrite to the new slug or drop. The sweep IS the migration; the slice is not done
  until it comes back empty on dev.
- Tests: api `test_static_catalog.py`, `test_build_kit_overlay.py` (exactly one skill
  embed), sdk `test_skill_template_catalog.py`.
- Docs sync: `documentation/skills.md` carries no old skill names (verified 2026-07-04 —
  nothing to change unless the playbook earns a mention);
  `documentation/agent-template.md` if it names the overlay skills; the
  builder-agent-reliability workspace pointer. Coordinate wording with the
  `docs/agent-skill-packaging` lane.

Acceptance: a fresh playground agent resolves getting-started (forced) + the playbook
(overlay), no old slug resolves anywhere, dev sweep empty.

## Slice 5: `test_run` end to end (Option C, confirmed; largest slice) [5a LANDED, 5b DEFERRED]

What landed (5a) is the server half: catalog handler mode (item 2), the SDK side of the
wire fields (spec-level `contextBindings`/`timeoutMs`, item 1 without the runner mirrors),
and the server handler + reserved-registry dispatch (item 4). Resolution of handler-mode
ops is flag-gated off (`AGENTA_AGENT_ENABLE_PLATFORM_HANDLERS`) until 5b lands the runner
half (item 3), the `protocol.ts`/golden mirrors, and the overlay + playbook flip (item 5).

Sequencing gate: coordinate the runner/wire surface first (constraint 2 above).

1. **Wire**: spec-level `context` next to `callRef` (today `context` exists only inside
   `call`: `protocol.ts:120-126`, `wire.py` mirror, `tools/models.py` `ToolCall` at
   :319) + per-op `timeout_ms` threading (`TOOL_CALL_TIMEOUT_MS` default 30s at
   `callback.ts:15-17`; `RELAY_TIMEOUT_MS` default 60s — in `relay.ts`, cite by name,
   the line moves with the pi-builtin-gating WIP). Golden fixtures
   (`sdks/python/oss/tests/pytest/unit/agents/golden/`), `protocol.ts`, `wire.py`, and
   both contract tests (`test_wire_contract.py`, runner
   `tests/unit/wire-contract.test.ts`) move together (runner CLAUDE.md rule). Useful
   standalone; lands first within the slice.
2. **Catalog handler mode**: `PlatformOp.handler` XOR (`method`+`path`) — mirror the
   existing `input_schema` XOR `input_schema_ref` validator (`op_catalog.py:89-119`);
   `method`/`path` become Optional. Resolver branch: `platform_tools.py` emits
   `call_ref=op.reserved_id` (property at `op_catalog.py:121-124`) + spec-level
   `context` for handler ops instead of `call=op.to_call()` (:77). The `test_run` entry
   sets `read_only=False` and NO explicit permission — under the merged permission plan
   that resolves to ask (approval) by default, with zero approval-machinery changes.
3. **Runner dispatch**: in `relay.ts` `executeAllowedRelayedTool`, the `callRef`
   (gateway) branch gains generic `$ctx` injection — resolve spec-level `context`
   bindings via `resolveCtxToken` (`direct.ts:129-147`) + `deepDelete`/`deepSet`, fail
   hard on an unresolvable binding exactly like `assembleBody` (`direct.ts:226-237`) —
   strictly AFTER the permission verdict in `executeRelayedTool` (the gate calls
   `permissions.decide(gate)`; do not touch it), then `callAgentaTool` as today.
4. **Server handler**: a handler registry in the tools domain replacing the deleted v1
   `tools.agenta.*` pin (slice 1): dispatch in `apis/fastapi/tools/router.py`, logic in
   `core/tools/`. The `test_run` handler per [api-design.md](api-design.md): resolve the
   bound variant's committed revision (`_ensure_request_revision` path,
   `core/workflows/service.py:2063`), apply the `delta` in memory, invoke headless with
   an internally signed token (`_prepare_invoke` at :2035-2071, `sign_secret_token`
   :2054-2062, `invoke_workflow` :2073 — one batch call returns the full transcript
   since #5064), spans query with retry (`POST /api/spans/query`) only for gated-write
   verification + resolved config, digest, verdict. Recursion guard
   (`meta.run_kind="test"` + the run-context flag) and the 120s duration cap.
5. **Overlay + skill**: add `test_run` to `DEFAULT_BUILD_KIT_OPS` (core goes to 9 +
   event 5 = 14 with `query_spans`); flip the playbook's test step from the
   `query_spans` interim wording to `test_run`.
6. **Tests**: handler unit tests (fake workflows service + fake spans), the golden wire
   contract pair, an op-catalog test for the handler mode + XOR validator, runner unit
   tests for `callRef` context injection (fail-closed on missing binding), a
   replay-style integration test if a live run is captured (agent-replay-test pattern).
7. Docs sync: `documentation/tools.md` (new server-handled-ops section; note the runner
   "no platform-specific code" line at :262 stays true — injection is generic),
   `interfaces/` pages touched by the wire change (`runner-to-tool-callback.md`,
   `tool-models-and-resolution.md`), and this workspace's api-design.md marked
   as-built.

Acceptance: the lab's capstone scenario run inside — build, `test_run`, read `pass`,
schedule; both wire contract tests green; a gated write in the child run surfaces in
`approvals` and verdict `unconfirmed`.

## Slice 6: `gateway` → `server` executor rename, or explicit defer [DEFERRED, defer-todo filed]

The rename proposal ([tool-home-options.md](tool-home-options.md)) is proposed, not
decided. Two outcomes, decided at PR review:

- **Rename now**: docs/comments/gate-label vocabulary (`documentation/tools.md`,
  interface pages, runner comments) renames cheaply; the persisted config literal
  (`type:"gateway"`, `GatewayToolConfig` at `sdks/.../tools/models.py:105-117`) is a
  data migration — fold it into the same revision-sweep script
  (`data.parameters.agent.tools[*].type`), plus the SDK discriminator, FE config forms,
  and the wire `kind` docs. The `callRef` field keeps its name either way.
- **Defer (default if unreviewed)**: file a defer-todo with the full scope above; land
  nothing. This keeps slice 6 droppable without unwinding slices 1-5.

Acceptance: either the sweep + grep show no `"gateway"` config literals on dev, or the
defer-todo exists and the PR description says so.

## Final verification + PR (after slice 6)

- Full test sweep (`sdks/python`, `api`, runner `pnpm test` + `pnpm run typecheck`, web
  unit) + `/debug-local-deployment` sanity.
- Live QA on the dev stack (post-#5059 env: `AGENTA_RUNNER_INTERNAL_URL` /
  `AGENTA_API_INTERNAL_URL` — stale env files silently break the runner→API loop): the
  worked example from `../builder-agent-reliability/context.md` (GitHub digest to
  Slack, twice daily) driven end to end through the playground.
- One PR against `big-agents` with the write-pr-description skill; slices as commits;
  provisional defaults (static-13, sync+delta, query_spans-now) called out for review.

## Test-and-docs discipline

Every slice carries its own tests and its own docs-sync (keep-docs-in-sync skill); no
slice defers either to the end. The interface inventory and the `documentation/` pages
are part of the diff, not a follow-up.

## Risks

- **Runner-surface contention (new, replaces the op_catalog risk):** slice 5's wire
  files are owned by the unpushed `feat/claude-client-tools-recut` lane AND carry
  another session's uncommitted pi-builtin-gating WIP (`relay.ts`,
  `permission-plan.ts`). GitButler hunk-locking to that lane's commits also covers
  `documentation/tools.md` + two interface pages in slice 1's docs sweep. Coordinate
  (board lease), sequence, or stack; never edit over live WIP.
- **Relay-gate adjacency:** the permission gate now runs inside `executeRelayedTool`
  before dispatch; pi-builtin-gating is adding harness-side permission relay requests in
  the same file. Keep the `$ctx` injection strictly inside the post-verdict `callRef`
  branch and re-run the runner permission tests unchanged.
- **Line-number churn in runner files:** cite functions, not lines, for `relay.ts` until
  the WIP lands (the merged-base citations in research.md are correct as of base
  `80a482b6c2`).
- **Revision sweep on prod** (renames + skill slugs + possibly `type:"gateway"`): dev is
  a script; prod needs the same sweep at deploy or old revisions break loudly
  (`UnknownPlatformOpError`). Pre-production-acceptable, but the PR must flag it.
- `query_spans` payload size may need the projection follow-up (slice 3 live check).
- The skills-port delivery claim (gotcha 1) still needs live verification before the PR
  description leans on it (one playground run; record the finding either way).
