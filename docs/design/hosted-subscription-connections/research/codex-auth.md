# Codex CLI ChatGPT subscription authentication

Research note for the hosted subscription connections design.

**Version under study:** `@openai/codex` **0.145.0**, pinned in
`services/runner/package.json:11`. All Rust line numbers below come from the tag
`rust-v0.145.0` of <https://github.com/openai/codex>. A file reference of the form
`codex-rs/login/src/auth/manager.rs:2506` maps to
<https://github.com/openai/codex/blob/rust-v0.145.0/codex-rs/login/src/auth/manager.rs#L2506>.

**Bridge under study:** `@agentclientprotocol/codex-acp` **1.1.7**, pinned in
`services/runner/package.json:10`. Line numbers come from the npm tarball for that exact
version, file `dist/index.js`. That package declares `"@openai/codex": "^0.145.0"`, so the
bridge and the Rust source match.

The host also has `codex-cli` **0.153.4** at `/home/mahmoud/.local/bin/codex`. That build is
newer than the pin. Section 10 records its differences.

No token value and no `auth.json` content appears in this note.

## Summary for the design

1. The app-server device-code login works headless. It opens no browser and needs no
   inbound port. It returns a verification URL and a user code, and it polls by itself.
2. The codex-acp 1.1.7 bridge never uses device code. Its ChatGPT method starts the
   loopback browser flow and calls `open()` on the URL. That flow cannot work in a sandbox.
3. `auth.json` has no cross-process lock and no atomic write. The writer truncates the file
   in place.
4. Codex does reload the file before it refreshes, but only when the account id on disk
   matches the account id in memory.
5. A running codex process does not observe an external rewrite of `auth.json`. The source
   states this as a design goal.
6. A process that starts with no credentials never reads `auth.json` again. A later login
   is invisible to it forever.
7. OpenAI documentation tells you not to share one `auth.json` across concurrent jobs or
   machines. A maintainer separately said the server tolerates reuse for about an hour.
   Treat the overlap window as unproven.

## 1. Login interfaces

### 1.1 The `codex login` CLI

`LoginCommand` is at `codex-rs/cli/src/main.rs:460-499`. The flags in 0.145.0 are:

| Flag | Line | Effect |
| --- | --- | --- |
| `--with-api-key` | `main.rs:464-468` | Read the API key from stdin. |
| `--with-access-token` | `main.rs:470-474` | Read the access token from stdin. |
| `--api-key` | `main.rs:476-484` | Deprecated and hidden. Exits with guidance. |
| `--device-auth` | `main.rs:487-488` | Use the device code flow. |
| `--experimental_issuer` | `main.rs:491-492` | Hidden. Override the OAuth issuer base URL. |
| `--experimental_client-id` | `main.rs:495-496` | Hidden. Override the OAuth client id. |

`codex login --device-auth` **exists in 0.145.0**. It is the only `LoginSubcommand` sibling
of `codex login status`, which is the single subcommand.

With no flag, `codex login` runs the browser flow. That flow starts a loopback HTTP server
and opens a browser. The single `webbrowser::open` call in the login crate is at
`codex-rs/login/src/server.rs:178`, guarded by `if opts.open_browser` on line 177. The CLI
default is `true`, set at `server.rs:98`.

### 1.2 The device code flow itself

`request_device_code` is at `codex-rs/login/src/device_code_auth.rs:167-181`. It posts a
client id to `{issuer}/api/accounts` and gets back a `device_auth_id`, a `user_code`, and a
poll `interval`. It builds the verification URL as `{base_url}/codex/device`
(`device_code_auth.rs:174`).

`poll_for_token` at `device_code_auth.rs:99-149` polls `{auth_base_url}/deviceauth/token`.
It treats HTTP 403 and 404 as "not yet" and sleeps for `interval` seconds. It gives up
after 15 minutes, hard-coded at `device_code_auth.rs:108`, with the error string
`device auth timed out after 15 minutes`.

### 1.3 The app-server JSON-RPC surface

The method table is `codex-rs/app-server-protocol/src/protocol/common.rs`.

| Method | Line | Params | Response |
| --- | --- | --- | --- |
| `account/login/start` | `common.rs:1025-1030` | `LoginAccountParams` | `LoginAccountResponse` |
| `account/login/cancel` | `common.rs:1032-1036` | `{loginId}` | `{status: "canceled" or "notFound"}` |
| `account/logout` | `common.rs:1038-1042` | none | `LogoutAccountResponse` |
| `account/read` | `common.rs:1173-1177` | `{refreshToken?}` | `{account, requiresOpenaiAuth}` |
| `account/chatgptAuthTokens/refresh` | `common.rs:1522` | | |

There is no `loginChatGpt`, no `loginApiKey`, and no `account/list` in 0.145.0.

`LoginAccountParams` is a union tagged on `type`, at
`codex-rs/app-server-protocol/src/protocol/v2/account.rs:60-110`. The device-code member at
`account.rs:84-86` is a **unit variant with no fields**. The request is exactly
`{"type": "chatgptDeviceCode"}`.

The device-code response at `account.rs:139-149` carries **three fields and nothing else**:

```json
{
  "type": "chatgptDeviceCode",
  "loginId": "<uuid>",
  "verificationUrl": "https://auth.openai.com/codex/device",
  "userCode": "ABCD-1234"
}
```

That worked example comes from `codex-rs/app-server/README.md:2179-2180`.

**No expiry and no poll interval reach the client.** The `interval` field on `DeviceCode` is
private, at `device_code_auth.rs:20-25`. The server polls on its own. The 15-minute limit
exists only in the poll loop and in the CLI prompt text at `device_code_auth.rs:154-155`,
and the app-server never calls that prompt function.

Server implementation: `login_chatgpt_device_code_response` at
`codex-rs/app-server/src/request_processors/account_processor.rs:583-655`. It mints a UUID
login id, replaces any active login, spawns a background task that races
`cancel.cancelled()` against the completion, and returns the three fields at once.

**Errors on start** map at `account_processor.rs:492-499`. An `io::ErrorKind::NotFound`
becomes a JSON-RPC `invalid_request`. Anything else becomes `internal_error` with the
message `failed to request device code: {err}`. Two pre-flight rejections apply to every
ChatGPT login, at `account_processor.rs:445-456`:

- `External auth is active. Use account/login/start (chatgptAuthTokens) to update it or account/logout to clear it.`
- `ChatGPT login is disabled. Use API key login instead.`

### 1.4 Completion notifications

Both come from `send_chatgpt_login_completion_notifications` at
`account_processor.rs:788-833`.

`account/login/completed` is declared at `common.rs:1735-1738`. Its payload is at
`account.rs:672-678`:

```rust
pub struct AccountLoginCompletedNotification {
    pub login_id: Option<String>,
    pub success: bool,
    pub error: Option<String>,
}
```

It fires on success **and** on failure. On a cancel it fires with `success: false` and the
error `Login was not completed`, at `account_processor.rs:625-627`.

`account/updated` is declared at `common.rs:1691`, payload at `account.rs:505-508`, fields
`authMode` and `planType`. It fires only on success, at `account_processor.rs:806-831`.

The order is fixed. `account/login/completed` comes first, then `account/updated`. The
README shows that order at `app-server/README.md:2183-2186`.

### 1.5 Can device code run headless in a container?

Yes, through the app-server. Three independent confirmations:

1. The app-server hard-codes `open_browser: false` at `account_processor.rs:458`, inside
   `login_chatgpt_common`, which the device-code path calls at
   `account_processor.rs:592-596`. There is nothing to suppress.
2. The device-code path starts no loopback HTTP server. The browser flow at
   `account_processor.rs:501-581` runs one on `http://localhost:<port>/auth/callback`. The
   device-code path skips all of it.
3. `app-server/README.md:2181` says to show `verificationUrl` and `userCode` to the user,
   and that the frontend owns the UX.

The catch is the bridge. See section 11.

## 2. The credential file

### 2.1 Schema

`AuthDotJson` is at `codex-rs/login/src/auth/storage.rs:40-66`. The comment above it reads
`Expected structure for $CODEX_HOME/auth.json`.

| Field | JSON name | Type | Notes |
| --- | --- | --- | --- |
| `auth_mode` | `auth_mode` | optional | Omitted when absent. |
| `openai_api_key` | `OPENAI_API_KEY` | optional string | Renamed by serde at `storage.rs:44`. Always serialized. |
| `tokens` | `tokens` | optional `TokenData` | Omitted when absent. |
| `last_refresh` | `last_refresh` | optional RFC 3339 timestamp | Omitted when absent. |
| `agent_identity` | `agent_identity` | optional | JWT string or a record. |
| `personal_access_token` | `personal_access_token` | optional string | |
| `bedrock_api_key` | `bedrock_api_key` | optional | |

`TokenData` is at `codex-rs/login/src/token_data.rs:11-25`:

| Field | Type | Notes |
| --- | --- | --- |
| `id_token` | `IdTokenInfo` | Parsed from the JWT on read. Serialized back as the raw JWT. |
| `access_token` | string | A JWT. Its `exp` claim drives the refresh decision. |
| `refresh_token` | string | |
| `account_id` | optional string | |

`IdTokenInfo` at `token_data.rs:28-42` holds `email`, `chatgpt_plan_type`,
`chatgpt_user_id`, `chatgpt_account_id`, `chatgpt_account_is_fedramp`, and `raw_jwt`.

### 2.2 File mode

`FileAuthStorage::save` at `storage.rs:206-222` sets mode `0o600` on unix, at
`storage.rs:213`. The mode applies only when the open call creates the file. An existing
file keeps the mode it has.

### 2.3 CODEX_HOME

`find_codex_home` is at `codex-rs/utils/home-dir/src/lib.rs:13-18`. It reads the
`CODEX_HOME` environment variable and ignores an empty value. If the variable is set, the
path **must exist and must be a directory**, or the call fails. The error strings are
`CODEX_HOME points to {val}, but that path does not exist` at `lib.rs:27-30` and a wrapped
`failed to read CODEX_HOME {val}: {err}` at `lib.rs:31-34`. With no variable set, the
default is `~/.codex`.

### 2.4 The credentials store setting

`AuthCredentialsStoreMode` is at `codex-rs/config/src/types.rs:107-119`. The TOML key is
`cli_auth_credentials_store`, declared at `codex-rs/config/src/config_toml.rs:259`.

| Value | Behavior |
| --- | --- |
| `file` | **The default.** Store in `CODEX_HOME/auth.json`. |
| `keyring` | Store in the OS keyring. Fail if the keyring is unavailable. |
| `auto` | Use the keyring when available, else fall back to the file. |
| `ephemeral` | Keep credentials in memory for the current process only. |

The keyring service name is `Codex Auth`, at `storage.rs:231`. The runner already pins the
mode to `file` for subscription runs, at
`services/runner/src/engines/sandbox_agent/codex-assets.ts:130`, so a keyring store cannot
displace the symlinked file.

### 2.5 Other contents of CODEX_HOME

Codex writes these siblings of `auth.json` under the same directory: `config.toml`,
`sessions/` for rollout transcripts, `log/`, `skills/`, `secrets/`, `hooks.json`,
`models_cache.json`, `tmp/`, `arg0/`, and `codex_auth.age`.

## 3. Refresh triggers

`should_refresh_proactively` is at `codex-rs/login/src/auth/manager.rs:2506-2528`. It
returns `false` for anything that is not `CodexAuth::Chatgpt`. For ChatGPT auth it applies
two rules in order:

1. **Access token expiry.** If the access token JWT parses and carries an `exp` claim,
   refresh when `exp <= now + 5 minutes`. The constant
   `CHATGPT_ACCESS_TOKEN_REFRESH_WINDOW_MINUTES = 5` is at `manager.rs:181`.
2. **Age since the last refresh.** If the JWT does not parse, refresh when `last_refresh`
   is older than 8 days. The constant `TOKEN_REFRESH_INTERVAL = 8` is at `manager.rs:180`.

The second rule is a fallback, not a second trigger. A parseable access token means rule 1
decides alone.

**There is no 28-day constant in 0.145.0.** The 8-day rule is the only day-scale constant in
the auth code. OpenAI documents the same 8-day rule at
<https://developers.openai.com/codex/auth/ci-cd-auth>.

**On a 401** the client runs `UnauthorizedRecovery`, a state machine at
`manager.rs:1574-1592` with `next()` at `manager.rs:1701-1750`. The caller calls `next()`
once per retry. For ChatGPT auth the steps are `Reload`, then `RefreshToken`, then `Done`.
For an API key the recovery does nothing and the 401 reaches the user.

### 3.1 The refresh call

`request_chatgpt_token_refresh` is at `manager.rs:1334-1374`. It posts JSON to
`REFRESH_TOKEN_URL`, which is `https://auth.openai.com/oauth/token` at `manager.rs:189`.
The environment variable `CODEX_REFRESH_TOKEN_URL_OVERRIDE` replaces it, at
`manager.rs:191` and `manager.rs:1455-1458`.

The request body is `RefreshRequest` at `manager.rs:1432-1436`:

```json
{ "client_id": "...", "grant_type": "refresh_token", "refresh_token": "..." }
```

The client id is the constant `app_EMoamEEZ73f0CkXaXp7hrann` at `manager.rs:1446`. The
environment variable `CODEX_APP_SERVER_LOGIN_CLIENT_ID` replaces it, at `manager.rs:192`
and `manager.rs:1448-1453`.

The response is `RefreshResponse` at `manager.rs:1438-1443`. All three fields are optional:
`id_token`, `access_token`, `refresh_token`.

## 4. The in-memory cache

`AuthManager` holds the auth value in an `RwLock<CachedAuth>` populated in the constructor
at `manager.rs:1855-1885`. `auth_cached()` at `manager.rs:1997-2002` reads that lock and
touches no filesystem.

The design is stated in the source. The doc comment at `manager.rs:1759-1766` reads:

> External modifications to `auth.json` will NOT be observed until `reload()` is called
> explicitly. This matches the design goal of avoiding different parts of the program seeing
> inconsistent auth data mid-run.

`reload()` exists and is public, at `manager.rs:2103-2107`. It loads from the active source
and returns whether the value changed.

`reload_if_account_id_matches` at `manager.rs:2109-2141` is the guarded variant used by the
refresh paths. It returns `Skipped` in two cases:

- The caller has no expected account id.
- The account id on disk differs from the expected one. The log line is
  `Skipping auth reload due to account id mismatch`.

**`auth()` does not reload for managed auth.** At `manager.rs:2023-2037` it reloads only
when an external auth provider is installed. For file-backed auth it reads the cache, and if
`auth_cached()` returns `None` it returns `None` at `manager.rs:2029` without touching disk.
A codex process that starts with no credentials therefore never notices a later login.

**There is no file watcher on `auth.json`.** The app-server file
`codex-rs/app-server/src/fs_watch.rs` implements the client-driven `fs/watch` and
`fs/unwatch` RPCs. Nothing registers `auth.json` with it. The only `reload()` call sites in
the app-server are `account_processor.rs:359`, `:426`, and `:808`, and all three are
downstream of a login or logout RPC.

`account/read` does not reload when the caller passes `refreshToken: false`.
`get_account_response` at `account_processor.rs:995-1014` reads the cached manager state.

## 5. Concurrent refresh

**There is no cross-process lock.** No `flock`, no lock file, no advisory lock anywhere in
the auth code.

The only serialization is in-process. `refresh_lock` is a tokio `Semaphore` with one permit,
declared at `manager.rs:1777` and built at `manager.rs:1879`. It stops two tasks in one
process from refreshing at once. It does nothing across processes.

### 5.1 Reload before refresh

Codex does implement the reload-before-refresh pattern, in `refresh_token()` at
`manager.rs:2366-2402`. The sequence is:

1. Take the semaphore.
2. Return `Ok` at once for API key and personal access token auth.
3. Read the expected account id from the cached auth.
4. Call `reload_if_account_id_matches`.
5. On `ReloadedChanged`, log
   `Skipping token refresh because auth changed after guarded reload.` and return `Ok`. The
   client treats a changed on-disk token as proof that another process already refreshed.
6. On `ReloadedNoChange`, call the authority.
7. On `Skipped`, return `Permanent` with the account-mismatch message.

So the client **does compare the on-disk token to its own before it refreshes**, and it
backs off when they differ. This is the mechanism that makes a shared file work most of the
time on one machine.

Two gaps remain:

- The comparison is not atomic with the refresh. Two processes can both read the same
  unchanged file and both post a refresh.
- `refresh_token_from_authority()` at `manager.rs:2405-2413` skips the guarded reload and
  goes straight to the provider. `UnauthorizedRecovery` calls that one, but only after its
  own `Reload` step has run.

### 5.2 What the loser gets

If the provider rejects the refresh token, `classify_refresh_token_failure` at
`manager.rs:1376-1400` maps the `code` field of the error body:

| Body code | Reason | Class |
| --- | --- | --- |
| `refresh_token_expired` | `Expired` | Permanent |
| `refresh_token_reused` | `Exhausted` | Permanent |
| `refresh_token_invalidated` | `Revoked` | Permanent |
| anything else | `Other` | Permanent on HTTP 401, else Transient |

The rule is at `manager.rs:1364-1372`. An unrecognized code also logs a warning,
`Encountered unknown response while refreshing token`.

**0.145.0 does not retry after reloading the file when a refresh is rejected.** The error
returns to the caller. Recovery needs a fresh login.

## 6. The write path

`FileAuthStorage::save` at `storage.rs:206-222`:

```rust
let mut options = OpenOptions::new();
options.truncate(true).write(true).create(true);
#[cfg(unix)]
{
    options.mode(0o600);
}
let mut file = options.open(auth_file)?;
file.write_all(json_data.as_bytes())?;
file.flush()?;
```

Four properties matter for the design:

1. **No atomic write.** There is no temp file and no rename. The write truncates in place.
   A concurrent reader can observe an empty or partial file.
2. **No fsync.** The code flushes the userspace buffer only.
3. **It follows symlinks.** There is no `O_NOFOLLOW`, no `custom_flags`, and no
   `symlink_metadata` in the file. An `auth.json` that is a symlink writes through to the
   target. The Agenta runner depends on this, at
   `services/runner/src/engines/sandbox_agent/codex-assets.ts:167-212`.
4. **The mode applies only at creation.** An existing target keeps its own mode.

`persist_tokens` at `manager.rs:1307-1330` is the merge step. It loads the current file,
overwrites only the fields the response returned, sets `last_refresh` to now, and saves. It
keeps the existing `refresh_token` when the response omits one, at `manager.rs:1324-1326`.

**If the write fails after the provider accepted the refresh**, `persist_tokens` returns an
error, `refresh_and_persist_chatgpt_token` at `manager.rs:2595-2612` returns before it calls
`reload()`, and the new tokens are lost. The file still holds the old refresh token, which
the provider may have already rotated. Upstream issue
[#43610](https://github.com/openai/codex/issues/43610) describes this exact shape for a
sandboxed CLI: a failed persist is as fatal as a lost race.

## 7. Error classification

The enum is `RefreshTokenError` at `manager.rs:196-202`. It has two members.

- `Transient(std::io::Error)`. Network failures, JSON decode failures, and a non-401 HTTP
  status with an unrecognized error code.
- `Permanent(RefreshTokenFailedError)`. Carries a `RefreshTokenFailedReason` of `Expired`,
  `Exhausted`, `Revoked`, or `Other`.

`failed_reason()` at `manager.rs:229-235` returns the reason for a permanent failure and
`None` for a transient one. That is the discriminator a caller uses.

The exact user-facing strings are at `manager.rs:183-188`:

```
Your access token could not be refreshed because your refresh token has expired. Please log out and sign in again.
Your access token could not be refreshed because your refresh token was already used. Please log out and sign in again.
Your access token could not be refreshed because your refresh token was revoked. Please log out and sign in again.
Your access token could not be refreshed because you have since logged out or signed in to another account. Please sign in again.
```

The fourth string is `REFRESH_TOKEN_ACCOUNT_MISMATCH_MESSAGE`. It is produced by
`reload_if_account_id_matches` returning `Skipped`, at `manager.rs:2394-2398` and
`manager.rs:1730-1733`. It means the file now holds a different account, not that the token
is bad.

Map these to the three classes the design needs:

| Class | Signals |
| --- | --- |
| Transient, retry | `RefreshTokenError::Transient`. |
| Stale token, refresh | `should_refresh_proactively` is true, or the API returned 401 and recovery steps remain. |
| Re-login needed | `Permanent` with `Expired`, `Exhausted`, or `Revoked`. |
| Wrong account in the file | `Permanent` with `Other` and the account-mismatch text. |

### 7.1 What the ACP client sees

The bridge does not forward these strings. `session/new` calls `checkAuthorization()` at
`dist/index.js:28548-28562`, which calls `authRequired()` at `dist/index.js:26164-26170`.
That helper sends `account/read` with `refreshToken: false` and returns
`response.requiresOpenaiAuth && !response.account`. When auth is needed the bridge throws
`RequestError.authRequired()`, which is JSON-RPC error **-32000** with the message
`Authentication required`, at `dist/index.js:20807-20810`.

A turn that fails mid-stream on `unauthorized` or HTTP 401 maps to -32000 only when
`sessionState.authConfigured` is false, at `dist/index.js:24082` and `:24088-24090`. If the
session believed auth was configured, the failure becomes a plain internal error -32603.
**A credential that dies during a live session surfaces as an opaque internal error, not as
an auth prompt.**

## 8. Picking up a new auth.json without a restart

**No, not reliably.**

- The manager reads the cache, not the disk. See section 4.
- The app-server calls `reload()` only after a login or logout RPC it served itself.
- The guarded reload requires the account id on disk to match the cached one. A login as a
  different account is refused with the account-mismatch error.
- If the process started with **no** credentials, `auth()` returns `None` at
  `manager.rs:2029` and never touches disk. A later write is invisible forever. This is the
  case that matters when the runner starts codex first and provisions the login afterwards.
- codex-acp 1.1.7 spawns the app-server once, at `dist/index.js:31135`, and never restarts
  it. It sends `account/read` with `refreshToken: false` on every `session/new`, which does
  not reload.

Upstream states the same position. In issue
[#43010](https://github.com/openai/codex/issues/43010), closed as not planned, a maintainer
wrote that `auth.json` is the persisted store for the last login and not the live
credentials for a running app-server, and that many app-servers can run at once.

The only reliable pickup today is a fresh codex process. In the runner that means a fresh
daemon session, not a warm reuse.

## 9. Refresh token rotation

### 9.1 Client side

The client assumes rotation is possible and tolerates its absence. `persist_tokens` at
`manager.rs:1324-1326` stores the returned `refresh_token` when the response carries one and
keeps the existing value when it does not. The field is optional in `RefreshResponse` at
`manager.rs:1441`. The client code works against a rotating server and a non-rotating one.

### 9.2 Server side

Two primary sources point in different directions. Record both.

**A maintainer described an overlap window.** In issue
[#10332](https://github.com/openai/codex/issues/10332), closed as not planned, a user
reported the exact race: two app-servers refresh at once and the loser gets
`refresh_token_reused`. The OpenAI maintainer replied on 2026-02-01:

> Our OAuth refresh mechanism allows a refresh token to be used multiple times over a
> limited time window (on the order of an hour) before it is permanently invalidated. This
> accommodates network flakiness and other similar conditions. You're correct that the lack
> of a file lock can result in a race between Codex instances, but this race is mitigated by
> the refresh behavior on the server.

The same comment adds that occasional `refresh token reused` reports still arrive, so a bug
probably remains.

**Status: a GitHub comment from February 2026. Not documentation. Not versioned. Never
repeated in the docs. Treat the overlap window as unproven for today.**

**OpenAI documentation forbids sharing.** The page
[Maintain Codex account auth in CI/CD](https://developers.openai.com/codex/auth/ci-cd-auth)
states:

> Use one auth.json per runner or per serialized workflow stream. Do not share the same file
> across concurrent jobs or multiple machines.

The same page lists `another machine or concurrent job rotated the token first` as a reason
a runner starts returning 401 and needs a manual reseed. It also documents the 8-day
`last_refresh` rule and the write-back of new tokens.

The general page <https://developers.openai.com/codex/auth> does bless copying
`~/.codex/auth.json` to a headless machine. It says nothing about rotation, refresh token
lifetime, or two machines at once.

**The "refresh tokens are single-use" claim is not an OpenAI statement.** It originates in
the body of user issue [#15410](https://github.com/openai/codex/issues/15410) and is
repeated in [#15502](https://github.com/openai/codex/issues/15502). The maintainer comment
in #10332 contradicts the model behind it. Search engines now echo the sentence as if it
were documented. Do not build on it, and do not build on its inverse.

### 9.3 Relevant upstream issues

Documented or maintainer-answered:

- [#9634](https://github.com/openai/codex/issues/9634), closed. A maintainer wrote on
  2026-03-07 that the auth mechanism is not designed for concurrent Codex instances with
  different logins, that a second login effectively logs the first out, and that instances
  holding the first account run until their tokens expire and then cannot refresh.
- [#15410](https://github.com/openai/codex/issues/15410), closed as not planned. A
  maintainer confirmed that separate `CODEX_HOME` directories get separate independent auth
  by design, and told the reporter to authenticate in each one.
- [#43010](https://github.com/openai/codex/issues/43010), closed as not planned. Quoted in
  section 8.
- [PR #11802](https://github.com/openai/codex/pull/11802), merged. Fixes a hole where one
  instance refreshed but declined to write the file on an account-id mismatch, leaving a
  second instance holding a dead cached token.
- [#6498](https://github.com/openai/codex/issues/6498), closed. `refresh token was already
  used` after an idle session.

Anecdotal, no maintainer answer:

- [#22577](https://github.com/openai/codex/issues/22577), open. `codex logout` on one
  machine logs the user out on unrelated machines. A commenter reports the same on a plain
  `codex login`, because Codex tries to revoke existing credentials before the new flow.
  **This is a direct hazard for a shared credential.**
- [#40541](https://github.com/openai/codex/issues/40541), open. A freshly issued refresh
  token rejected as `refresh_token_invalidated` about 10 seconds later, reproduced with a
  single local process. Several independent reproductions. This is a server-side wave in the
  August and September 2026 desktop builds and is **not** a concurrency problem. Check it
  before you blame sharing for any logout you observe.
- [#39925](https://github.com/openai/codex/issues/39925),
  [#40632](https://github.com/openai/codex/issues/40632),
  [#40267](https://github.com/openai/codex/issues/40267) belong to the same wave.
- [#43610](https://github.com/openai/codex/issues/43610), open. A sandboxed CLI whose write
  back to the credential store fails ends up with only the invalidated token and gets
  `invalid_grant` forever.

Unexpected logouts are one of the highest-volume complaint classes in the repository. A
loose full-text search returns hundreds of matching issues across the CLI, the VS Code
extension, and the desktop app, through at least three fix cycles since late 2025.

## 10. Differences in 0.153.4

The host binary is newer than the pin. These are the auth changes between `rust-v0.145.0`
and `rust-v0.153.4`.

**No change:**

- The refresh triggers and both constants. `TOKEN_REFRESH_INTERVAL = 8` moved to
  `manager.rs:188` and `CHATGPT_ACCESS_TOKEN_REFRESH_WINDOW_MINUTES = 5` to
  `manager.rs:189`. `should_refresh_proactively` at `manager.rs:2924-2946` is unchanged
  character for character.
- File locking. Still none.
- Atomic write. Still none. `save` at `storage.rs:206-222` still truncates in place.
- Reload before refresh. Same shape, same account-id guard.
- The credentials store default. Still `file`.
- `codex login` flags. Identical, at `cli/src/main.rs:491-530`.
- The device code flow. `device_code_auth.rs` changed only by dropping an `Option` on
  `auth_route_config`.
- `RefreshTokenFailedReason`. Still `Expired`, `Exhausted`, `Revoked`, `Other`.
- `token_data.rs` is byte-identical.

**Changed:**

1. **A rejected refresh is now terminal sooner.** `request_chatgpt_token_refresh` at
   `manager.rs:1613-1626` treats HTTP 400 with the standard RFC 6749 code `invalid_grant` as
   `Permanent`. In 0.145.0 that fell through to `Transient` and was retried. Two new tests
   cover it in `codex-rs/login/tests/suite/auth_refresh.rs`.
2. **A new optional field in `auth.json`.** `bedrock_access_keys` at `storage.rs:63-64`,
   payload at `login/src/auth/bedrock_access_keys.rs:13-19`. It is skipped when absent, so a
   file written by 0.145.0 still parses.
3. **A managed auth policy layer.** New `ManagedAuthPolicy` at
   `codex-rs/config/src/auth_policy.rs` with `allowed_login_methods` and
   `allowed_chatgpt_workspaces`. `cli_auth_credentials_store` can now be pinned by a
   requirements layer, at `codex-rs/config/src/requirements_layers/layer.rs:15`.
4. **A workload identity credential source.** New crate `codex-rs/workload-identity` and
   `login/src/auth/workload_identity.rs`. It is selected by environment markers and locks
   out login and logout when active.
5. **A new initialization error.** `AuthManagerInitializationError` at `manager.rs:215`.
   `AuthManager::shared_from_config` now returns a `Result`, at `manager.rs:2708-2716`. That
   is a breaking signature change for callers.
6. **Token-leak hardening.** The app-server external auth bridge no longer propagates
   refresh error messages, and the refresh response redacts the access token in its `Debug`
   output, at `codex-rs/app-server-protocol/src/protocol/v2/account.rs:301-308`.
7. **New RPC methods** `account/bedrock/discover` and `account/bedrock/setup`, plus a new
   `AuthRecoveryNotification` schema.

None of these change the two facts the design turns on. There is still no file lock and no
atomic write, and a running process still does not observe an external rewrite.

## 11. The codex-acp bridge

Read from the npm tarball for **1.1.7**, file `dist/index.js`.

### 11.1 How it starts codex

It spawns the binary and speaks JSON-RPC over stdio. There is no native addon and no Rust
linkage. `startCodexConnection` is at `dist/index.js:22068-22086`:

```js
codex = process.platform === "win32"
  ? spawn(`"${codexPath}" app-server`, { shell: true, env: spawnEnv })
  : spawn(codexPath, ["app-server"], { env: spawnEnv });
```

The subcommand is always `app-server`. `codexPath` comes from the `CODEX_PATH` environment
variable at `dist/index.js:31119`. With no value the bridge resolves the JS shim from
`@openai/codex/bin/codex.js` and runs it with the current node binary.

### 11.2 Auth over ACP

The bridge does expose the ACP auth surface.

`initialize` advertises auth methods at `dist/index.js:28503`, built by
`getCodexAuthMethods` at `dist/index.js:25139-25150`:

- `api-key`, always.
- `chat-gpt`, **only when the `NO_BROWSER` environment variable is unset**, at
  `dist/index.js:25141`.
- `gateway`, only when the client declared that capability.

`authenticate` is registered at `dist/index.js:31171` and implemented at
`dist/index.js:26063-26096`. The `chat-gpt` branch calls `account/login/start` with
`{"type": "chatgpt"}` and then **opens a browser itself** with `open_default(authUrl)` at
`dist/index.js:26079`.

**1.1.7 never sends `chatgptDeviceCode`.** Only `{"type":"chatgpt"}` and
`{"type":"apiKey"}` appear in the bundle, at `dist/index.js:26078`, `:26102`, and `:31016`.
The headless device-code flow that section 1.5 describes is unreachable through the bridge's
ACP `authenticate`. Reaching it needs a direct app-server connection.

Also registered: `agent.logout` at `dist/index.js:28889-28894`, and two extension methods
`authentication/status` and `authentication/logout` dispatched at `dist/index.js:28516-28521`.
`getAuthenticationStatus` at `dist/index.js:26121-26147` returns one of `unauthenticated`,
`api-key`, `chat-gpt` with an email, or `gateway`.

The bridge reads a `DEFAULT_AUTH_REQUEST` environment variable at `dist/index.js:31122`. When
set, it silently authenticates with that payload instead of failing `session/new`.

### 11.3 Environment

The bridge sets **no** auth environment variable and never sets `CODEX_HOME`. It passes its
own `process.env` straight through, at `dist/index.js:22069` and `:31135`. The single
`CODEX_HOME` hit in the bundle is a read at `dist/index.js:26058`, caching the path the
app-server reports back. Whoever launches the bridge owns `CODEX_HOME`.

The variables the bridge reads are `CODEX_PATH`, `CODEX_CONFIG`, `DEFAULT_AUTH_REQUEST`, and
`MODEL_PROVIDER` at `dist/index.js:31119-31123`, plus `NO_BROWSER` at `:25141` and
`CODEX_API_KEY` or `OPENAI_API_KEY` at `:25113-25114`.

### 11.4 Reacting to an external rewrite

It does not. The codex child spawns once at `dist/index.js:31135` and lives for the bridge's
lifetime. There is no respawn and no supervisor. The exit handler disposes the connection at
`dist/index.js:22083-22085` and terminates codex two seconds after stdin closes, at
`:31142-31148`. There is no filesystem watcher in the bundle. The bridge listens only for
`account/login/completed` and `account/updated`, both of which follow a login RPC the bridge
itself made.

### 11.5 How the Agenta runner wires this

The runner does not spawn codex-acp directly. It runs the `sandbox-agent` daemon, and the
daemon installs the harness adapter.

| Concern | Location |
| --- | --- |
| The version pin, as a comment | `services/runner/package.json:9-10` |
| The image bake | `services/runner/docker/Dockerfile.gh:121-130`, `Dockerfile.dev:84` |
| The installed bundle path | `services/runner/src/engines/sandbox_agent/codex-acp-patch.json:6` |
| `CODEX_HOME` pass-through | `services/runner/src/engines/sandbox_agent/daemon.ts:274` |
| `CODEX_HOME` override to `<cwd>/.codex` | `services/runner/src/engines/sandbox_agent/codex-assets.ts:106-135` |
| The `cli_auth_credentials_store: file` pin | `codex-assets.ts:130` |
| The `auth.json` symlink into the operator mount | `codex-assets.ts:167-212` |
| Re-link after a mount | `services/runner/src/environment/mount-lifecycle.ts:211-218` |
| The pre-flight file probe | `services/runner/src/subscription-status.ts:124-131` |

The runner never sets `CODEX_PATH`, `DEFAULT_AUTH_REQUEST`, or `NO_BROWSER`, and it never
calls the ACP `authenticate` method. Its whole codex auth strategy is at the filesystem
level. Either a managed run with an API key in the daemon environment, or a symlink into the
operator's mounted `auth.json`.

The symlink works for the outbound direction. Codex refreshes and writes through the link
into the operator's real login, because `save` follows symlinks. It does not work for the
inbound direction. Once the app-server is running, an external rewrite is invisible.

## 12. Open implications for the design

1. **A headless login is possible, but not through the bridge.** Use the app-server
   `account/login/start` with `chatgptDeviceCode`, or run `codex login --device-auth`.
   Relay the verification URL and the user code to a human, and wait for
   `account/login/completed`.
2. **A shared `auth.json` has no lock and no atomic write.** Plan for a torn read. A reader
   can catch the file between truncate and write.
3. **Plan for the loser to be logged out.** OpenAI documentation forbids sharing across
   concurrent jobs and machines. The maintainer's one-hour overlap window is real as of
   February 2026, undocumented, and unversioned. Use it as slack for a retry, never as a
   design assumption.
4. **A new login needs a new codex process.** There is no way to hand fresh credentials to a
   running app-server from outside. Design the provisioning step to run before codex starts,
   or accept a cold session on a credential change.
5. **Watch for the credential-dies-mid-session case.** The ACP client sees an opaque -32603
   internal error, not an auth prompt. The runner cannot tell that failure from any other
   without reading the codex log.
6. **`codex logout` may be global.** Issue #22577 reports that a logout on one machine signs
   the user out elsewhere. It is unconfirmed by OpenAI. Treat any logout path in the product
   as potentially destructive to every other session on the same account.
