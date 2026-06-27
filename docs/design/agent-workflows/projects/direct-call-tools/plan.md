# Direct-call tools — plan and workstream split

Date: 2026-06-27
Owner of this doc: the agent in the design conversation with Mahmoud (Workstream A).

This is the hand-off file. Point the orchestrator here instead of copy-pasting. It holds the
decision, the two workstreams, the PRs each touches, the sequencing, and the open decisions.

---

## The decision (context)

A resolved tool should carry where to call. The sidecar then calls reference and platform
tools directly, and only gateway (Composio) tools route through `/tools/call`.

Why, in one paragraph: today every callback tool POSTs to the single `/tools/call`, which
re-parses a string and re-dispatches. For a **reference** (a stored workflow used as a tool)
and a **platform** tool (an Agenta operation like create-workflow or annotate), the target is
just an Agenta endpoint, and the sidecar already holds the caller's credential. So the
`/tools/call` hop adds a step and no value. **Gateway** is the one real exception: only the
server can read the Composio secret, so gateway stays server-side.

Two more decisions made in the same conversation:

- **Drop the `@ag.reference` marker.** A reference tool is just `type:"reference"` in the
  config `tools` list. The marker was authoring sugar for symmetry with skills. Keep the tool
  type; remove the marker machinery.
- **Keep `@ag.embed`** (a different feature: it inlines a value). For now, do **not** show
  embed in the tool-authoring UI.

---

## PR map

| PR | State | Branch → base | Role |
|----|-------|---------------|------|
| **#4860** | open, not draft | `feat/agent-embedref-tools` → `big-agents` | Backend/SDK reference tool. Added `type:"reference"`, the `@ag.reference` marker, and the `workflow.*` routing in `/tools/call`. |
| **#4877** | draft | `fe-feat/agent-embedref-tools-onbig` → **#4860** | Frontend, stacked on #4860. Authors a reference tool via the marker. |
| **#4837** | open | `docs/agent-embedref-tools` → `big-agents` | Design doc for the two-syntax (embed/reference) plan. |
| **#4863** | draft | `docs/agent-creation-skills` → `big-agents` | The custom-tools design note. Mahmoud's line-67 comment ("no calls between two API endpoints, use direct service calls") is the seed of this whole plan. |

#4877 is stacked on #4860, so the two move together.

---

## Workstream B — drop the marker, rebuild the FE on the tool type

**Route this to a subagent. Touches #4860 and #4877 (and a doc note on #4837). Self-contained;
can start now. Does NOT need Workstream A.**

### Context for the subagent

A reference tool is `type:"reference"` in the config `tools` list. We are removing the
`@ag.reference` marker but keeping the tool type and keeping reference tools working through
the **existing** `/tools/call` `workflow.*` routing (do not remove that here — that removal
belongs to Workstream A, and removing it now breaks reference execution). `@ag.embed` stays in
the backend untouched; we only hide it from the tool UI.

### Tasks on #4860 (backend/SDK)

1. Remove the marker path: `AG_REFERENCE_MARKER` and `_coerce_reference_tool`
   (`sdks/python/agenta/sdk/agents/tools/compat.py`), the `AG_REFERENCE_KEY` "leave it" guards
   in `api/oss/src/core/embeds/utils.py`, and the generic-resolver logic that keeps the
   marker node. Keep `ReferenceToolConfig` (`type:"reference"`), the resolver mapping to
   `CallbackToolSpec`, and the `/tools/call` `workflow.*` routing.
2. Leave `@ag.embed` fully intact.
3. Add environment/variant targeting to `ReferenceToolConfig`. The author picks one axis, then
   takes the latest or pins a revision. Suggested shape (implementer finalizes names):
   - `ref_by: "variant" | "environment"`
   - `slug: str` (the variant slug or the environment slug)
   - `version: Optional[str]` (absent = latest; set = pin that revision)
   - existing `name` / `description` / `input_schema`
   Map these to the workflows service references (`workflow_variant` vs `environment`, slug +
   version) — `resolve_references_with_info` already resolves by variant and by environment.
   Wire them through `_call_workflow_tool` → `WorkflowServiceRequest.references` so env/variant
   works end-to-end through the current routing.
4. Update the tests that assert the marker (`test_utils.py`, `test_parsing.py`,
   `test_models.py`, `test_resolver.py`, `test_workflow_resolver.py`) and the interface docs in
   #4860 (`tool-models-and-resolution.md`, `agent-config-schema.md`, `tools.md`,
   `runner-to-tool-callback.md`) to describe `type:"reference"` only.

### Tasks on #4877 (frontend)

1. Author a reference tool as `type:"reference"`, not the marker.
2. Reference selector UI: choose environment or variant, then latest or a specific revision
   (consume the schema from task B-3).
3. Do not surface embed in the tool UI. Keep it in the backend/model; just hide it.
4. Retitle the PR away from "@ag.reference".

### Doc note

Note the marker removal on #4837 (the design PR), since it describes the two-syntax plan.

---

## Workstream A — direct-call tools architecture

**This agent owns it, via `/plan-feature`. New project under
`docs/design/agent-workflows/projects/direct-call-tools/`. Supersedes the execution half of
#4860 and answers #4863's line-67 comment.**

Scope the plan will cover:

1. **`call` descriptor on the resolved spec.** Add optional `call: { method, path, body }` to
   `CallbackToolSpec` (SDK `tools/models.py`) and `ResolvedToolSpec` (`protocol.ts`). `path`
   is **relative** (Agenta-only); the sidecar joins its own base from env, so a tool can never
   target a non-Agenta host. `body` holds server-fixed fields.
2. **Sidecar dispatch.** New `if (spec.call)` branch in `dispatch.ts`: join base + path, reuse
   the run's authorization, merge `{...modelArgs, ...spec.call.body}` so fixed fields win and
   the model cannot retarget. Daytona: the host-side relay handler makes the direct call; the
   sandbox still sends only name + args.
3. **Reference goes direct.** SDK resolver emits a `call` to the invoke endpoint (**batch,
   not stream**), with env/variant/version baked into `body`. Tool result = `data.outputs` +
   `trace_id`; the sub-run nests in the trace for the user, the model gets the final output.
   Remove the `/tools/call` `workflow.*` routing. Move the recursion/budget guard to the
   invoke endpoint.
4. **Platform tools (thin wrappers over EXISTING endpoints).** New `type:"platform"` config
   (`op` = which existing endpoint to expose, + permission/approval overrides). A platform-op
   catalog where **descriptions live in the SDK** and **input schemas reuse the in-process schema
   catalog** (`CATALOG_TYPES`, via `x-ag-type-ref`). The SDK owns the `op → {method, relative
   path}` table and emits the `call`. Mirror the reserved-tool pattern from PR #4884
   (`tools.agenta.find_capabilities`); `find_capabilities` is the first platform tool (its SDK
   emission is the deferred item below). **No new endpoints and no logic-wrapping tools** (no
   `update_own_workflow` / `add_trace_annotation` — those are the rejected first version; the
   harness calls raw endpoints and composes multi-step ops via a skill). Each op is gated by its
   endpoint's own permission plus spec-level `needs_approval`. Depends on the run-context delivery
   mechanism (`runContext` on `/run` + tool `bind`; see `run-context.md`) so tools can bind the
   agent's own trace/variant server-side.
5. **Gateway unchanged**, and `/tools/call` shrinks to the gateway-only executor.
6. **Stretch (flag out-of-scope unless cheap):** forward the trace context to the sub-workflow
   on a reference invoke, so the child run links under the parent.
7. Reply to the line-67 comment on #4863 and reconcile `custom-tools-design.md` with this
   project doc.

---

## Sequencing and dependencies

- **B lands first** and keeps reference working through the existing routing.
- **A supersedes B's execution path:** moves reference to direct, removes the routing, adds
  platform tools. A **reuses** B's env/variant schema; it does not re-add it.
- The two are mostly disjoint planes while in flight: B is SDK config + API routing + FE; A is
  the resolved-spec `call` descriptor + sidecar dispatch + platform catalog. The shared file to
  coordinate is `sdks/python/agenta/sdk/agents/tools/models.py` (B edits `ReferenceToolConfig`,
  A adds `call` to `CallbackToolSpec`) — different classes, but same file, so serialize commits.

## Sequencing notes (orchestrator's call)

Mahmoud reviewed the design and is aligned with all the decisions. Per his note, merge order and
commit organization are the orchestrator's to decide; the only standing requirement is the
ability to review before merge. So the items below are sequencing notes, not decisions Mahmoud
owes.

1. **When to remove the `/tools/call` workflow routing.** It belongs to A (reference stops
   executing the moment it is gone unless the direct path exists). Recommendation: keep it in A,
   after B lands. If removed in B instead, reference tools go dark until A lands.
2. **Trace-context forwarding to the sub-workflow** (item A-6): a Phase 6 stretch, likely
   deferred past the first cut.

---

## Execution phases (Workstream A)

Detailed design is in `design.md`; code seams in `research.md`. Phases are ordered so the
gateway path never breaks and the live stack stays green between milestones.

- **Phase 1 — the `call` descriptor (plumbing, no behavior change).** Add optional `call` to
  `CallbackToolSpec` (SDK `tools/models.py`) and `ResolvedToolSpec` (`protocol.ts`), mirror in
  `wire.py`, update the golden `/run` fixtures + both contract tests. No resolver emits it and
  no dispatch reads it yet, so behavior is unchanged. **Touches the shared `models.py` — gated
  on B (see `status.md`); do the protocol.ts/wire/golden side first, fold the `models.py`
  field after B commits.**
- **Phase 2 — sidecar direct branch.** Add `if (spec.call)` to `dispatch.ts` and the host relay
  handler (`relay.ts executeRelayedTool`), with `assembleBody` (the `args_into` deep-set vs the
  fixed-wins merge). Unit-test with fake `call` specs. Live behavior still unchanged (nothing
  emits `call`). Runner vitest green.
- **Phase 3 — platform tools (thin endpoint wrappers).** New `type:"platform"` config; the
  platform-op catalog (descriptions in the SDK, input schema via the in-process `CATALOG_TYPES`
  catalog; mirrors the reserved `tools.agenta.*` pattern from PR #4884); resolver emits `call` for
  platform ops. First op = `find_capabilities` (its SDK emission is the Deferred item below, from
  PR #4884), then a small set of EXISTING endpoints exposed as-is (e.g. commit-revision,
  create-annotation-trace, workflow create/query, `/inspect`). No new endpoints, no logic-wrapping
  tools. Includes the run-context mechanism (`runContext` on `/run` + tool `bind`; see
  `run-context.md`) so self-targeting tools bind the agent's own trace/variant server-side.
  Largely independent of B. SDK + service tests + a live E2E.
- **Phase 4 — reference goes direct (gated on B).** Resolver emits `call` for reference using
  B's env/variant schema; confirm/clean the `/api/workflows/invoke`-style endpoint and move the
  recursion/budget guard there; remove the `/tools/call` `workflow.*` routing. Tests + live E2E.
  Depends on B landed and on the sequencing note above.
- **Phase 5 — gateway cleanup + docs.** `/tools/call` shrinks to gateway-only. `keep-docs-in-sync`:
  the interface inventory, `tools.md`, `agent-config-schema.md`, and a reply on #4863 reconciling
  `custom-tools-design.md`.
- **Phase 6 — stretch.** Trace-context forwarding to the sub-workflow on a reference invoke.

---

## Deferred items

**Date recorded:** 2026-06-27
**Provenance:** tool-discovery Phase 2, PR #4884

**SDK-side reserved-tool emission for `find_capabilities` is not built.**

The server accepts `tools.agenta.find_capabilities` (router `_call_agenta_tool` →
`ToolsService.discover_capabilities`; the fixed spec lives in
`api/oss/src/core/tools/discovery.py`: `FIND_CAPABILITIES_CALL_REF / _OP / _DESCRIPTION /
_INPUT_SCHEMA`).

What is missing: making `platform.resolve_tools` (SDK `agenta.sdk.agents` tools resolver) emit
a `CallbackToolSpec` with `call_ref=tools.agenta.find_capabilities` plus the shared
`ToolCallback`, so an agent config can carry the tool and the model can actually call it
end-to-end. The runner needs no change — it forwards the call_ref opaquely (confirmed).

This was deferred because it overlaps Workstream A's platform-op catalog mechanism (Phase 3
above), which adds `CallbackToolSpec.call` and platform-op resolution to the same SDK
`tools/models.py` / `resolver.py`. Building a parallel mechanism now would conflict.

**Action:** implement this on the direct-call-tools / Workstream A seam (the `type:"platform"`
catalog), treating find_capabilities as the first platform op. Until then, find_capabilities is
API-callable but NOT agent-usable end-to-end, which blocks the end-to-end skills QA of the
discover-and-wire-tools skill.

---

### Coordination and PRs

- Phases 1-3 are mostly disjoint from B (platform tools do not touch the reference config). The
  one shared surface is `models.py` in Phase 1 — serialize via first-committer-owns.
- Likely two GitButler lanes on `big-agents`: (a) the direct-call core (`call` descriptor +
  dispatch + platform tools, Phases 1-3); (b) reference-direct + routing-removal (Phases 4-5),
  stacked after B lands. Do NOT merge to `big-agents` (the orchestrator folds back).
- Test matrix per `implement-feature`: wire contract both sides, SDK unit, service unit, runner
  vitest, then the live daytona / local-pi / claude x SDK / UI cells. `debug-local-deployment`
  between milestones.
