# Exact client-tool continuation

Claude currently ends an Agenta client-tool turn by closing the internal MCP request without a
result. When the browser returns the result, the runner starts or loads a session and Claude asks
for the tool again. That path is safe, but it cannot preserve the original call id or arguments.

This project studied a faster exact path for local Claude sessions: keep the original MCP
request and harness prompt open, park the session, and write the browser result to that same
JSON-RPC request. After a Codex review on 2026-07-11, that warm path is **deferred behind two
measurement gates**: Claude must demonstrably hold the request open for a useful interval, and
cold replay must demonstrably harm users. What ships now is the measurement (WP0) and the
independent hardening of the loopback MCP endpoint (WP1). The design for the warm path stays
in this workspace as a revised note so the build can start quickly if the gates pass.

## Status

Design only. Implementation has not started. The warm-path deferral is the top review
question for the owner; see [status.md](status.md) and [open-questions.md](open-questions.md).

The scope is local Claude only. Pi approval parking is already implemented through the ACP
permission plane. Non-Pi Daytona runs cannot receive Agenta tools through the current internal
MCP endpoint because the endpoint binds to the runner's loopback interface.

## Documents

- [context.md](context.md) explains the current behavior, goals, scope, and user-visible result.
- [research.md](research.md) records the code findings and the effect of PRs #5153, #5185, and
  #5197.
- [interface.md](interface.md) is the design note for the deferred warm path: the
  pending-operation contract, the slimmed delivery port, and the pool-owned placement.
- [plan.md](plan.md) defines what ships now (WP0 expanded, WP1), the unlock gates, and the
  revised shape of the deferred warm path.
- [qa.md](qa.md) defines the verification layers; the layers beyond WP0 and WP1 apply only if
  the warm path unlocks.
- [open-questions.md](open-questions.md) lists the decisions that still need review, led by
  the deferral itself.
- [status.md](status.md) is the live source of truth for progress and dependencies.

## Proposed sequence

1. Measure Claude's MCP request timeout and the cold path's real user cost (WP0).
2. Authenticate and test the existing internal loopback MCP endpoint (WP1), independently.
3. Score the measurements against the unlock gates in [plan.md](plan.md).
4. Only if both gates pass, and only in owner-routed deployments: build the smallest
   pool-owned hold-open path per the revised design note, after PR #5197 merges.
