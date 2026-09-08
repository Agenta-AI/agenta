# Implementation contract (working, reversible)

This is the shared contract for the exploratory implementation. Four code tracks build against it
in parallel: API, SDK and agent service, runner, and web. It records working decisions, not
approved requirements. Change it through the [communication log](communication-log.md) when a
track learns something that breaks it.

Sources: [research/codex-auth.md](research/codex-auth.md), [research/pi-auth.md](research/pi-auth.md),
[research/product-code-map.md](research/product-code-map.md).

## Decisions

| Decision | Choice | Why |
| --- | --- | --- |
| Harness for the first path | Pi (`pi_core`, provider id `openai-codex`) | Pi has a cross-process lock, a loser-takes-winner refresh, and a programmatic headless device login. Codex support is optional and can consume the same login through a format conversion later. |
| Scope | Project | Every vault route, the permission check, gateway connections, and the store key layout are project-scoped. |
| Record | A new vault secret kind `subscription_provider` in the existing `secrets` table | The row is already project-scoped, slugged, and encrypted with pgcrypto. No new table. |
| Where the login runs | The runner, through `pi-ai`'s `loginOpenAICodexDeviceCode` | The official client code performs the OAuth exchange. The API only relays the user code and the verification address. |
| Where the tokens live between runs | In the secret row (encrypted), delivered to the runner inside the run request | Same channel as vault keys today. No mount semantics for a 2 KB file. The mount option stays measured separately. |
| Who refreshes | The harness (Pi) inside the session | Pi already does it with its lock. The runner only materializes before a run and pushes the newer login back after a turn. |
| Concurrent refresh loser | Pi reloads the local file under its lock and uses the winner's token when both sessions share one runner. Across runners the loser fails the turn; the runner reports the failure with the version it used; the API answers `stale` when a newer login exists, and the UI offers Try again. | Matches Mahmoud's rule: a failed competing refresh is fine if the loser recovers. |
| Re-login | A new device login replaces the login in place and bumps `login_generation`. Sessions on the old generation start cold on their next turn. | A running Pi process never re-reads a rewritten file when its cached token is unexpired. |
| Daytona | In scope. The runner delivers the login file into the sandbox on in-VM disk at session start and reads it back after each turn. The old `runtime_provided` rejection on Daytona is removed for subscription runs. | Cloud sessions run on Daytona. Mahmoud confirmed this scope on 2026-09-08. |

## 1. Secret kind `subscription_provider` (API)

`SecretKind.SUBSCRIPTION_PROVIDER = "subscription_provider"`. Enum value added by an alembic
migration on the `core_oss` chain (`ALTER TYPE secretkind_enum ADD VALUE`).

Data payload (`SubscriptionProviderDTO`):

```json
{
  "kind": "subscription_provider",
  "provider": "chatgpt",
  "harnesses": ["pi_core"],
  "models": ["gpt-5.6-sol", "gpt-5.6-terra", "gpt-5.6-luna", "gpt-5.5", "gpt-5.4", "gpt-5.4-mini", "gpt-5.3-codex-spark"],
  "login": {"type": "oauth", "access": "...", "refresh": "...", "expires": 1789000000000, "accountId": "..."},
  "login_version": 3,
  "login_generation": 1,
  "login_state": "ready",
  "login_error": null,
  "login_attempt": {"id": "...", "expires_at": "2026-09-08T12:00:00Z"}
}
```

- `provider` is the product family. `chatgpt` is the only value now. Grok would be a second value.
- `harnesses` defaults to `["pi_core"]`. `models` defaults to the Pi `openai-codex` list in
  `sdks/python/agenta/sdk/agents/capabilities.py` (`PI_SUBSCRIPTION_MODELS`).
- `login` is the Pi-format credential. It is write-only: never returned to a browser. The
  redaction layer treats `login` and `login_attempt` as primary credential fields. A read returns
  `login_state`, `login_version`, `login_generation`, `login_error`, and `value_status.configured`
  (true when a login exists).
- `login_version` increments on every stored login change (new login or pushed refresh).
  `login_generation` increments only on a new login. Both start at 0 with no login.
- `login_state`: `pending_login` (no usable login yet), `ready`, `needs_login` (a run reported a
  dead login and no newer one exists).
- Header name defaults to `ChatGPT`; the slug derives from the name as for other kinds. One
  subscription connection per project per provider is enough for now; the API rejects a second
  `chatgpt` one with a 409.

Model keys for the picker (mirroring `custom_provider`): `chatgpt/<model>`.

## 2. Login attempts (browser, API, runner)

### API routes (vault router, permission `EDIT_SECRET`)

```
POST /secrets/{secret_id}/login-attempts
  -> 200 {"attempt_id", "state": "pending", "user_code", "verification_uri", "expires_at", "poll_after_ms"}
GET  /secrets/{secret_id}/login-attempts/{attempt_id}
  -> 200 {"attempt_id", "state": "pending" | "succeeded" | "failed" | "expired" | "cancelled",
          "user_code", "verification_uri", "expires_at", "poll_after_ms", "error": null | "..."}
POST /secrets/{secret_id}/login-attempts/{attempt_id}/cancel
  -> 200 {"attempt_id", "state": "cancelled"}
```

- Start is idempotent while an unexpired attempt exists: it returns that attempt.
- The GET must advance the attempt: it asks the runner every time. When the runner reports
  `succeeded` with a login, the API stores the login, sets `login_state=ready`, bumps
  `login_version` and `login_generation`, clears `login_attempt`, and tells the runner to purge.
- The API reaches the runner with `env.runner.internal_url` and `env.runner.token`, the same hop
  `api/oss/src/core/sessions/streams/runner_client.py` uses. No runner configured: 503 with a clear
  message.
- `poll_after_ms` is the runner's `intervalSeconds * 1000`, minimum 2000.

### Runner routes (runner-token auth, like `GET /subscription-status`)

```
POST   /subscription-login/attempts            body {"provider": "chatgpt"}
  -> 200 {"attemptId", "state": "pending", "userCode", "verificationUri", "expiresAt", "intervalSeconds"}
GET    /subscription-login/attempts/{id}
  -> 200 {"attemptId", "state", "userCode", "verificationUri", "expiresAt", "intervalSeconds",
          "login"?: {...pi credential...}, "error"?: "..."}
DELETE /subscription-login/attempts/{id}       -> 204
```

- Implementation: `loginOpenAICodexDeviceCode({onDeviceCode, signal})` from
  `@earendil-works/pi-ai/oauth`, one `AbortController` per attempt, attempts in a process map.
- `login` is returned once. After it is handed out the attempt keeps `state: "succeeded"` with
  `delivered: true` and no login. Attempts expire from the map 20 minutes after creation.
- The runner never writes the login to disk during an attempt and never logs it.

## 3. Run routing

### SDK

- `Connection(mode="self_managed", slug=...)` becomes valid. A slug names a hosted subscription
  secret. No slug keeps today's behavior (the operator mount on the runner).
- `VaultConnectionResolver` and `_resolve_from_secrets`: with `self_managed` plus a slug, select
  the `subscription_provider` secret by slug. If `login_state != "ready"` or no login, raise a
  typed error that the stream turns into an error frame with code `subscription_login_required`.
  Otherwise emit `credential_mode="runtime_provided"`, `values={}`, `provider` mapped per harness
  (`pi_core` -> `openai-codex`, `codex` -> `openai`), plus a new `subscription` block.
- `ResolvedConnection.subscription` (optional) and its wire mirror on `modelConnection`:

```json
"subscription": {
  "id": "<secret uuid>",
  "slug": "chatgpt",
  "provider": "chatgpt",
  "version": 3,
  "generation": 1,
  "login": {"type": "oauth", "access": "...", "refresh": "...", "expires": 1789000000000, "accountId": "..."}
}
```

- `harness_allows_pair` and friends keep working: provider `openai-codex` with mode
  `self_managed` for `pi_core`.
- The capability catalog gains nothing new. The picker gets the model list from the secret.

### Runner

- `protocol.ts` `ModelConnection.subscription?` mirrors the block above.
- `run-plan.ts`: a `runtime_provided` run with `subscription` skips the process-env mount gate
  and is allowed on Daytona. A `runtime_provided` run WITHOUT `subscription` keeps today's rules
  (operator mount, local only). The plan gets
  `credentials.subscriptionHome = <stateDir>/subscriptions/<id>` where `stateDir` is
  `AGENTA_RUNNER_STATE_DIR` or `os.tmpdir()/agenta/runner-state`. Mode 0700.
- Materialize before the daemon starts: take `proper-lockfile` on `<home>/auth.json` (same lock
  path Pi uses, `realpath: false`), read the current file, and write
  `{"openai-codex": login}` only when the file is absent or its `expires` is older than the
  delivered `expires`. Never downgrade.
- `pi-assets.ts` subscription branch uses `subscriptionHome` as `PI_CODING_AGENT_DIR` when present
  (instead of `process.env.PI_CODING_AGENT_DIR`). Everything else in that branch stays: extension
  install, writability probe, `dir: undefined` so teardown never deletes it.
- `session-identity.ts` fingerprint gains `subscription.id` and `subscription.generation`. Not
  `version`, so a refresh keeps warm reuse.
- Push back after every turn and at session end: read `<home>/auth.json` under the lock; if its
  `expires` is newer than the delivered one and newer than the last pushed one, call
  `POST {apiBase}/secrets/{id}/subscription-login` with `Authorization: <runCredential>` and body
  `{"login": {...}, "version": <delivered version>}`. Record the returned `version`.
- Auth failure classification (`errors.ts`): for a subscription run, Pi's
  `Authentication failed for "openai-codex"`, `Failed to refresh OAuth token`, `No API key found
  for openai-codex`, and a bare 401 map to a new `RunErrorCode`. Before emitting, call
  `POST {apiBase}/secrets/{id}/subscription-login/failure` with `{"version": <delivered>,
  "reason": "<short string>"}`. If the API answers `{"stale": true}` emit
  `subscription_login_refreshed` ("The ChatGPT sign-in was updated by another session. Try
  again."). Otherwise emit `subscription_login_required` ("The ChatGPT sign-in is no longer valid.
  Sign in again from AI providers."). Neither message may contain tokens or paths.
- Daytona: the login lives on in-VM disk, never on the geesefs cwd:
  `/home/sandbox/agenta/subscriptions/<id>/auth.json` (a sibling of the codex-sqlite dir). Write
  it through the sandbox file API before the daemon starts (the daemon env is fixed at sandbox
  creation, so decide the path in `environment-setup.ts` like `configureDaytonaCodexEnv`), set
  `PI_CODING_AGENT_DIR` to that directory in the sandbox env, and read the file back through the
  sandbox file API after each turn for the push-back. A warm sandbox that already holds a newer
  `expires` keeps its file. Pi's lock works inside one sandbox; across sandboxes the push-back and
  the `stale` answer handle the loser.
- Codex (optional, only if cheap): convert the Pi credential to Codex `auth.json` shape
  (`tokens.{access_token, refresh_token, account_id}`, `last_refresh`) into
  `<home>/codex/auth.json` and use that directory as the Codex mount. Skip if Codex requires an
  id token to parse the file; record the finding.

### API endpoints the runner calls (permission: the same pair the mount sign route uses, `RUN_SESSIONS` and `USE_MOUNTS`)

```
POST /secrets/{secret_id}/subscription-login
  body {"login": {...}, "version": 3}
  -> 200 {"version": 4, "updated": true}      when login.expires > stored.expires (stores, bumps version)
  -> 200 {"version": 5, "updated": false}     when the stored login is already newer
POST /secrets/{secret_id}/subscription-login/failure
  body {"version": 3, "reason": "refresh_rejected"}
  -> 200 {"stale": true,  "version": 5}       stored version is newer: the run used an old login
  -> 200 {"stale": false, "version": 3}       marks login_state=needs_login, login_error=reason
```

The API accepts a pushed login only when its `accountId` equals the stored one.

## 4. Web

- AI providers page: a "ChatGPT" card. States: not connected ("Connect ChatGPT"), pending (shows
  the user code, a copy button, an "Open ChatGPT" link to `verification_uri`, and a countdown),
  ready ("Connected", with "Sign in again" and "Remove"), needs sign-in ("Sign in again").
  Polling: an `atomFamily` keyed by attempt id, interval `poll_after_ms`, stops on a terminal
  state, 15 minute backstop.
- Model picker: the new kind flows through `toProviderConnections` and `connectionCandidates`
  with `mode: "self_managed"`, the real `slug`, models from the secret, a "Subscription" tag, and
  the name "ChatGPT". Only shown when `login_state == "ready"`; otherwise shown disabled with
  "Sign in needed".
- Chat error: `subscription_login_required` shows a "Sign in again" button that opens the provider
  drawer at that connection; `subscription_login_refreshed` is retryable ("Try again").
- Status poll for the runner mount (`subscriptionStatus`) is untouched.

## 5. Evidence rules

- Real provider results and simulated results are labeled separately in status.md.
- No token, no auth file content, no user code in logs, docs, screenshots, or commits.

## Amendments after codex-002 (2026-09-08)

These replace the matching rules above.

A1. **Automatic recovery, not a Try again button.** When a subscription run hits an authentication
failure before the turn emitted any output or tool call, the runner recovers by itself:
1. It calls `POST /secrets/{id}/subscription-login/failure` with `{"version", "generation",
   "reason"}`. When the API holds a newer login it answers `{"stale": true, "version",
   "generation", "login": {...}}` with the current login.
2. The runner rematerializes the local file, restarts the daemon when the generation changed, and
   retries the turn once.
3. Only when no output was emitted. A turn that already streamed text or ran a tool is not
   replayed; it fails with `subscription_login_refreshed` (retryable) instead.

A2. **Classify the failure with the official client before calling it terminal.** On a Pi
authentication failure the runner calls `refreshOpenAICodexToken` from `pi-ai` with the local
refresh token (under the lock):
- success: the login is fine and the failure was transient. Write the new pair to the local file,
  push it, and retry per A1.
- HTTP 400 or 401 with `invalid_grant` or a `refresh_token_*` code: terminal. Report the failure;
  the API marks `needs_login` unless it is stale (A1). Emit `subscription_login_required`.
- network error or 5xx: transient. Emit a retryable error (`subscription_login_refreshed`
  message "The ChatGPT sign-in could not be checked. Try again.") and do not mark anything.

A3. **Publish at refresh time, and self-heal.** Locally the runner watches `<home>/auth.json`
(`fs.watch`, debounced 500 ms, read under the lock) and pushes on change, in addition to the turn
end and session end pushes. On Daytona the runner polls the file through the sandbox file API
every 30 s during a turn and at turn end. At materialize time, when the local file is newer than
the delivered login, the runner pushes the local file first (a push lost to an interruption is
recovered on the next run).

A4. **Generation, then expiry.** `login_generation` identifies a login lineage. Rules:
- API push accepts a login only when `generation == stored generation`, the refresh token differs
  from the stored one, and `expires >= stored expires`. A push from an older generation answers
  `{"updated": false, "stale": true, "login": current}`.
- Failure report is stale when the stored generation or version is newer than the reported one.
- Local materialize: the file keeps a sidecar `meta.json` `{generation, version}`. A delivered
  login with a newer generation overwrites the local file regardless of expiry. Same generation:
  later expiry wins; equal expiry with a different refresh token also wins (both are valid).

A5. **Do not consume a successful device login before the API stored it.** The runner GET returns
`login` on every call while the attempt is `succeeded`, until the API calls DELETE after a durable
write. The API store is idempotent: a login whose refresh token equals the stored one is a no-op
with no version bump. Two simultaneous polls are safe. Known limitation: attempts live in one
runner process; with several runner replicas behind one URL a poll may reach a replica that does
not hold the attempt, which answers 404 and the API reports `failed` with "attempt not found; try
again". Recorded, not solved here.

## Shape after the cleanup pass (2026-09-08, supersedes the publish and state rules above)

Applied from the Codex code-organization review, with the simplify rules.

- **Runner modules.** `subscription-login/files.ts` (local and Daytona file access, the write
  decision, the lock), `subscription-login/publisher.ts` (one reconciliation loop and the API
  calls), `subscription-login/validate.ts` (token shape and account claim), `subscription-recovery.ts`
  (classify a failure with a real refresh, adopt a stale answer, replay once), and
  `subscription-events.ts` (structured decision logs). `subscription-login.ts` is gone.
- **One publisher per environment.** It runs a pass at start (repairs a missed publish), every 5 s
  locally and every 30 s on Daytona, on request from recovery, and once more on shutdown after it
  drains the pass in flight. The materialize-time push, the file watch with its debounce and
  fallback, the turn-end read-back, and the session-end read-back are gone.
- **Acknowledgement, not expiry.** The publisher keeps one credential identity (generation plus a
  hash of the refresh token) and marks it acknowledged only when the API accepted it. A timeout,
  a network failure, a 5xx, a 408, or a 429 leaves it unacknowledged and the next pass retries.
  A rotation with an equal expiry is published. Push state is three fields: generation, version,
  acknowledged. The failure report still quotes what the run was delivered.
- **Refresh under the lock.** Read, provider exchange, and write happen inside one lock hold, and
  the generation guard runs before the exchange so a newer lineage's refresh token is never spent
  by an older session. On Daytona the file is re-read and compared before a write.
- **Deleted.** `mergeSubscriptionAuth`, the attempt `delivered` flag and response field, and the
  history-narrating comments.
- **Observability.** One logfmt line per decision with allowlisted scalar fields:
  `event=subscription.materialize`, `subscription.publish`, `subscription.recovery`,
  `subscription.attempt`, with connection, scope, generation, version, reason, status, action. The
  same fields go on the active run span as `agenta.subscription.*` attributes. New Relic reads the
  runner through its logs; no new export pipeline.
- **API.** An unchanged poll is a real no-op (no write, no cache invalidation). A simultaneous
  start keeps the winner under the lock and cancels the redundant runner attempt. Server-owned
  login fields are rejected on the public create and update routes. Attempt state stays in the
  encrypted row.
- **SDK and web.** The hosted Codex mapping is removed until that credential format is supported;
  ChatGPT plus Pi is enforced at resolution. The card resolves from the connection state when a
  poll response is lost, and the 15-minute backstop shows a terminal state with a retry.

### Corrections from the final reviews (2026-09-08)

- The two runner-facing routes (`subscription-login` and `subscription-login/failure`) require the
  runtime grant `secret-resolve`, the same grant the SDK uses to read the login. Run permissions
  alone are not enough, because a stale answer carries the login.
- Automatic recovery after an adopted or refreshed login does not replay inside the same daemon:
  the running Pi keeps its cached token. The turn ends with a retryable code that forces a cold
  start, and the user sends the message again. The generation bump path already worked this way.
- The prompts a run delivers (`SYSTEM.md`, `APPEND_SYSTEM.md`) are per session, never inside the
  shared per-connection directory. Only the login file and its lock are shared.
- The runner keeps the per-connection login under `AGENTA_RUNNER_STATE_DIR`, a named volume in
  every compose file (`runner-state`), because the local copy is the only holder of a rotated
  refresh token until the next 5 s publish.
- ChatGPT plus Pi is enforced at runner admission as well as at SDK resolution.
