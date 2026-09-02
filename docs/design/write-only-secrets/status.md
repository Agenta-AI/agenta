# Status

Status: implementation complete; local verification green

Date: 2026-08-23

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
- Updated every Python SDK redaction consumer to use `value_status.configured`; no production
  `has_key` compatibility path remains.
- Kept one strict co-release update contract: omitted credentials are preserved, explicit blank
  credentials are rejected, and the frontend omits untouched credentials.
- Kept managed rows hidden only from Settings/edit surfaces and available to agent runtime and
  model selection.
- Kept all edits outside the active pi-traces lanes and generated session/trace contracts.

## Known constraints

- The workspace contains unrelated uncommitted work. No unrelated file was staged, committed,
  reformatted, or discarded.
- Deployed acceptance tests require `AGENTA_API_URL` and `AGENTA_AUTH_KEY`; no local deployment
  was loaded for this pass.
- One SDK-to-runner streaming assertion reflects the parallel pi-traces lane and its new transient
  `environment_starting` event. It is outside this stack and was excluded from the secrets unit
  gate; no runner or pi-traces file was changed.
- Railway-dependent checks are unavailable and are listed as deferred in `qa.md`.

## Next acceptance point

After repository CI, execute the manual same-release QA in `qa.md`, including the deployed
backend/frontend edit flow and Railway-dependent checks when Railway is available.
