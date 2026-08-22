# Implementation plan

## Slice 1: write-only contract and runtime boundary (#6164)

Implement separate trusted and public response roles, replace key-specific metadata with `value_status`, make `write_only` creation-time immutable, restore canonical list caching followed by per-caller redaction, move update policy into a pure resolver executed under the DAO lock, centralize the runtime grant, require only the dedicated internal-service key, preserve provider-specific environment fallback, and keep SSO plus webhook secrets explicitly readable.

Acceptance checks:

- Cached and uncached ordinary callers receive identical redacted responses.
- Cached and uncached granted runtimes receive identical plaintext trusted responses.
- Create supports `write_only`; update cannot change it.
- Omitted update credentials are carried from the locked row without crossing secret identity.
- SSO and webhook creation remain readable even when the default is write-only.
- Generated OpenAPI and Fern types include the final public contract.
- Focused API, SDK, services, configuration, and generated-client checks pass.

## Slice 2: structured management (#6165)

Replace free-form public `managed_by` with an internal structured owner and a public policy projection. Remove client-settable ownership, empty-string clearing, the generic `allow_managed` bypass, and the rule that management implies write-only. Keep management metadata in encrypted JSON with unmanaged defaults for existing rows. Enforce user update and delete policy atomically while leaving transaction mechanics in the DAO.

Acceptance checks:

- Public create and update contracts cannot express manager ownership.
- Public responses expose only `management.policy`.
- Existing rows remain unmanaged without migration.
- A managed row rejects user update and delete under the row lock.
- A normal row keeps existing update and delete behavior.
- Management and `write_only` can vary independently in domain tests.

## Slice 3: starter-credit owner (#6138)

Create the starter-credit connection through an internal managed-secret path with `manager=starter-credits-bridge`, `policy=manager_only`, and explicit `write_only=True`. Keep bridge identity separate from the public product name and centralize cache invalidation at the Vault mutation boundary.

Acceptance checks:

- A new starter-credit row stores both policies explicitly.
- The bridge does not use an ownership bypass for update or delete.
- Internal creation invalidates the Vault list cache.
- Existing seeding, failure cleanup, and spending limits remain covered.

## Slice 4: frontend and probe consumers (#6174 and #6195)

Regenerate Fern after the backend contract is final. Remove handwritten response intersections and casts. Drive UI behavior from `management.policy` and `value_status`. Reject stored-credential probing for platform-managed rows before merging a caller-selected endpoint.

Acceptance checks:

- Frontend packages compile against generated types without manual backend-field extensions.
- Managed connection visibility and editing behavior match the approved UX.
- A managed stored secret cannot be probed.
- User-managed stored-secret probe behavior and credential-free responses remain unchanged.

## Slice 5: validation and release handoff

Run formatters, focused tests, broader local suites, generated-client build, frontend unit tests and type checks, and the available local end-to-end checks. Review each immediate-base diff before pushing. Update PR descriptions and signed comments with exact changes, tests, risks, and QA steps.

Acceptance checks:

- Every available local check is green or has a documented unrelated failure.
- Railway-only checks are listed as deferred, not reported as passed.
- Each PR contains only its intended dependency delta.
- Local and remote branch SHAs match after push.
- `implementation-report.md` and `qa.md` let a reviewer continue without this chat.
