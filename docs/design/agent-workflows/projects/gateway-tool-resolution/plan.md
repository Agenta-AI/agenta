# Execution plan

Three phases, matching design.md D2. Each phase is independently shippable and valuable.
Phase 1 is the fast, safe fix. Phase 2 is the resilience change. Phase 3 is the deferred UX.

## Phase 1: Surface the resolver detail (D1, D2 option A)

Goal: the run error names the failing tool and the real reason. No contract change.

1. Add `detail: Optional[str]` to `ToolResolutionError` in
   `sdks/python/agenta/sdk/agents/tools/errors.py`, next to `status` and `reference`.
2. In `sdks/python/agenta/sdk/agents/platform/gateway.py`, in the `status_code >= 400`
   branch (lines 111-118), read the response body. Pull `detail` from the JSON error
   envelope. Fall back to a bounded slice of `response.text` when the body is not JSON or
   has no `detail`. Cap the length. Put the reason into both the exception message and the
   new `detail` field.
3. Keep the existing `status` and `ref_count` on the exception.
4. Confirm the enriched message reaches the run error unchanged. Resolution happens at
   `handler.py:275`, before the harness, so the exception string is the run error already.
   No downstream re-enrichment is needed.

Tests:

- Unit test in the SDK: a stubbed resolve response of
  `404 {"detail": "Action not found: composio/github/COMMIT_MULTIPLE_FILES"}` produces a
  `GatewayToolResolutionError` whose message and `detail` contain the sentence.
- Unit test: a non-JSON 500 body still yields a bounded, non-empty detail and does not raise
  a secondary error.
- Replay or live check: reproduce F-019's config and confirm the run error now names the
  tool. Use the agent-workflows QA harness, not an ad-hoc script.

Docs: none beyond the interface inventory if the exception field is documented there.

## Phase 2: Partial resolution with a loud warning (D2 option B)

Goal: a genuinely-absent action drops out with a visible warning; the agent runs with its
surviving tools. Connection, auth, and provider failures stay fatal.

1. Backend contract. Change `POST /tools/resolve` so `resolve_tools` in
   `api/oss/src/core/tools/service.py` collects per-reference outcomes instead of raising on
   the first bad reference. The response gains a per-reference failure list: reference,
   status, reason, and a failure kind (absent-action versus connection versus provider).
   Apply the `design-interfaces` review to the new response fields before coding them.
2. Classify failures. Only `ActionNotFoundError` becomes a droppable "absent-action"
   outcome. `ConnectionNotFoundError`, `ConnectionInactiveError`, `ConnectionInvalidError`,
   and `ToolSlugInvalidError` stay fatal. Provider and network errors stay fatal.
3. SDK. In `gateway.py`, build specs for the resolved references and read the failure list.
   For absent-action failures, drop the tool and collect a warning. For any fatal failure,
   raise `GatewayToolResolutionError` with the D1 detail. A batch with only absent-action
   failures resolves successfully with a warning; a batch with any fatal failure still
   fails.
4. Surface the warning to both audiences. The user sees a non-fatal run warning that names
   each dropped tool and why. The model sees a system note or run-context entry saying the
   tool was unavailable this turn, so it does not silently assume the tool exists. Inject
   this at the SDK or op-schema layer per the repo rule, not as a core-API behavior change.
5. Decide the warning transport. Options: a run annotation, a trace event, a system message
   the SDK prepends. Pick one and record it in status.md before building.

Open question to resolve before coding: is any tool "required"? If an agent's whole point is
one tool and that tool is the dead one, dropping it and running anyway may be worse than
failing. Consider a per-tool "required" flag, or a rule that an empty surviving tool set
fails rather than runs. Record the call in status.md.

Tests:

- Backend: a mixed batch (one absent action, several good tools) returns the good specs plus
  one absent-action failure, and does not raise.
- Backend: a connection failure in the batch still fails the whole resolve.
- SDK: absent-action-only batch resolves with a warning; any fatal failure raises.
- End to end: F-019's config runs with its four good GitHub tools and a visible warning about
  the dead one.

## Phase 3 (deferred): Config-level tool health (D2 option C)

Out of scope for this workspace. Scoped here so the follow-up has a starting point.

- Resolve a config's tools at commit or edit time and flag dead tools in the agent config UI.
- Reuse the "can this action resolve" check rather than duplicate it. If #5174 lands first,
  reuse its validate-on-discover primitive.
- Frontend work on the agent config screen: a per-tool health badge and a clear message.

## Coordination with #5174

- Do not couple. This plan ships without #5174 and #5174 ships without this plan.
- One shared primitive: a single "can this action resolve" check. Whichever plan lands first
  owns it; the other reuses it. See design.md D3.

## Sequencing

Phase 1 first and alone. It is small, safe, and closes the opacity problem. Phase 2 after,
once the warning transport is chosen. Phase 3 is a separate future project.
</content>
