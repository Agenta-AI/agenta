# Implementation plan

> Historical v0 proposal. This is a good starting point, but it may miss important
> requirements and design questions. Its choices are not approved requirements.
> Read the [current requirements](../requirements.md) and
> [open design questions](../design-questions.md) before using this proposal.

## Recommendation

For the first hosted release, use the official Codex and Grok Build programs as both the login
owner and the model harness. Codex already exists as an Agenta harness. Grok Build must be added as
a new Agent Client Protocol (ACP) harness. Keep each connection private to the user who completed
the login and allow one interactive run at a time.

Native CLI logins use a private durable authentication home attached through a server-owned runner
connection. They must not live in a sandbox or agent workspace.

Do not copy Squad's one-virtual-machine-per-customer architecture as a prerequisite. It is simple
but expensive and joins unrelated state. Agenta can preserve its control-plane and runner split by
routing each run to the correct private authentication home.

Do not turn a ChatGPT or SuperGrok login into a generic API key.

## First release boundaries

The first release should support one ChatGPT connection and one SuperGrok connection per Agenta
user. A connection belongs to the user who completed the provider login. It may run only when that
same user starts an interactive agent turn. Team-triggered runs, schedules, events, and shared
connection use require a separate ownership decision.

Serialize runs per subscription connection in the first release. The public provider
documentation does not promise that several CLI processes can safely refresh one authentication
file at the same time. One active run per connection avoids credential-write races and gives a
clear response when a subscription is already in use.

This scope proves the onboarding, storage, routing, refresh, revocation, and model execution paths
without silently deciding who may spend another person's subscription.

## Connection ownership and storage

Add a user-owned subscription connection record. Keep provider credential files outside the main
database and outside project workspaces.

Suggested records:

```text
subscription_connection
  id
  workspace_id
  owner_user_id
  provider                 chatgpt_codex | supergrok
  product
  harness                  codex | grok
  auth_home_ref            server-only encrypted storage reference
  runner_connection_id     server-only routing reference
  state
  provider_subject_hash    optional deduplication value, never the email address
  created_at
  last_verified_at
  disconnected_at

subscription_login_attempt
  id
  connection_id
  state
  provider_login_id        server-only when the provider supplies one
  expires_at
  created_at
  completed_at
  error_code
```

The authentication home should use a random storage identifier, directory mode `0700`, and file
mode `0600`. Encrypt the volume at rest. Add per-connection envelope encryption if a single shared
volume serves several tenants. Envelope encryption means each connection uses its own data key,
which a cloud key-management key encrypts. Do not include the provider name, user ID, email address,
project name, or workspace name in the storage path.

Set `CODEX_HOME` or `GROK_HOME` only inside the trusted login worker and runner process. Mount the
home read-write because the official clients refresh credentials. Mount agent working directories
separately. An agent tool must never receive the authentication mount path.

For the first release, allocate one small encrypted persistent volume, storage that survives worker
restarts, per subscription connection. Mount it into only one login or run worker at a time. This
matches the one-active-run limit and avoids a shared writable filesystem. It also avoids one virtual
machine per user. A later release can move inactive homes to encrypted object storage, but it must
check out and write back the whole opaque directory under the same connection lease.

## Tool isolation from authentication files

The harness must read and refresh its authentication files. Shell commands and file tools started
by the model must not read them. File permissions alone cannot enforce this when the harness and
its child processes share an operating-system user.

Codex app-server supports restricted read roots for sandboxed turns. Agenta should allow the agent
workspace and required system paths, exclude `CODEX_HOME`, and run an integration test where a
model-directed shell command tries to read `auth.json`. The test must fail while a model turn and
token refresh still succeed.

Grok's `strict` sandbox limits reads to the current working directory and system paths, but its
default profiles keep `~/.grok` writable. Grok also supports custom deny paths. Agenta should place
`GROK_HOME` outside the workspace and add its exact path to a root-owned custom sandbox deny list.
Before release, an integration test must prove both sides of the boundary: Grok can authenticate
and refresh, while Grok's shell and file tools cannot read the authentication home. If the deny
also blocks Grok's own refresh, the design needs a provider-supported credential broker or a
separate tool-execution process. Do not ship the mounted-file design until this test passes.

## Browser login contract

Expose one provider-neutral contract to the frontend. Provider adapters translate it to Codex
JSON-RPC or the supported Grok login interface.

```http
POST /subscription-connections
POST /subscription-connections/{connection_id}/login-attempts
GET  /subscription-connections/{connection_id}
POST /subscription-connections/{connection_id}/login-attempts/{attempt_id}/cancel
DELETE /subscription-connections/{connection_id}
```

The login-attempt response contains display data and no provider token:

```json
{
  "attempt_id": "019d952f-0000-0000-0000-000000000000",
  "state": "waiting_for_user",
  "verification_uri": "https://provider.example/device",
  "user_code": "ABCD-1234",
  "expires_at": "2026-09-07T12:10:00Z",
  "poll_after_ms": 2000
}
```

Allowed attempt states are `starting`, `waiting_for_user`, `exchanging`, `succeeded`, `failed`,
`expired`, and `cancelled`. The frontend polls the connection endpoint until completion. A later
version may replace polling with server-sent events without changing the stored state model.

Starting a login is idempotent while one non-expired attempt exists. The server returns the active
attempt instead of launching a second provider process. Disconnect first marks the connection
unusable for new runs, then stops active login work, calls the provider logout command, and destroys
the authentication home.

## Provider adapters

### Codex adapter

1. Allocate the authentication home and write a managed `config.toml` that forces ChatGPT login and
   file-backed credential storage.
2. Start `codex app-server` with the connection's `CODEX_HOME`.
3. Call `account/login/start` with `type = "chatgptDeviceCode"`.
4. Return the structured verification URL, user code, login ID, and expiry to the connection
   service.
5. Consume `account/login/completed` and `account/updated` notifications.
6. Call `account/read` after success and store only allowed metadata such as authentication mode
   and plan type.
7. Reuse the existing Codex runner path with this authentication home.

### Grok adapter

1. Allocate the authentication home and set `GROK_HOME` for every provider process.
2. Start the supported structured device-login interface. If xAI supplies no such interface,
   run the pinned `grok login --device-auth` command through a pseudo-terminal and parse only the
   documented URL and one-time code.
3. Detect success through a supported command or a fresh `grok inspect --json` process. Do not
   inspect token fields.
4. Add `grok` to the SDK `HarnessKind`, harness catalog, runner capabilities, subscription status,
   workspace assets, and wire-contract tests.
5. Start inference through `grok agent stdio` with automatic updates disabled. Pin the tested CLI
   version in the runner image.

The Grok login parser is the main release risk until xAI provides a structured login contract.

## API ownership

The main FastAPI API should own the public connection endpoints, database records, user checks, and
onboarding state. A subscription connection outlives any one agent-service process or chat session,
so the Python agent service should not become its source of truth.

The runner should expose private authenticated operations to start, inspect, cancel, and clear a
provider login. The main API resolves the server-owned runner connection and calls those operations.
The runner returns only the login attempt fields in the public contract. It never returns token
files, token values, authentication paths, or provider response bodies.

The runner reports completion to the main API through an authenticated internal callback. The
frontend polls the main API. This lets onboarding survive a page refresh and keeps the browser away
from runner addresses and credentials.

## Run routing

The agent configuration should refer to the subscription connection ID. The backend must resolve
that ID against the authenticated run actor before it selects a runner. It must check all of these
conditions before creating a session:

1. The connection belongs to the current user.
2. The connection is ready and not disconnected.
3. The selected harness and model are allowed for that provider product.
4. The assigned runner can mount the connection's authentication home.
5. No other run currently owns the connection in the first release.

The browser and agent configuration must never supply a runner URL, volume path, or storage
reference. The server resolves those from `runner_connection_id` and `auth_home_ref`.

Use a short database lease, a time-limited ownership record, to claim one connection for a run.
Include a monotonically increasing lease generation number in the runner request. The runner
rejects work from an older generation, so a delayed process cannot write credentials after a newer
lease or disconnect. Release the lease on normal completion. Let it expire after a worker crash.

## Onboarding sequence

1. The user describes or selects an agent during onboarding.
2. Agenta shows `Connect ChatGPT` and `Connect SuperGrok` when no usable model connection exists.
3. The user picks a provider. Agenta creates a pending user-owned connection and login attempt.
4. The page opens the provider verification URL and shows the one-time code with a copy action.
5. The frontend polls while the official provider process performs the exchange and writes the
   authentication home.
6. Agenta marks the connection ready after the official client reports success. Where the client
   exposes a read-only account check, Agenta also confirms the expected authentication mode.
7. Agenta updates the draft agent to the provider's compatible harness and default model.
8. The first message runs through the same connection. A successful response completes
   onboarding.

If the user closes the page, the attempt continues until its provider expiry. Returning to
onboarding resumes the existing attempt. A failed or expired attempt keeps the draft agent and
offers `Try again`.

## Connection contract

Extend the existing provider connection concept with an authentication source:

```json
{
  "slug": "chatgpt-personal",
  "provider": "openai",
  "auth_source": "runner_login",
  "product": "chatgpt_codex",
  "execution_mode": "interactive_only",
  "harnesses": ["codex"]
}
```

Native logins store a server-owned `runner_connection_id`. Never return that identifier's target
URL or authentication-home path to the browser. `execution_mode` is a server-enforced run
restriction. The first release uses `interactive_only`.

## Delivery order

### Add user-owned runner connections

1. Create a server-owned runner connection resource with user scope, status, runner protocol
   version, supported harnesses, and an encrypted service credential.
2. Replace direct reads of `AGENTA_RUNNER_INTERNAL_URL` with one resolver used by normal runs,
   subscription status, cancellation, and session recovery.
3. Keep the deployment runner as the compatibility fallback for self-hosted installations.
4. Never accept a runner URL from a browser or agent configuration.
5. Add tenant and owner checks before every resolution and call.

Candidate areas:

- `services/oss/src/agent/config.py`
- `services/oss/src/agent/app.py`
- `services/oss/src/agent/runtime_status.py`
- `sdks/python/agenta/sdk/agents/handler.py`
- `api/oss/src/core/sessions/streams/runner_client.py`
- New main API resource and database table for runner connections

### Prove authentication-file isolation

1. Build a Codex test worker with a fake authentication home and restricted app-server read roots.
2. Build a Grok test worker with a fake authentication home and a root-owned custom sandbox policy.
3. Confirm that provider login and refresh can read and update the home.
4. Ask each harness to use shell and file tools to read its authentication file. The request must
   fail without returning file contents.
5. Stop the release if either harness cannot separate its credential access from tool access.

### Add durable authentication homes

1. Allocate one encrypted writable authentication home per provider account, not per agent.
2. Mount only that provider's required files into the selected runner.
3. Let the official harness refresh its own login in place.
4. Serialize all access per authentication home in the first release.
5. Back up encrypted credential state separately from agent working files.
6. Delete or revoke the home when the user disconnects the account.

The authentication home is shared by agents using that connection. Their conversation
working directories, native session state, and sandboxes remain separate.

### Add browser-based connection onboarding

1. User chooses ChatGPT or SuperGrok in AI Providers.
2. Agenta creates a pending connection and starts the provider's official device or browser flow on
   the assigned runner.
3. The frontend shows the provider URL and user code. It never receives the refresh token.
4. The runner completes the exchange and writes the authentication home.
5. Agenta probes the provider with the smallest supported request, resolves account and plan
   metadata when permitted, then marks the connection ready.
6. The user selects allowed models and harnesses.
7. Disconnect revokes at the provider when supported, destroys the local authentication home, and
   blocks new runs immediately.

Use the official client for device login and model execution. Do not replay private OAuth endpoints
with an Agenta client.

### Add operational controls

1. Report `connecting`, `ready`, `refreshing`, `rate_limited`, `expired`, `revoked`, and
   `unsupported` without exposing tokens or paths.
2. Add per-connection concurrency limits that never exceed the provider plan.
3. Do not rotate across user accounts to bypass provider limits.
4. Record which connection and product a run used, without credential material.
5. Alert before expiry where the provider exposes it. Ask for reconnect only after refresh fails.

## Acceptance criteria

- Two users cannot resolve each other's runner or authentication home.
- Two agents can use one subscription connection while keeping separate sessions and
  working directories.
- A provider refresh persists and is visible to the next run.
- Concurrent refresh attempts cannot corrupt or invalidate rotating credentials.
- Removing a connection blocks subsequent runs before a harness starts.
- The model never receives access tokens, refresh tokens, credential paths, or runner credentials.
- An interactive-only product cannot run from a schedule or event.
- Existing self-hosted subscription mounts keep working without migration.
- Existing API-key connections and Daytona runs remain unchanged.

## Suggested first release

Start with ChatGPT through Codex and SuperGrok through Grok Build. Build the user-owned connection
resource, encrypted authentication homes, and server-owned runner routing before exposing either
option in onboarding. Keep the current self-hosted Codex, Claude Code, and Pi mount path unchanged.
