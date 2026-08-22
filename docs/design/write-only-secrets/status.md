# Status

Status: implementation complete; local verification green

Date: 2026-08-22

## Current work

- Refreshed all five live PR heads, bases, and the local GitButler stacks.
- Implemented the approved write-only contract, cache boundary, runtime grant, dedicated
  internal-key validation, immutable creation policy, and explicit SSO/webhook readability.
- Replaced the free-form manager marker with typed internal ownership and public
  `management.policy`, enforced under the DAO row lock without a boolean bypass.
- Updated seeded credits to create an explicitly managed, explicitly write-only secret.
- Rejected probing any managed stored credential before applying caller overrides.
- Regenerated the Python and TypeScript Fern clients from the final EE OpenAPI contract.
- Updated the frontend to use Fern's `value_status`, `management.policy`, and probe method.
- Kept managed rows hidden only from Settings/edit surfaces and available to agent runtime and
  model selection.
- Kept all edits outside the active pi-traces lanes and generated session/trace contracts.

## Known constraints

- The local secrets lane tips were rebased after their last push, so final pushes require SHA verification.
- The workspace contains unrelated uncommitted work. No unrelated file may be staged, committed, reformatted, or discarded.
- Railway-dependent checks are unavailable and are listed as deferred in `qa.md`.

## Next acceptance point

Push each reviewed lane, verify its remote SHA and immediate PR base, then execute the manual
release QA in `qa.md`.
