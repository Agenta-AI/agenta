# Write-only and managed secrets QA

## Preconditions

- Deploy the full stack rooted in `release/v0.114.0`.
- Set the same non-placeholder `AGENTA_SERVICES_INTERNAL_KEY` on the API and Services.
- Confirm the key is absent from web, runner, sandbox, worker, cron, and migration containers.
- Use a project with one ordinary provider key and starter credits enabled.

## Release-blocking flows

### 1. Configuration fails closed

1. Start the API with the internal key absent.
2. Repeat with `AGENTA_SERVICES_INTERNAL_KEY=replace-me`.
3. Set a real matching value on API and Services and start again.

Expected:

- The first two starts fail with an error naming `AGENTA_SERVICES_INTERNAL_KEY`.
- The configured deployment starts.
- No log prints the configured value.

### 2. Ordinary write-only provider key

1. Create an OpenAI provider connection.
2. Inspect the create and list responses.
3. Reload Settings and edit only its models or display name without re-entering the key.
4. Try to submit an update that changes `write_only`.
5. Delete and recreate it if a different visibility policy is required.

Expected:

- The value is never returned to the browser.
- `value_status.configured=true`; preview is optional and safe.
- The unrelated edit keeps the stored key.
- The API refuses a visibility-policy change.

### 3. Cache and invalidation

1. List secrets twice and confirm the second request uses the shared cache.
2. Compare an ordinary caller's list with a granted runtime list from the same cached entry.
3. Create, update, and delete a secret, listing after each mutation.
4. Run a batch evaluation or repeated completion/chat calls that resolve the same project secrets.

Expected:

- Ordinary callers always receive redacted values.
- Granted runtimes receive plaintext needed for execution.
- Cache hits and misses produce the same caller-visible response.
- Each mutation becomes visible immediately; no stale row lasts until TTL.
- Repeated runtime resolution does not cause one database list query per call.

### 4. Runtime and standalone fallback

1. Run an agent with a stored write-only provider connection through the platform Services path.
2. Verify Services sends the internal header only on the access exchange.
3. Verify the runner receives a short-lived granted token, not the internal key.
4. Run the standalone SDK with the Vault value redacted and the matching provider environment
   credential set.
5. Repeat without the matching environment credential and with an unrelated provider credential.

Expected:

- The platform run succeeds.
- The internal key never reaches the runner or sandbox.
- The matching standalone fallback succeeds.
- Missing or unrelated credentials fail clearly and are never borrowed across providers.

### 5. SSO and webhook regression

1. Create and edit an SSO provider without changing its client secret.
2. Test the SSO provider and complete a login.
3. Create a webhook subscription and verify a signed delivery.
4. Read the SSO and webhook secret through their existing authorized flows.

Expected:

- Both are stored with `write_only=False`.
- Existing edit, test, login, and signature-verification flows continue unchanged.

### 6. Managed starter-credit connection

1. Trigger starter-credit seeding for a new eligible project.
2. Inspect the internal Vault row and public list response.
3. Open Settings and the provider drawer.
4. Open agent creation and the model picker, then run a seeded model.
5. Attempt public update, delete, and `/providers/probe` with the managed secret ID and an
   overridden URL.

Expected:

- The stored row has `manager=starter-credits-bridge`, `policy=manager_only`, and
  `write_only=True`.
- The public response exposes only `management.policy=manager_only`.
- The row is hidden from Settings/edit surfaces.
- It remains available to agent defaults, key gating, model selection, and execution.
- Update, delete, and probe all return HTTP 409.
- No outbound probe request is made.

## Additional checks

- Confirm Python and TypeScript clients contain `PublicSecretResponseDto`,
  `SecretValueStatus`, `SecretManagementPolicy`, and provider-probe types.
- Confirm public create/update schemas contain no manager identity or management bypass.
- Confirm cache keys retain the existing shortened project/user UUID segments.
- Confirm an existing row without `write_only` remains readable and one without `management`
  remains user-managed.

## Deferred external checks

Railway-dependent deployment and end-to-end checks are blocked while Railway is unavailable.
Run the same release-blocking flows on the Railway preview before merge or release, and record the
preview URL, build SHA, and result in the PR QA comment.
