# Pi authentication for the `openai-codex` provider

How the Pi coding agent logs in to a ChatGPT subscription, where it keeps the credential, when it
refreshes, and what happens when two processes share one credential file. Read this before you
design a store that replaces Pi's file.

## Version and sources

The runner pins `@earendil-works/pi-coding-agent` 0.80.6 in
`services/runner/package.json:31`. The host CLI reports the same version (`pi --version` prints
`0.80.6`). The package pulls `@earendil-works/pi-ai` 0.80.6, which holds the provider and the
OAuth flow.

Two corrections to the brief:

- The package is `@earendil-works/pi-coding-agent`, not `@mariozechner/pi-coding-agent`. The
  `@mariozechner` scope is the old name and no longer resolves in this repository.
- The upstream repository is <https://github.com/earendil-works/pi>, not `badlogic/pi-mono`. The
  changelog still links old issues to `badlogic/pi-mono` and `earendil-works/pi-mono`, so both old
  URLs appear in citations below.

The installed `dist` is not minified and ships complete source maps, so the original TypeScript is
recoverable. All `src/...` line numbers below come from those maps. The installed files are at:

```
services/runner/node_modules/.pnpm/@earendil-works+pi-ai@0.80.6_.../node_modules/@earendil-works/pi-ai/dist/
services/runner/node_modules/.pnpm/@earendil-works+pi-coding-agent@0.80.6_.../node_modules/@earendil-works/pi-coding-agent/dist/
```

Each `dist/<name>.js` has a `dist/<name>.js.map` whose `sourcesContent` holds the file cited as
`src/<name>.ts`.

## 1. Login interface

**There is no `pi login` or `pi auth` command.** `pi --help` lists five subcommands: `install`,
`remove`, `uninstall`, `update`, `list`, and `config`. None of them authenticates. Login is a slash
command in the interactive TUI, registered at `src/core/slash-commands.ts:35`:

```ts
{ name: "login", description: "Configure provider authentication", argumentHint: "<provider>" },
```

The TUI handles `/login` and `/login <provider>` at `src/modes/interactive/interactive-mode.ts:2713`.

**Two login methods exist for `openai-codex`, and one of them is headless.** The provider's `login`
first asks the user to select a method (`src/utils/oauth/openai-codex.ts:568-587`):

```ts
const method = await callbacks.prompt({
    type: "select",
    message: "Select OpenAI Codex login method:",
    options: [
        { id: OPENAI_CODEX_BROWSER_LOGIN_METHOD, label: "Browser login (default)" },
        { id: OPENAI_CODEX_DEVICE_CODE_LOGIN_METHOD, label: "Device code login (headless)" },
    ],
});
```

**Browser method.** `loginOpenAICodex` (`:466-556`) starts a local HTTP callback server on port
1455 (`:376`), bound to `PI_OAUTH_CALLBACK_HOST` or `127.0.0.1` (`:51-53`). The redirect URI is
`http://localhost:1455/auth/callback` (`:37`). Pi does not open a browser itself. It notifies the
caller with the authorize URL (`:476`) and races the callback against a manual paste prompt
(`:480-527`). `parseAuthorizationInput` (`:80-108`) accepts a full redirect URL, a `code#state`
pair, or a bare code, so the flow works over SSH without a display. That paste fallback landed in
0.37.0 (changelog line 3300, "Headless OAuth login ... works over SSH without DISPLAY").

**Device-code method.** `loginOpenAICodexDeviceCode` (`:435-453`) needs no callback server and no
browser. It posts the client id to
`https://auth.openai.com/api/accounts/deviceauth/usercode` (`:38`), reports a user code plus the
verification URI `https://auth.openai.com/codex/device` (`:40`) through
`callbacks.notify({ type: "device_code", ... })`, then polls
`https://auth.openai.com/api/accounts/deviceauth/token` (`:39`) until the user approves. It honors
`slow_down` and treats 403 and 404 as pending (`:272-289`). The timeout is 15 minutes (`:42`). On
success the server returns an authorization code and the code verifier, which Pi exchanges against
the device redirect URI `https://auth.openai.com/deviceauth/callback` (`:41`, `:447-452`). This
method shipped in 0.77.0 (changelog lines 527 and 533,
[pi#4911](https://github.com/earendil-works/pi/pull/4911)).

**Both methods can run in a container with no browser.** Device code is the clean path: it never
binds a port and never needs a redirect back into the container. The browser method also works
headless through the paste fallback, but it still binds port 1455 inside the process.

**Programmatic entry points.** `pi-ai` exports `loginOpenAICodex`, `loginOpenAICodexDeviceCode`,
and `refreshOpenAICodexToken` from `@earendil-works/pi-ai/oauth`
(`src/utils/oauth/index.ts:122-129`). The coding agent wraps them in
`AuthStorage.login(providerId, callbacks)` (`src/core/auth-storage.ts:398-406`), which runs the
flow and persists the result. Both take callbacks, so an Agenta service can drive login without a
TUI. `loginOpenAICodexDeviceCode` takes only `onDeviceCode` and an `AbortSignal`, so it is the one
to call from a non-interactive service.

**Over ACP, login is not available.** The runner talks to Pi through `pi-acp` 0.0.29. Its
`authenticate` method is a no-op that returns nothing
(`services/runner/node_modules/.pnpm/pi-acp@0.0.29_.../node_modules/pi-acp/dist/index.js:1820`).
The only advertised auth method is `pi_terminal_login` (`:12-22`), whose implementation spawns the
interactive `pi` TUI with inherited stdio (`:2708-2724`). An ACP client therefore cannot log in
programmatically. It can only tell a human to open a terminal.

## 2. Credential file

**Location.** `getAgentDir()` returns `$PI_CODING_AGENT_DIR` when set, else
`~/.pi/agent` (`src/config.ts:515-521`). The env var name is derived from the app name at
`src/config.ts:495`, so a rebranded build reads a different variable. `getAuthPath()` is
`join(getAgentDir(), "auth.json")` (`src/config.ts:535`). Tilde expansion happens through
`normalizePath`, which expands `~` but does **not** resolve symlinks
(`src/utils/paths.ts:57-79`).

**File mode.** `0o600`, applied on create and re-applied after every write
(`src/core/auth-storage.ts:53`, `:76-78`, `:117-120`, `:162-165`). The parent directory is created
`0o700` (`:67-72`). The shipped docs confirm this at `docs/providers.md:105`.

**Schema.** The file is a JSON object keyed by provider id, one credential per provider
(`src/core/auth-storage.ts:24-36`):

```ts
export type ApiKeyCredential = { type: "api_key"; key: string; env?: Record<string, string> };
export type OAuthCredential  = { type: "oauth" } & OAuthCredentials;
export type AuthStorageData  = Record<string, AuthCredential>;
```

`OAuthCredentials` is `{ refresh: string; access: string; expires: number; [key: string]: unknown }`
(`pi-ai src/utils/oauth/types.ts:3-8`). For `openai-codex`, `credentialsFromToken`
(`src/utils/oauth/openai-codex.ts:409-421`) adds `accountId`, so the stored entry is:

| Field | Type | Meaning |
| --- | --- | --- |
| `type` | `"oauth"` | discriminator added by `AuthStorage` |
| `access` | string | the access token, a JWT |
| `refresh` | string | the refresh token |
| `expires` | number | absolute epoch milliseconds, computed as `Date.now() + expires_in * 1000` |
| `accountId` | string | `chatgpt_account_id`, decoded from the access token's JWT claim |

The claim path is `https://api.openai.com/auth` (`:46`, `:402-407`). Note that the *request* path
re-derives the account id from the access token on every call
(`pi-ai src/api/openai-codex-responses.ts:253`, `extractAccountId` at `:1490-1501`); the stored
`accountId` is not read at request time. A stored entry with a mangled `accountId` still works; a
mangled `access` fails with `Failed to extract accountId from token`.

The `expires` value is absolute epoch milliseconds, not a duration and not seconds. Every expiry
comparison is `Date.now() >= cred.expires`.

**The file holds every provider at once.** One mount can carry an `openai-codex` OAuth login and an
`anthropic` OAuth login and several `api_key` entries side by side. The Agenta runner already
relies on that: `services/runner/src/subscription-status.ts:82-92` reads the file as a provider map
and maps `openai-codex` to the `openai` family.

**Other contents of the agent dir** (`src/config.ts:525-565`, plus
`src/core/trust-manager.ts:212`): `models.json`, `settings.json`, `trust.json`, `themes/`,
`tools/`, `bin/`, `prompts/`, `sessions/`, `pi-debug.log`, `keybindings.json`
(`src/migrations.ts:158`), and `extensions/` (where the Agenta runner installs its extension,
`services/runner/src/engines/sandbox_agent/pi-assets.ts:529-547`).

**Yes, there is a store abstraction Agenta can replace.** `AuthStorageBackend`
(`src/core/auth-storage.ts:55-58`) is a two-method interface:

```ts
export interface AuthStorageBackend {
    withLock<T>(fn: (current: string | undefined) => LockResult<T>): T;
    withLockAsync<T>(fn: (current: string | undefined) => Promise<LockResult<T>>): Promise<T>;
}
```

`LockResult<T>` is `{ result: T; next?: string }`. The backend hands the callback the current file
content as a string, and persists `next` if the callback returns one. Two implementations ship:
`FileAuthStorageBackend` (`:60-178`) and `InMemoryAuthStorageBackend` (`:180-198`).
`AuthStorage.fromStorage(storage)` (`:219-221`) accepts any implementation. A database-backed or
callback-backed store is therefore a small class, and it inherits the whole
read-modify-write discipline for free, because every mutation in `AuthStorage` goes through
`withLock` or `withLockAsync`.

The catch: `withLock` is **synchronous**. A remote store cannot implement it without blocking. Only
`refreshOAuthTokenWithLock` uses the async variant (`:427`). `reload()`, `set()`, and `remove()` all
use the sync one (`:262`, `:289`). A database-backed store would need either a synchronous client
or a cached snapshot behind the sync path.

`pi-ai` also defines a cleaner, fully async `CredentialStore` interface
(`pi-ai src/auth/types.ts:47-69`) with `read`, `modify`, and `delete`. Its doc comment names the
coding agent's `AuthStorage` as a valid implementation (`:44-45`). That interface is the one to
target if the design moves to the newer `pi-ai` auth path rather than the coding agent's.

## 3. Refresh triggers

**Refresh is expiry-based only. A 401 never triggers a refresh.**

The single trigger is in `AuthStorage.getApiKey`, called once per request through
`ModelRegistry.getApiKeyAndHeaders` (`src/core/model-registry.ts:727`):

```ts
// src/core/auth-storage.ts:494
const needsRefresh = Date.now() >= cred.expires;
```

There is no skew margin and no early refresh. The token is used until the stored millisecond
passes.

On the request path, `isRetryableError`
(`pi-ai src/api/openai-codex-responses.ts:120-127`) retries only 429, 500, 502, 503, and 504. A 401
falls through to `parseErrorResponse` and is thrown as a plain `Error`
(`:400-405`). Nothing catches it, re-reads `auth.json`, or refreshes. A subscription that is
revoked mid-run therefore fails the turn, and the next turn fails the same way until the token
expires by clock.

**What refresh calls.** `refreshAccessToken` (`src/utils/oauth/openai-codex.ts:178-195`) posts
form-encoded to `https://auth.openai.com/oauth/token` (`:36`):

```
grant_type=refresh_token
refresh_token=<the stored refresh token>
client_id=app_EMoamEEZ73f0CkXaXp7hrann
```

The client id is the public Codex CLI client id, hardcoded at `:33`. No client secret. No scope on
refresh.

**What it stores back.** `readTokenResponse` (`:133-154`) requires `access_token`, `refresh_token`,
and a numeric `expires_in`, and throws if any is missing. So Pi writes a full new credential every
refresh, including a new refresh token. `credentialsFromToken` then re-derives `accountId` from the
new access token and throws `Failed to extract accountId from token` if the claim is absent
(`:409-421`).

## 4. In-memory cache

**Yes, the process caches the whole file in memory**, as `AuthStorage.data`
(`src/core/auth-storage.ts:204`). It is populated once in the constructor, which calls `reload()`
(`:212`).

**Re-reads happen in exactly three places, and none is a file watcher.**

1. `reload()`, called from the constructor (`:212`).
2. `persistProviderChange()`, but only when a previous load failed (`:275-277`).
3. `refreshOAuthTokenWithLock()`, which re-reads under the lock and assigns
   `this.data = currentData` before deciding anything (`:427-431`).

Plus one error path: when a refresh throws, `getApiKey` calls `reload()` and re-checks (`:506`).

There is no `fs.watch` on `auth.json` anywhere. The watchers in the package cover git refs
(`src/core/footer-data-provider.ts`) and themes only.

**Consequence.** `getApiKey` reads `this.data[providerId]` from memory (`:480`). While the cached
token is unexpired, the process never looks at the file. An external write is invisible until the
cached `expires` passes.

`reload()` is public, so an embedder can force a re-read. Nothing in Pi calls it on a schedule or
an event.

## 5. Concurrent refresh

**The design is double-checked locking over a real cross-process file lock, and the loser of a race
gets the winner's token rather than a failure.**

`FileAuthStorageBackend` uses `proper-lockfile` 4.1.2, which creates a `auth.json.lock` directory
next to the file. The async path (`:143-156`) retries 10 times with exponential backoff from 100 ms
to 10 s with jitter, and treats a lock older than 30 s as stale. It registers `onCompromised` and
refuses to write if the lock was lost mid-callback (`:136-140`, `:158-166`).

The refresh body runs entirely inside that lock (`:427-460`):

```ts
const result = await this.storage.withLockAsync(async (current) => {
    const currentData = this.parseStorageData(current);   // re-read from disk
    this.data = currentData;
    const cred = currentData[providerId];
    if (cred?.type !== "oauth") return { result: null };
    if (Date.now() < cred.expires) {                       // another process already refreshed
        return { result: { apiKey: provider.getApiKey(cred), newCredentials: cred } };
    }
    ...                                                     // refresh, then merge and persist
});
```

So the loser of a simultaneous refresh takes the lock second, re-reads the file, sees a fresh
`expires`, and returns the winner's access token without calling the provider. It never sends the
rotated-away refresh token. This is the fix recorded in the changelog for 0.37.0 (line 3313): "OAuth
refresh no longer logs users out when multiple pi instances are running"
([pi-mono#466](https://github.com/badlogic/pi-mono/pull/466)).

The merge is a read-modify-write of the whole file (`:453-456`), so a concurrent write to a
*different* provider key is preserved rather than clobbered. Changelog 0.53.0 (line 2159) records
that as a deliberate fix: "preserve unrelated external edits to `auth.json` via locked
read/merge/write updates."

**The sync path is weaker.** `acquireLockSyncWithRetry` (`:81-106`) calls `lockfile.lockSync` up to
10 times, 20 ms apart, and **busy-waits** between attempts:

```ts
const start = Date.now();
while (Date.now() - start < delayMs) {
    // Sleep synchronously to avoid changing callers to async.
}
```

That blocks the event loop for up to about 200 ms and gives up after roughly 200 ms of contention.
It also passes no `stale` option, so it takes `proper-lockfile`'s 10 s default rather than the async
path's 30 s. `reload()`, `set()`, and `remove()` all use it, so a login competing with heavy refresh
traffic can fail on lock contention. Changelog 0.56.3 (line 1957) records the retry loop being added
for exactly that reason: "parallel pi processes failing with false `No API key found` errors due to
immediate lockfile contention on `auth.json` and `settings.json`"
([pi-mono#1871](https://github.com/badlogic/pi-mono/issues/1871)).

**If the provider rejects a rotated refresh token**, the failure surfaces from
`readTokenResponse` (`:133-137`) as:

```
OpenAI Codex token refresh failed (<status>): <body>
```

The typical body is an OAuth `invalid_grant`. `getOAuthApiKey` wraps it and discards the cause
(`pi-ai src/utils/oauth/index.ts:250-256`):

```ts
throw new Error(`Failed to refresh OAuth token for ${providerId}`);
```

`getApiKey` catches that, records it in a drainable error list, reloads, and checks whether another
process succeeded (`:503-517`):

```ts
this.reload();
const updatedCred = this.data[providerId];
if (updatedCred?.type === "oauth" && Date.now() < updatedCred.expires) {
    return provider.getApiKey(updatedCred);   // another instance refreshed; use it
}
return undefined;                              // give up for this request
```

So there is **one** retry, and it is a re-read rather than a second provider call. On failure it
returns `undefined`, the provider is treated as unconfigured, and the credential is deliberately
left on disk for a later `/login` (comment at `:514-515`). The user-visible message comes from
`src/core/agent-session.ts:392-398`:

```
Authentication failed for "openai-codex". Credentials may have expired or network is unavailable.
Run '/login openai-codex' to re-authenticate.
```

**The lock does not cover a symlinked path the way the write does.** The lock is taken with
`realpath: false` (`:88`, and the same in `src/core/trust-manager.ts:145`), so the lock name is
derived from the path as given. The write is a plain `writeFileSync`, which the OS resolves through
symlinks. Two processes reaching the same `auth.json` by different paths, one through a symlink,
would take two different locks and write the same file. The Agenta compose mount is a direct bind,
so this does not bite today, but any design that introduces a symlinked agent dir must keep the lock
path canonical.

## 6. Write path

**In place, not temp plus rename** (`:117-120` and `:162-165`, identical in both paths):

```ts
if (next !== undefined) {
    writeFileSync(this.authPath, next, AUTH_FILE_WRITE_OPTIONS);
    chmodSync(this.authPath, 0o600);
}
```

The content is `JSON.stringify(merged, null, 2)` (`:298`, `:459`). There is no `.tmp` file and no
`rename`. Durability rests on the lock, not on atomicity. A crash between the truncate and the
write leaves a partial or empty `auth.json`. That is the exact condition the Agenta runner already
reports as `login_unusable` for a zero-byte file
(`services/runner/src/subscription-status.ts:175`).

**The write follows symlinks.** `normalizePath` expands `~` only (`src/utils/paths.ts:57-79`); it
does not call `realpathSync`. `writeFileSync` on a symlink writes through to the target. So a
symlinked `auth.json` is written at its destination, while the lock sits beside the link. See the
warning at the end of section 5.

**If the write fails after a successful provider refresh, the new token is lost and the old refresh
token has already been spent.** `refreshOAuthTokenWithLock` sets `this.data = merged` *before*
returning the `next` string (`:457-459`), so the in-memory copy holds the new token even when the
persist throws. The throw propagates out of `withLockAsync` into `getApiKey`'s catch (`:503`),
which reloads from disk, finds the stale credential, and returns `undefined`. The refreshed token
that lived for a moment in memory is discarded with the exception. On the next run Pi presents the
old refresh token, which the provider has probably already rotated away. This is the single most
dangerous failure mode for a shared or unreliable mount, and it is why the runner probes the mount
for writability before starting
(`services/runner/src/engines/sandbox_agent/pi-assets.ts:729-756`).

Changelog 0.80.4 (line 73) records a related fix on the login path:
"`/login` to report auth storage persistence failures instead of claiming credentials were saved
when `auth.json` is locked" ([pi#6223](https://github.com/earendil-works/pi/issues/6223)).
Changelog 0.52.7 (line 2294) records compromised lock files being handled without crashing.

## 7. Error classification

Pi does not expose an error taxonomy. Everything is a plain `Error` carrying a formatted string.
Classify by string.

| Meaning | String, and where it is built |
| --- | --- |
| Refresh rejected by the provider | `OpenAI Codex token refresh failed (<status>): <body>` (`pi-ai src/utils/oauth/openai-codex.ts:136`). Status 400 with an `invalid_grant` body means the refresh token is dead and the user must log in again. |
| Refresh could not reach the provider | `OpenAI Codex token refresh error: <message>` (`:191`). Transient. |
| Refresh failed, cause discarded | `Failed to refresh OAuth token for openai-codex` (`pi-ai src/utils/oauth/index.ts:254`). This is what most callers actually see, and it does not distinguish the two rows above. |
| Credential unusable, user must log in | `Authentication failed for "openai-codex". Credentials may have expired or network is unavailable. Run '/login openai-codex' to re-authenticate.` (`src/core/agent-session.ts:392-398` and `:1146-1152`) |
| No credential at all | `No API key found for openai-codex.` plus the `/login` hint (`src/core/auth-guidance.ts:22-25`) |
| Access token malformed | `Failed to extract accountId from token` (`pi-ai src/api/openai-codex-responses.ts:1499`) |
| Provider rejected the request | Whatever `parseErrorResponse` produces from the body, thrown at `pi-ai src/api/openai-codex-responses.ts:405`. A 401 lands here. Never retried, never refreshed. |
| Transient transport | 429, 500, 502, 503, 504 only, retried internally with `retry-after` honored (`:120-146`) |

Note that "refresh needed" is not an error class at all. Pi handles expiry silently before the
request, so a caller never sees it.

**As the Agenta runner sees it.** The runner never reads Pi's errors as auth errors. It flattens
the harness failure to one string and runs it through
`services/runner/src/engines/sandbox_agent/errors.ts`. The relevant regex is at `:197-198`:

```ts
const AUTH_REFUSAL = /authentication required|invalid api key|unauthorized|(?<!\d)401(?!\d)/i;
```

Pi's `Authentication failed for "openai-codex"...` does not match any alternative in that regex.
Its `Failed to refresh OAuth token for openai-codex` does not match either. A 401 body from
chatgpt.com does match, through the bare-401 alternative. When it matches, the runner emits
(`errors.ts:466-473`, pinned by `services/runner/tests/unit/sandbox-agent-errors.test.ts:78-80`):

```
pi_core: model authentication failed — add the project's OpenAI key to the project vault, or log in (OAuth).
```

That advice is wrong for a subscription run, which never uses a vault key. Codex has a fix for this
shape through the `authFault` hook
(`services/runner/src/engines/sandbox_agent/codex-assets.ts:226-238`, wired at
`run-turn.ts:1597` and `environment.ts:1419`). **Pi has no equivalent.** Grep for `invalid_grant`
across `services/runner/src` returns nothing, so the runner cannot currently tell a dead refresh
token from a missing key.

The runner's Pi-specific auth-adjacent failure is the mount probe, not a token check:
`PI_AGENT_DIR_UNWRITABLE_MESSAGE` (`pi-assets.ts:330-333`), thrown at
`services/runner/src/engines/sandbox_agent/environment.ts:631-633`.

## 8. Picking up a new `auth.json` without a restart

**Partly, and the part that fails is the one that matters for a first login.**

Because there is no watcher and `getApiKey` reads the in-memory copy, the answer depends on what
the running process already holds for that provider:

| State in the running process | Does a fresh external `auth.json` reach it? |
| --- | --- |
| Cached `openai-codex` credential, unexpired | No. The cached token is used until its `expires` passes. |
| Cached `openai-codex` credential, expired | Yes. The next request enters `refreshOAuthTokenWithLock`, which re-reads the file under the lock (`:428-439`) and returns the newly written token without calling the provider. |
| No `openai-codex` credential at all | **No, never.** `getApiKey` sees `cred === undefined` (`:480`), skips both branches, and falls through to the environment variable (`:527`). Nothing re-reads. |
| Login performed in-process, via `AuthStorage.login` | Yes. `set()` writes the file and updates `this.data` (`:326-328`). |

The third row is the trap. A runner that starts Pi before the user has logged in will not notice
the login, no matter how long it waits. The workaround inside the process is a public `reload()`
(`:259-272`); from outside the process, it is a restart.

## 9. Refresh-token rotation and the id token

**Rotation: Pi always stores a new refresh token.** `readTokenResponse` requires `refresh_token` in
every token response, both exchange and refresh, and throws if it is missing
(`src/utils/oauth/openai-codex.ts:145-147`). The refreshed value is written straight into the stored
credential (`:149-153`, `:612-614`). Pi never keeps the previous refresh token.

**The id token is requested but never stored.** The authorize URL asks for the `openid profile email
offline_access` scope (`:45`) and sets `id_token_add_organizations=true` (`:313`), but
`readTokenResponse` reads only `access_token`, `refresh_token`, and `expires_in`. Any `id_token` in
the response is dropped. Contrast with the Codex CLI, which does persist an id token. Anything in
the Agenta design that expects to read plan or organization claims from a stored id token will not
find one in Pi's `auth.json`.

**Server behavior on the old refresh token is unproven.** Nothing in the source, the shipped docs,
or the changelog states whether `auth.openai.com` invalidates the previous refresh token when it
issues a new one, or whether logging in on a second machine invalidates the first machine's tokens.
Treat both as unknown until measured. Do not design around an assumption either way.

What the changelog *does* prove is that multi-process refresh was a real, observed problem that the
lock was written to solve:

- 0.37.0, line 3313: "OAuth refresh no longer logs users out when multiple pi instances are running"
  ([pi-mono#466](https://github.com/badlogic/pi-mono/pull/466)).
- 0.56.3, line 1957: parallel processes hitting false "No API key found" from lock contention
  ([pi-mono#1871](https://github.com/badlogic/pi-mono/issues/1871)).
- 0.53.0, line 2159: locked read/merge/write added to preserve unrelated external edits.
- 0.73.1, line 792: Codex OAuth refresh failures were writing to stderr under the TUI
  ([pi-mono#4141](https://github.com/badlogic/pi-mono/issues/4141)).

The first entry is the important one. It says the pre-lock behavior was that a losing process
logged the user out. The current double-check makes the loser reuse the winner's token instead. That
is the mechanism the Agenta design depends on, and it works only while every writer shares one
lockable path.

## 10. How Agenta wires Pi subscription mode today

**The runner does not speak OAuth at all.** It never calls `auth.openai.com`, never reads a token,
and never refreshes anything. Its entire contribution is to point `PI_CODING_AGENT_DIR` at a
writable mount, prove the mount is writable, install the Agenta extension, and get out of the way.
The rationale is stated in the code at
`services/runner/src/engines/sandbox_agent/pi-assets.ts:758-778`.

**The credential mode arrives on the wire.** `materializeModelEnvironment`
(`services/runner/src/engines/sandbox_agent/run-plan.ts:314-405`) validates that
`credentialMode: "runtime_provided"` carries **no** credential values (`:349-354`). Two gates then
fire before anything is created:

- Daytona is refused outright for `runtime_provided` (`run-plan.ts:512-515`), because the login
  lives only in the runner container and is never shipped to a third-party sandbox.
- A local `runtime_provided` run must have `PI_CODING_AGENT_DIR` set, else it fails with
  `LOCAL_SUBSCRIPTION_MOUNT_MISSING_MESSAGE` (`run-plan.ts:521-531`, message at `:98-100`). Pi is
  the fallthrough default for any harness that is not `claude` or `codex`.

**The subscription branch runs out of the operator's own directory.** `prepareLocalPiAssets`
(`pi-assets.ts:779-870`) branches on `credentialMode === "runtime_provided"` at `:796`. It drops any
per-run `models.json` plan (`:798-810`), probes the directory for writability (`:811`), installs the
extension into the mount (`:812`), sets `env.PI_CODING_AGENT_DIR = agentDir` (`:821`), and returns
`dir: undefined` so teardown cannot delete the mount (`:822-828`). The managed path, by contrast,
copies `auth.json` and `settings.json` into a throwaway per-run directory (`:650-670`).

`buildDaemonEnv` (`services/runner/src/engines/sandbox_agent/daemon.ts:247-296`) keeps the inherited
provider env for a `runtime_provided` run and passes `PI_CODING_AGENT_DIR` through verbatim
(`:265-266`). At `daemon.ts:150-151` the provider `openai-codex` is mapped to an empty list of
inheritable env keys, with the comment that its authentication comes from the OAuth file rather than
an env key.

**Every dev stack on the box shares one host login directory today.**
`hosting/docker-compose/ee/docker-compose.dev.yml:523-531`:

```yaml
        volumes:
            - ../../../services/runner/src:/app/src
            - ../../../services/runner/skills:/app/skills
            # Read-write on purpose: the harness refreshes its own OAuth token here and the new
            # token must persist back to the host login (a copy would discard it).
            - ${HOME}/.pi/agent:/pi-agent:rw
```

with `PI_CODING_AGENT_DIR: /pi-agent` at `:490`. `hosting/docker-compose/oss/docker-compose.dev.yml`
is identical in substance (`:454`, `:488-493`). The path has no per-stack interpolation, so **N dev
stacks are already N concurrent writers against one `auth.json`**, protected only by Pi's own
`proper-lockfile`. The `gh` variants ship the mount commented out as an opt-in recipe
(`ee/docker-compose.gh.yml:340`, `:359-372`; `oss/docker-compose.gh.yml:358`, `:378-390`).

Note the uid hazard: `services/runner/docker/Dockerfile.gh:102-116` runs as `USER node` (uid 1000)
and pre-creates `/pi-agent`. A host directory not owned by uid 1000 fails the write probe and stops
the run.

**Existing recovery behavior: essentially none.** The runner does not retry auth failures, does not
re-read `auth.json`, and does not restart Pi. `run-turn.ts:1591-1620` classifies and returns;
`environment.ts:1415-1424` classifies and then destroys the environment. Pi's own internal retry
chatter is stripped as noise (`services/runner/src/engines/sandbox_agent/pi-error.ts:31-57`). The
design bet is entirely on up-front detection: the two `run-plan.ts` gates, the writability probe,
and the out-of-band `GET /subscription-status` route (`services/runner/src/server.ts:1236-1241`).

**And that status route cannot see an expired token.**
`services/runner/src/subscription-status.ts:10-12` says so directly: `ready` means a login file
exists and parses, not that the subscription is active or the token still valid. `hasMinimumShape`
(`:145-152`) checks only that the JSON is a non-array object with at least one key. There is no
`needs_refresh` state and no expiry check anywhere in the runner. A Pi login whose refresh token was
revoked reports `ready` with `providers: ["openai"]` right up until a run fails.

## What this means for the design

1. **Device-code login is the headless entry point.** `loginOpenAICodexDeviceCode` needs no browser
   and no port. It is directly callable as a library function. ACP cannot carry a login, so the
   login has to happen outside the harness process.
2. **A custom store is a small, supported class.** Implement `AuthStorageBackend` and pass it to
   `AuthStorage.fromStorage`. The blocker is that `withLock` is synchronous, so a remote store needs
   a cached snapshot or a synchronous client.
3. **A first login is never picked up by a running process.** Only an already-cached, already-expired
   credential is re-read. Plan for a restart, or call `reload()` from an embedder.
4. **The write is not atomic and the post-refresh write failure is unrecoverable.** A refresh that
   succeeds at the provider and then fails to persist spends the refresh token and keeps the stale
   one. Any store that replaces the file should write atomically.
5. **Pi's concurrency story holds only for writers that share one lockable path.** The double-check
   under the lock is correct and proven by the changelog. It gives no protection against two
   machines, two mounts, or a symlink that splits the lock from the file.
6. **The runner's Pi error path needs the Codex treatment.** A dead subscription currently tells the
   operator to add a vault key the run never uses. The `authFault` hook already exists; Pi has no
   implementation of it.

## Open questions this research did not settle

- Does `auth.openai.com` invalidate the old refresh token on rotation? Unproven. Measure it.
- Does a login on a second machine invalidate the first? Unproven. Measure it.
- What exact status and body does the token endpoint return for a spent refresh token? The
  classification in section 7 assumes `400 invalid_grant` by OAuth convention, not by observation.
