# Status: Chat Interface RFC

## Current Phase: Phase 1 + 1b Implemented, Awaiting Frontend Updates

**Last Updated:** 2026-02-09

## Summary

Research is complete. We understand:
1. How OpenAPI specs are generated (two systems: legacy and new workflow)
2. How `WorkflowFlags` flows through the system
3. Where to add `is_chat` flag
4. How Fern client is generated (from backend OpenAPI spec)
5. **CRITICAL: Custom workflows use the LEGACY system, not the new workflow system**

## Key Finding

**Custom workflows built by users use the LEGACY system** (`@ag.entrypoint`, `@ag.route` from `serving.py`):
- SDK templates
- Documentation examples
- Builtin chat/completion services

The new workflow system (`routing.py`) is used for internal orchestration only.

**Implication:** To enable `is_chat` for user-facing custom workflows, we MUST update the legacy system.

## Decisions Made

| Decision | Rationale |
|----------|-----------|
| **Target legacy system first** | Custom workflows use legacy decorators, not new workflow system |
| Add `flags` parameter to legacy `@ag.route`/`@ag.entrypoint` | Aligns legacy API with the newer flags-based interface |
| Emit `x-agenta.flags` in legacy OpenAPI | Explicit, stable chat discovery via `/openapi.json` |
| Add `flags` parameter to new `@ag.route` | Interface consistency across systems |
| (Optional) Add `is_chat` to `WorkflowFlags` | Type-hint / documentation for the new system |
| Keep heuristic as fallback | Backward compatibility for existing apps |

## Key Finding: Fern Client Generation

The Fern client (`sdk/agenta/client/backend/`) is **not** manually maintained. It's generated from the backend's OpenAPI spec:

```bash
# Script location: sdk/scripts/setup_fern.sh
# Source: https://cloud.agenta.ai/api/openapi.json (or local)
```

**Implication:** To add `is_chat` to the client:
1. Add to `api/oss/src/core/workflows/dtos.py` (backend API model)
2. Deploy backend (or use local spec)
3. Run `./sdk/scripts/setup_fern.sh` to regenerate client

## Files Identified for Changes

### Phase 1: Legacy System (User-Facing Custom Workflows)

| File | Change | Status |
|------|--------|--------|
| `sdk/agenta/sdk/decorators/serving.py` | Add `flags` param to `route`/`entrypoint` classes | Done |
| `sdk/agenta/sdk/decorators/serving.py` | Emit `x-agenta.flags` in OpenAPI schema in `openapi()` | Done |
| `services/oss/src/chat.py` | Set `flags={"is_chat": True}` on `@chat_route` | Done |

### Phase 1b: New Workflow System (Internal)

| File | Change | Status |
|------|--------|--------|
| `sdk/agenta/sdk/decorators/routing.py` | Add `flags` param to `route` class, pass to `auto_workflow()` | Done |
| `sdk/agenta/sdk/models/workflows.py:90-94` | Add `is_chat: bool = False` to `WorkflowFlags` (optional, for type hints) | Done |
| `api/oss/src/core/workflows/dtos.py:101-104` | Add `is_chat: bool = False` to `WorkflowFlags` (optional) | Done |
| `sdk/agenta/client/backend/types/workflow_flags.py` | Auto-regenerate via Fern | Deferred |

**Note:** The `flags` field in `WorkflowServiceRequest` is `Dict[str, Any]`, so adding `is_chat` to `WorkflowFlags` model is optional but recommended for documentation.

### Phase 2: Frontend (Future)

| File | Change | Status |
|------|--------|--------|
| `web/oss/src/lib/shared/variant/genericTransformer/index.ts` | Read `x-agenta.flags.is_chat` from OpenAPI | Not started |
| `web/oss/src/components/Playground/state/atoms/app.ts` | Update chat detection | Not started |

## Cross-PR Tracking

This feature spans multiple PRs:

| PR | Branch | Scope | Status |
|----|--------|-------|--------|
| [#3622](https://github.com/Agenta-AI/agenta/pull/3622) | `feat/new-chat-interface` | SDK: `flags` support + `x-agenta.flags` OpenAPI extension | In review |
| [#3623](https://github.com/Agenta-AI/agenta/pull/3623) | `feat/chat-interface-eval-detection` | API: Evaluation chat detection (stacked on #3622) | In review, needs rebase after #3622 merges |
| TBD | TBD | Frontend: Read `x-agenta.flags.is_chat` for UI decisions | Not started |

### PR #3622 Review Status

Review by Devin (automated reviewer). All threads resolved:

1. **`auto_workflow()` flags merge** — Fixed: flags are now merged into existing workflows on early-return paths (not silently ignored)
2. **Vendor extension naming** — Changed from `x-agenta-flags` to nested `x-agenta: { flags: {...} }` per reviewer request
3. **Backward-compatible alias** — Removed entirely (PR isn't merged, no need for backward compat)
4. **Dict-iteration bug in `application.__init__`** — Fixed: `for key in dict` while `del dict[key]` caused `RuntimeError`. Now builds key list first.
5. **Dict-iteration bug in `evaluator.__init__`** — Fixed: Same pattern, same fix.

## Progress Log

### 2026-02-09
- Rebased on latest `main` (large merge)
- Fixed dict-iteration bug in `application.__init__` (line ~588 in `running.py`): was iterating over `kwargs["references"]` while deleting keys matching `evaluator_*`
- Fixed same dict-iteration bug in `evaluator.__init__` (line ~691 in `running.py`): was iterating while deleting keys matching `application_*`
- Updated RFC docs to reflect current state

### 2026-02-03
- Created design workspace at `docs/design/chat-interface-rfc/`
- Researched OpenAPI generation in both legacy and new workflow systems
- Identified `WorkflowFlags` model locations
- Discovered Fern client generation process
- Documented implementation plan
- Implemented legacy `flags` support and `x-agenta.flags` emission in OpenAPI
- Updated builtin chat service to set `flags={"is_chat": True}`
- Added `flags` support to new `@ag.route` and propagated to `auto_workflow()`
- Added `is_chat: bool = False` to `WorkflowFlags` in SDK and API models
- Manually tested deployment at http://144.76.237.122:8180 - verified `x-agenta.flags.is_chat` appears in OpenAPI

## Next Steps

1. **Merge PR #3622** after review approval
2. **Rebase PR #3623** onto updated `feat/new-chat-interface` (update `x-agenta-flags` references to `x-agenta.flags`)
3. **Phase 2:** Update frontend chat detection to read `x-agenta.flags.is_chat` (preferred) with heuristics fallback

## Current State Summary

### New Workflow System (`@ag.route` from `routing.py`)

**Does `@ag.route(flags={"is_chat": True})` work?** **YES**

`route` now accepts `flags` and forwards them to `auto_workflow()`.

### Legacy System (`@ag.route` from `serving.py`)

**Does `@ag.route(flags={"is_chat": True})` work?** **YES**

Legacy `route`/`entrypoint` now accept `flags` and emit `x-agenta.flags` in OpenAPI.

## Open Questions

1. **Should we emit `x-agenta.flags` on `/run`, `/test`, or both?**
   - Decision: implemented for both `/run` and `/test` to avoid mode-specific gaps.

2. **Should `is_chat` be inferred from input signature?**
   - If function has `messages: List[Message]` parameter, auto-set `is_chat: true`?
   - Decision: Start with explicit declaration, consider auto-inference later

3. **Should we update both systems or just one?**
   - Legacy: Required for user-facing custom workflows
   - New: Nice to have for internal consistency
   - Decision: Start with legacy (Phase 1), then new (Phase 1b)

## Blockers

None currently.
