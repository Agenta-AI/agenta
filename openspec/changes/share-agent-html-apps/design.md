# Design

## Context

See `proposal.md` for why. The current state that shapes the approach:

- An app is a drive folder with an `app.json`. There is no app table. `create_app` writes to the session's `cwd` drive (`api/oss/src/core/apps/handlers.py:177-191`).
- A drive is a `mounts` row plus the object prefix `[<ns>/]mounts/<project_id>/<mount_id>/` (`api/oss/src/core/mounts/service.py:442-455`). Drive credentials and listings are limited to that prefix (`api/oss/src/core/store/storage.py:291-323`).
- `mounts.data` is a `json` column that only server code writes. `MountData` is an empty model, so unknown keys are dropped on read, and `data` is returned in every drive response (`api/oss/src/core/mounts/dtos.py:15-31`, `api/oss/src/dbs/postgres/mounts/mappings.py:103`).
- Every drive operation resolves the drive through `_resolve_mount` (`service.py:1027-1042`). Its 15 callers include the reads that an archived session still needs: file list, read, stat, export, and chat attachment originals (`read_attachment_original`, `service.py:815-830`, used by `core/sessions/attachments/service.py:197`). The mobile app still opens archived sessions (`web/mobile/src/features/chat/SessionWorkspace.tsx:247`).
- Run mode renders `srcdoc` with `sandbox="allow-scripts allow-forms"` and `RUN_CSP`, which allows `https:` loads and `connect-src` (`web/packages/agenta-entities/src/drive/htmlApp/protocol.ts:200, 217-218`). `RunView` takes any host, and the host takes an injected `FsClient` (`host.ts:41-44`).
- The assembler (`web/packages/agenta-entity-ui/src/drive/htmlApp/assemble.ts`) inlines same-folder files through `AssembleIo`: a local stylesheet becomes a `<style>`, a local script becomes script text, and a local image becomes a `data:` URI (`assemble.ts:93-160, 290-300`). It leaves every `https:` reference for the browser to load, and it does not rewrite `url()` or `@import` inside an inlined stylesheet. A relative `url()` in a local stylesheet therefore resolves against the parent page today and does not load.
- The scope token client caches one token per app until a minute before it expires, and nothing evicts it when the server rejects it (`web/packages/agenta-entities/src/drive/htmlApp/scopeToken.ts:36-95`). The mounts router maps every `ScopeTokenInvalid` to one 403 `{"code": "scope"}`, for a bad token and for a request outside the folder alike (`api/oss/src/apis/fastapi/mounts/router.py:80-86`).
- Public routes skip auth by plain prefix match on `_PUBLIC_ENDPOINTS`, after `/api` is stripped (`api/oss/src/middlewares/auth.py:430`, `prefix.py:43-47`). `resolve_session_user_id` and `is_interactive_session` exist for use inside a route (`auth.py:541-596`).
- The agent's tool credential is a `Secret` token with the user's project permissions and no audience (`api/oss/src/core/workflows/service.py:3099-3108`).
- The local runner's `buildDaemonEnv` is written as an allowlist, but `sandbox-agent`'s `local()` spawns `{...process.env, ...options.env}`. A key that the allowlist leaves out is still inherited. Only keys forced to `""` are removed (`services/runner/src/engines/sandbox_agent/daemon.ts:113-116, 250-310`). So today every runner variable that is not blanked reaches the agent process, `AGENTA_API_KEY` included, and so do the provider keys that the "clear provider env" path means to drop.
- On `/m`, `AuthGate` sends every signed-out viewer to `/auth`, the classic-mode gate redirects unknown paths to `/w`, PostHog records the full URL, and sign-in always lands on `/` (`web/mobile/src/features/app/AuthGate.tsx:46`, `web/packages/agenta-shared/src/utils/mobileGate/index.ts:350`, `web/mobile/src/features/analytics/Analytics.tsx:64`, `web/mobile/src/features/auth/useAuthSuccess.ts:19`). The trip through `/auth` and an OAuth or SSO provider drops the query string. The only value kept across it is the template key, in `localStorage` with a 30 minute limit (`web/mobile/src/lib/context.ts:30-75`).
- The API sets no body size limit on drive files (`api/oss/src/apis/fastapi/mounts/router.py:707`).

## Goals / Non-Goals

**Goals:**
- No new table and no migration.
- The share path reuses the Run runtime (`RunView`, the stub, the assembler) with a different host, input, and policy. It adds no second inlining path.
- Every access decision for a share is made on the server, once per view.

**Non-Goals:**
- A list of all shares in a project.
- CORS changes. The `*.vercel.app` regex stays (see Risks).
- Static imports inside ES module scripts. Publish reports them (see "External files").
- Changes in `web/oss` or `web/ee`.

## Decisions

### An archived drive is read-only

Archive means "kept as history". It does not mean "gone". An archived drive keeps its reads and refuses every change and every way to get a change in:

| Access | Callers | Archived drive |
|---|---|---|
| `read` | `list_files`, `read_file`, `read_file_bytes`, `stat_file`, `build_archive_work_list` (export), `read_attachment_original`, scope mint at level `read` | Allowed |
| `write` | `write_file`, `create_folder`, `delete_path`, upload, `write_attachment_original`, `delete_attachment_original`, `edit_mount`, `sign_mount_credentials` (the credentials are read-write), scope mint at level `read-write` | Refused with `MountArchived` |
| `lifecycle` | `archive_mount`, `unarchive_mount` | Allowed |

`_resolve_mount` gets a required keyword `access: Literal["read", "write", "lifecycle"]` with no default. Each caller must state its access level, so a new caller cannot skip the check by accident. `upsert_mount` gets a required `reactivate` keyword: session drives pass `False` and stay archived; agent drives pass `True` and keep today's re-bind behavior. `upsert_mount` therefore stops clearing `deleted_at` for session drives (`api/oss/src/dbs/postgres/mounts/dao.py:91-93`), and `get_or_create_session_mount` raises `MountArchived` for an archived drive, so only unarchive restores a drive.

Whether a share is paused is a share rule, not a drive-read rule. The share route checks `deleted_at` itself (see "Viewer route").

Alternative: refuse every access to an archived drive (rejected: the history view of an archived session loses its attachments and files, and a share pause does not need it).

### Share settings live in `mounts.data`

`MountData` gets `shares: Dict[str, AppShare]`, keyed by the app path, with `Field(exclude=True)` so drive responses leave it out.

```python
class AppShareVersion(BaseModel):
    version: int
    created_at: datetime
    created_by_id: UUID
    restored_from: Optional[int] = None

class AppShare(BaseModel):
    enabled: bool                              # policy
    visibility: Literal["workspace", "link"]   # policy
    nonce: str                                 # credential material, 16 random bytes
    latest: int                                # data
    versions: List[AppShareVersion]            # data
    created_by_id: UUID                        # metadata
    created_at: datetime
    updated_at: datetime
```

One DAO method locks the row with `with_for_update`, changes one entry, assigns a new dict (the `json` column has no mutation tracking), and commits. It makes no nested DAO call, because a nested call in the same task shares the session and commits early (`api/oss/src/dbs/postgres/shared/engine.py:47-66`).

Alternatives: a new `app_shares` table (rejected: the owner asked for no table, and the share must die with the drive row anyway); the git layer (`GitDAO`) for versions (rejected: it needs three tables per domain).

### Snapshots are content-addressed objects beside the drive prefix

| Object | Key |
|---|---|
| File content | `[<ns>/]shares/<project_id>/<mount_id>/blobs/<sha256>` |
| Version manifest | `[<ns>/]shares/<project_id>/<mount_id>/apps/<app_path>/v<N>.json` |

A manifest has four parts:

- `files`: each app-relative path → `{sha256, size, content_type}`.
- `external`: each captured URL, keyed by the URL as written after it is made absolute → `{sha256, size, content_type, final_url}`.
- `refs`: for each HTML or CSS entry in `files` or `external`, each reference string found in it → its target, `{"file": <app path>}` or `{"url": <external key>}`. A reference that was not captured has no entry.
- `name`, `entry`, author, and `warnings` (see "External files").

The server is the only place that parses references for a share. The viewer does not resolve anything; it looks references up in `refs`.

Blobs are written with `put_object_if_absent`, so unchanged files are not written again. The manifest is written next, and the `latest` pointer in `mounts.data` moves last, so a failed publish never exposes a partial version. Restore writes a new manifest from an old one and reuses the blobs.

The prefix sits outside the drive prefix, so drive listings and sandbox credentials cannot reach it. Session delete removes it with the drive prefix.

Alternative: snapshots under the drive prefix (rejected: they would show up in the drive and be writable by the agent).

### External files are captured at publish time as a closed graph

Publish walks a reference graph that starts at the app's HTML and CSS files:

| In | Reference | Resolved against |
|---|---|---|
| HTML | `<script src>`, `<link rel="stylesheet" href>`, `<img src>`, `<style>` blocks, `style=""` attributes | the HTML file's folder |
| CSS (local or captured) | `url()`, `@import` | the stylesheet's own location: its folder for a local file, its `final_url` for a captured one |

A relative reference in a captured stylesheet becomes an absolute URL. That is how the font files of Google Fonts, KaTeX, or Font Awesome are found. Each `https:` URL is fetched through `open_egress` (`api/oss/src/core/gateways/egress.py:262`), which refuses private addresses and pins the resolved address. A redirect is followed up to 3 hops. Each hop goes through `open_egress` again, so a redirect cannot reach a private address. A captured stylesheet is parsed in turn, to a depth of 3.

One budget covers the snapshot: at most 200 files, 5 MB for each file, and 25 MB in total, captured files included. At most 30 captured URLs across the whole graph. A local file over the limits refuses the publish. A captured URL that fails, or that does not fit the budget, is reported in `external_failed` and does not stop the publish.

A module script (`<script type="module">`) is captured and inlined as one script. Its static and dynamic imports of other URLs are not followed, and `SHARE_CSP` blocks them. When a module script's text contains an import of a URL, publish adds a `module_imports_not_captured` warning that names the file. The owner sees it in the share dialog.

Alternative: block and warn with no capture (rejected by the owner: CDN apps would render broken). Alternative: capture only the first level (rejected: fonts and relative CSS assets fail, which is the common CDN case).

### The share token is stateless and revoked by a nonce

```
<b64url(payload)>.<b64url(HMAC-SHA256(k, payload))>
payload = {"a": "ag-share-v1", "p": project_id, "m": mount_id, "d": app_path, "n": nonce}
k = HMAC-SHA256(sha256(crypt_key), "agenta/app-share/v1")
```

The token has no expiry. A new nonce on "share again" makes old tokens fail. The payload is readable; it holds ids, not secrets. Scope tokens move to their own derived key (`agenta/app-scope/v1`), so neither token type verifies as the other, and neither shares key bytes with Fernet secret encryption (`api/oss/src/utils/crypting.py:22`). With the default `crypt_key` (`"replace-me"`, `api/oss/src/utils/env.py:766`), share tokens are neither issued nor accepted.

Alternative: an opaque random id (rejected: it needs a lookup index, which means a table or a `jsonb` column).

### A rejected scope token is re-minted, a denied request is not

The server has two different failures, and today it reports them as one. The scope token module splits them:

| Error | When | Response |
|---|---|---|
| `ScopeTokenInvalid` | bad signature, malformed, unknown version, expired | 403 `{"code": "scope_token_invalid"}` |
| `ScopeDenied` | a valid token, but the request is outside the folder, above the level, or for another drive | 403 `{"code": "scope"}` |

Both failures are 403, not 401: a 401 makes the SuperTokens interceptor try a session refresh. On `scope_token_invalid`, the client evicts the cached token, mints once, and retries the call once. A second failure fails closed. On `scope`, the client does not retry. This makes the key change, an API restart with a new key, and clock skew heal on the next call. It also lets Run fail closed on mint failure without breaking open apps.

### Owner routes on the mounts router

| Method and path | Operation id | Needs |
|---|---|---|
| `GET /mounts/{mount_id}/apps/share?path=` | `fetch_app_share` | `VIEW_MOUNTS` |
| `POST /mounts/{mount_id}/apps/share/publish` body `{path, visibility?}` | `publish_app_share` | `EDIT_MOUNTS`, interactive session |
| `PATCH /mounts/{mount_id}/apps/share` body `{path, visibility}` | `edit_app_share` | `EDIT_MOUNTS`, interactive session |
| `POST /mounts/{mount_id}/apps/share/restore` body `{path, version}` | `restore_app_share` | `EDIT_MOUNTS`, interactive session |
| `DELETE /mounts/{mount_id}/apps/share?path=` | `stop_app_share` | `EDIT_MOUNTS`, interactive session |

`is_interactive_session` is what separates the person from the agent, because both hold `EDIT_MOUNTS`. `delete_user_account` uses the same check (`api/oss/src/routers/user_profile.py:120`). Publish returns `external_failed` and `warnings`.

### Viewer route: one access check per view

`/shared/apps/` is added to `_PUBLIC_ENDPOINTS`, with the trailing slash, because the match is a plain prefix.

| Method and path | Operation id | Returns |
|---|---|---|
| `GET /shared/apps/{token}?v=` | `fetch_shared_app` | Name, shown and latest version, `entry`, author name, `viewer {role, can_open_session, session_id?, workspace_id?, project_id?}`, `refs`, and the content of every entry in `files` and `external` (base64) |

Access is decided once per version view, not once per file. Access check, in order: default key (503 `sharing_disabled`); signature and `a` (404 `share_not_found`); drive exists (404); drive not archived (404 `share_unavailable`); share enabled and nonce matches (404); for `workspace`, `resolve_session_user_id` (403 `sign_in_required`, not 401, so the SuperTokens interceptor does not try a refresh for a viewer with no session), `AuthService.check_organization_access` (403 with the policy error), uncached `workspace_member_exists` (403 `not_a_member`); version exists (404 `version_not_found`).

The route calls the organization policy check itself because the middleware skips public routes (`auth.py:1352`). It streams the JSON body. It reads the manifest, writes the metadata, then reads each blob from the store and writes it, one blob at a time, so a 25 MB snapshot is never held in memory whole. The response is `application/json` with `X-Content-Type-Options: nosniff`, `Content-Security-Policy: sandbox; default-src 'none'`, and `Cache-Control: no-store`. No snapshot file has its own URL, so no snapshot file can render on the Agenta origin.

Alternative: a blob route per file (rejected: one view of a `workspace` share ran the full SuperTokens, policy, and membership check once per file, up to 230 times). Alternative: a signed per-version blob grant (rejected: a second token type and a second expiry for no gain over one response).

### The share page reuses Run with a strict policy and one inlining path

`SHARE_CSP` is added to `protocol.ts`, and `buildRunFrame` gets a `csp` option. The owner's Run mode keeps `RUN_CSP`.

```
default-src 'none'; script-src 'unsafe-inline'; style-src 'unsafe-inline';
img-src data: blob:; font-src data:; media-src data: blob:; connect-src 'none';
form-action 'none'; frame-src 'none'; object-src 'none'; base-uri 'none'
```

`SHARE_CSP` allows only inline code. So a captured script or stylesheet must become inline text, not a `data:` URI. The assembler already does this for local files. The change makes that one path serve every source:

- `AssembleIo` gets an optional `resolve(base, ref)` that returns a target, or `null` for "leave it". Without it, the assembler keeps its current rules: relative paths resolve in the drive, and `https:` references are left for the browser.
- The inliner handles each reference by what it is, not by where it comes from. A script becomes script text. A stylesheet becomes a `<style>`, and its `url()` and `@import` references are inlined in the same pass, relative to the stylesheet's own base. An image or font becomes a `data:` URI.
- The share page's `io.resolve` answers from the manifest's `refs`, and its `fetchText` and `fetchDataUri` answer from the response content. A reference with no `refs` entry is removed and listed in the page's error strip, because `SHARE_CSP` would block it anyway.

Rewriting `url()` inside inlined stylesheets also applies in Preview and Run. This fixes relative `url()` in local stylesheets, which does not load today.

The page renders `RunView` with a host built on a read-only snapshot `FsClient`. Writes return `read_only`. The stub is always injected. The page is `web/mobile/src/pages/share/[token].tsx`, with its feature code in `web/mobile/src/features/share/`. `/share/` is exempt from `AuthGate`, from the classic-mode redirect in `decideMobileGate`, and from PostHog.

Alternative: open `https:` like Run (rejected by the owner: a shared app could track viewers or send typed data out). Alternative: add `data:` to `script-src` and `style-src` (rejected: two inlining rules for one kind of reference, and it widens the policy for no need).

### Sign-in returns to where it started

Sign-in on `/m` has no way to return to a page, because the trip through `/auth` and the provider drops the query. The template key works around this for one case. The fix is one return-path store in `web/mobile/src/lib/context.ts`, built like the template key store (`localStorage`, 30 minute limit):

- `rememberReturnPath(path)` keeps a path only when it is internal to `/m`: it starts with `/`, does not start with `//`, and is not an `/auth` path.
- `AuthGate` calls it when it sends a signed-out viewer to `/auth` from a deep link. The share page calls it before it sends a `workspace` viewer to sign in.
- `useAuthSuccess` takes the kept path once, clears it, and goes there. With no kept path it goes to `/`, as it does today.

This also returns a signed-out user who opened a session link to that session after sign-in.

Alternative: a `next` query parameter (rejected: OAuth and SSO callbacks drop it).

### Agent processes inherit nothing they were not given

`buildDaemonEnv` stays the allowlist. The root problem is that `local()` merges its result over `process.env`. The fix closes that merge at the spawn boundary: `closeInheritedEnv` sets every other key present in `process.env` to `""`, and the local provider applies it to the frozen env just before `local()`. Daytona is untouched, because it receives the env as its full `envVars` and inherits nothing. The child environment then equals the allowlist. `KNOWN_SANDBOX_ENV_VARS` becomes a part of this rule, and the provider-key rules (`clearProviderEnv`, RUN-SEC-1) start to hold as their comments say.

The allowlist gets the neutral OS variables that a harness needs to run: `TMPDIR`, `LANG`, `LC_ALL`, `TZ`, `USER`, `SHELL`, `TERM`, the proxy variables, `SSL_CERT_FILE`, and `NODE_EXTRA_CA_CERTS`, next to the existing `PATH`, `HOME`, and config directories.

Alternative: add `AGENTA_API_KEY` and `AGENTA_RUNNER_TOKEN` to the blanked list (rejected: the next platform variable leaks the same way).

### Prerequisite fixes ship first as their own PR

- Archived drives are read-only (see "An archived drive is read-only").
- `delete_session_mounts` removes prefixes before rows (`service.py:955-975`). `delete_keys` raises `StoreDeleteFailed` with the failed keys, so `delete_prefix` and single-file deletes both surface a partial delete (`storage.py:697-725`); the mounts router maps it to 503.
- The scope token errors split into `scope_token_invalid` and `scope`, the client re-mints once on the first, and the client fails closed (`scopeToken.ts:60-64`). A root-level HTML file does not offer Run.
- The assemblers return an error document under the policy instead of raw HTML (`assemble.ts:219-220, 336-340`).
- Key derivation per purpose, and a startup error log when `crypt_key` is the default.
- The local runner's child environment equals its allowlist.

## Risks / Trade-offs

- [The scope key change rejects every cached token once] → The client re-mints on `scope_token_invalid` and retries, so each open app pays one extra call.
- [CORS trusts `*.vercel.app` with credentials (`api/entrypoints/routers.py:624-625`)] → Kept by owner decision. Where cookies are `SameSite=None`, such a site can read a `workspace` share response. The default single-host stack uses same-site cookies.
- [A shared app can still show a form that asks for a password] → The strict policy stops the typed data from leaving the frame. The header, outside the frame, always names the author.
- [Chrome `<link rel="prerender">` may ignore CSP (recorded in `docs/design/agent-html-apps/contracts.md:218-221`, not tested here)] → One request per load can leave. Test during implementation and record the result.
- [Bundled SeaweedFS keeps deleted objects as old versions for `version_retention_days` (`storage.py:184-229`)] → A stopped or deleted share's bytes stay in storage for that time. They are not reachable through any route.
- [The viewer response is up to about 34 MB of base64] → It is streamed and gzip-compressed (`GZipMiddleware`), and it replaces up to 230 requests. A `?v=` change loads the whole version again.
- [No rate limit on the public share route] → One view is one request with one access check. Only a person with the link can call the route, and the owner can stop the share at once. A rate limit is out of scope.
- [Blanking inherited variables can remove one that a harness needs] → The integration check runs each local harness once. A missing variable is added to the allowlist by name.
- [The `json` column cannot be indexed] → No query needs to search share settings. A `jsonb` migration is possible later.

## Migration Plan

1. Merge the prerequisite PR. Check that archive, unarchive, the history view of an archived session, session delete, and one local run of each harness work in the local stack.
2. Merge the sharing PR. No data migration: drives without `shares` read as empty.
3. Rollback: revert the sharing PR. Stored `shares` keys are dropped on read by the old model, and snapshots under `shares/` stay unused until the session is deleted.

## Open Questions

None. The SuperTokens question is closed by design: the viewer route never answers 401.
