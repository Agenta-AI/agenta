# Design

## Context

See `proposal.md` for why. The current state that shapes the approach:

- An app is a drive folder with an `app.json`. There is no app table. `create_app` writes to the session's `cwd` drive (`api/oss/src/core/apps/handlers.py:177-191`).
- A drive is a `mounts` row plus the object prefix `[<ns>/]mounts/<project_id>/<mount_id>/` (`api/oss/src/core/mounts/service.py:442-455`). Drive credentials and listings are limited to that prefix (`api/oss/src/core/store/storage.py:291-323`).
- `mounts.data` is a `json` column that only server code writes. `MountData` is an empty model, so unknown keys are dropped on read, and `data` is returned in every drive response (`api/oss/src/core/mounts/dtos.py:15-31`, `api/oss/src/dbs/postgres/mounts/mappings.py:103`).
- Run mode renders `srcdoc` with `sandbox="allow-scripts allow-forms"` and `RUN_CSP`, which allows `https:` loads and `connect-src` (`web/packages/agenta-entities/src/drive/htmlApp/protocol.ts:200, 217-218`). `RunView` takes any host, and the host takes an injected `FsClient` (`host.ts:41-44`).
- Public routes skip auth by plain prefix match on `_PUBLIC_ENDPOINTS`, after `/api` is stripped (`api/oss/src/middlewares/auth.py:430`, `prefix.py:43-47`). `resolve_session_user_id` and `is_interactive_session` exist for use inside a route (`auth.py:541-596`).
- The agent's tool credential is a `Secret` token with the user's project permissions and no audience (`api/oss/src/core/workflows/service.py:3099-3108`).
- On `/m`, `AuthGate` sends every signed-out viewer to `/auth`, the classic-mode gate redirects unknown paths to `/w`, PostHog records the full URL, and sign-in always lands on `/` (`web/mobile/src/features/app/AuthGate.tsx:46`, `web/packages/agenta-shared/src/utils/mobileGate/index.ts:350`, `web/mobile/src/features/analytics/Analytics.tsx:64`, `web/mobile/src/features/auth/useAuthSuccess.ts:19`).
- The API sets no body size limit on drive files (`api/oss/src/apis/fastapi/mounts/router.py:707`).

## Goals / Non-Goals

**Goals:**
- No new table and no migration.
- The share path reuses the Run runtime (`RunView`, the stub, the assemblers) with a different host and policy.
- Every access decision for a share is made on the server.

**Non-Goals:**
- A list of all shares in a project.
- CORS changes. The `*.vercel.app` regex stays (see Risks).
- Changes in `web/oss` or `web/ee`.

## Decisions

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

A manifest maps each app-relative path, and each captured external URL, to `{sha256, size, content_type}`, and records the app name, `entry`, and author. Blobs are written with `put_object_if_absent`, so unchanged files are not written again. The manifest is written next, and the `latest` pointer in `mounts.data` moves last, so a failed publish never exposes a partial version. Restore writes a new manifest from an old one and reuses the blobs.

The prefix sits outside the drive prefix, so drive listings and sandbox credentials cannot reach it. Session delete removes it with the drive prefix.

Alternative: snapshots under the drive prefix (rejected: they would show up in the drive and be writable by the agent).

### The share token is stateless and revoked by a nonce

```
<b64url(payload)>.<b64url(HMAC-SHA256(k, payload))>
payload = {"a": "ag-share-v1", "p": project_id, "m": mount_id, "d": app_path, "n": nonce}
k = HMAC-SHA256(sha256(crypt_key), "agenta/app-share/v1")
```

The token has no expiry. A new nonce on "share again" makes old tokens fail. The payload is readable; it holds ids, not secrets. Scope tokens move to their own derived key (`agenta/app-scope/v1`), so neither token type verifies as the other, and neither shares key bytes with Fernet secret encryption (`api/oss/src/utils/crypting.py:22`). With the default `crypt_key` (`"replace-me"`, `api/oss/src/utils/env.py:766`), share tokens are neither issued nor accepted.

Alternative: an opaque random id (rejected: it needs a lookup index, which means a table or a `jsonb` column).

### Owner routes on the mounts router

| Method and path | Operation id | Needs |
|---|---|---|
| `GET /mounts/{mount_id}/apps/share?path=` | `fetch_app_share` | `VIEW_MOUNTS` |
| `POST /mounts/{mount_id}/apps/share/publish` body `{path, visibility?}` | `publish_app_share` | `EDIT_MOUNTS`, interactive session |
| `PATCH /mounts/{mount_id}/apps/share` body `{path, visibility}` | `edit_app_share` | `EDIT_MOUNTS`, interactive session |
| `POST /mounts/{mount_id}/apps/share/restore` body `{path, version}` | `restore_app_share` | `EDIT_MOUNTS`, interactive session |
| `DELETE /mounts/{mount_id}/apps/share?path=` | `stop_app_share` | `EDIT_MOUNTS`, interactive session |

`is_interactive_session` is what separates the person from the agent, because both hold `EDIT_MOUNTS`. `delete_user_account` uses the same check (`api/oss/src/routers/user_profile.py:120`). Publish returns `external_failed`.

### Viewer routes on a public router

`/shared/apps/` is added to `_PUBLIC_ENDPOINTS`, with the trailing slash, because the match is a plain prefix.

| Method and path | Operation id | Returns |
|---|---|---|
| `GET /shared/apps/{token}?v=` | `fetch_shared_app` | Name, shown and latest version, `entry`, file and external maps, author name, and `viewer {role, can_open_session, session_id?, workspace_id?, project_id?}` |
| `GET /shared/apps/{token}/blobs/{sha256}?v=` | `fetch_shared_app_blob` | One blob listed in that version's manifest |

Access check, in order: default key (503 `sharing_disabled`); signature and `a` (404 `share_not_found`); drive exists (404); drive not archived (404 `share_unavailable`); share enabled and nonce matches (404); for `workspace`, `resolve_session_user_id` (401 `sign_in_required`), `AuthService.check_organization_access` (403 with the policy error), uncached `workspace_member_exists` (403 `not_a_member`); version exists (404 `version_not_found`); blob listed in the manifest (404 `blob_not_found`).

The route calls the organization policy check itself because the middleware skips public routes (`auth.py:1352`). The blob route does not resolve the user for `link` shares, to keep it cheap. Blob responses carry `Content-Disposition: attachment`, `X-Content-Type-Options: nosniff`, `Content-Security-Policy: sandbox; default-src 'none'`, and `Cache-Control: no-store`.

### External files are captured at publish time

Publish scans `.html` files for `<script src>`, `<link rel="stylesheet" href>`, and `<img src>`, and `.css` files and `<style>` blocks for `url()` and `@import`. It fetches `https:` URLs through `open_egress` (`api/oss/src/core/gateways/egress.py:262`), which refuses private addresses, pins the resolved address, and follows no redirects. The viewer assembler replaces each captured URL with a `data:` URI.

Alternative: block and warn with no capture (rejected by the owner: CDN apps would render broken).

### The share page reuses Run with a strict policy

`SHARE_CSP` is added to `protocol.ts`, and `buildRunFrame` gets a `csp` option. The owner's Run mode keeps `RUN_CSP`.

```
default-src 'none'; script-src 'unsafe-inline'; style-src 'unsafe-inline';
img-src data: blob:; font-src data:; media-src data: blob:; connect-src 'none';
form-action 'none'; frame-src 'none'; object-src 'none'; base-uri 'none'
```

The page loads the metadata, fetches the blobs into a map, and renders `RunView` with a host built on a read-only snapshot `FsClient`. Writes return `read_only`. The stub is always injected. The page is `web/mobile/src/pages/share/[token].tsx`, with its feature code in `web/mobile/src/features/share/`. `/share/` is exempt from `AuthGate`, from the classic-mode redirect in `decideMobileGate`, and from PostHog. Sign-in accepts a `next` path limited to `/share/...`, so a `workspace` viewer returns to the link.

Alternative: open `https:` like Run (rejected by the owner: a shared app could track viewers or send typed data out).

### Prerequisite fixes ship first as their own PR

- `_resolve_mount` refuses archived drives, with an `allow_archived` flag for archive and unarchive (`api/oss/src/core/mounts/service.py:900-935, 1027-1042`). `upsert_mount` stops clearing `deleted_at` (`api/oss/src/dbs/postgres/mounts/dao.py:91-93`).
- `delete_session_mounts` removes prefixes before rows (`service.py:953-973`). `delete_keys` returns failed keys, and `delete_prefix` raises on any (`storage.py:697-725`).
- The scope token client fails closed (`web/packages/agenta-entities/src/drive/htmlApp/scopeToken.ts:60-64`). A root-level HTML file does not offer Run.
- The assemblers return an error document under the policy instead of raw HTML (`web/packages/agenta-entity-ui/src/drive/htmlApp/assemble.ts:219-220, 336-340`).
- Key derivation per purpose, and a startup error log when `crypt_key` is the default.
- The local runner builds the daemon environment from an allowlist (`services/runner/src/engines/sandbox_agent/daemon.ts:117-124`).

## Risks / Trade-offs

- [Scope tokens break once when the key changes] → Scope tokens live 30 minutes and the client re-mints on failure; the risk is one failed call per open app.
- [CORS trusts `*.vercel.app` with credentials (`api/entrypoints/routers.py:624-625`)] → Kept by owner decision. Where cookies are `SameSite=None`, such a site can read a `workspace` share response. The default single-host stack uses same-site cookies.
- [A shared app can still show a form that asks for a password] → The strict policy stops the typed data from leaving the frame. The header, outside the frame, always names the author.
- [Chrome `<link rel="prerender">` may ignore CSP (recorded in `docs/design/agent-html-apps/contracts.md:218-221`, not tested here)] → One request per load can leave. Test during implementation and record the result.
- [Bundled SeaweedFS keeps deleted objects as old versions for `version_retention_days` (`storage.py:184-229`)] → A stopped or deleted share's bytes stay in storage for that time. They are not reachable through any route.
- [No rate limit on public routes] → Blob routes do no user lookup. A limit is out of scope.
- [The `json` column cannot be indexed] → No query needs to search share settings. A `jsonb` migration is possible later.

## Migration Plan

1. Merge the prerequisite PR. Check that archive, unarchive, and session delete work in the local stack.
2. Merge the sharing PR. No data migration: drives without `shares` read as empty.
3. Rollback: revert the sharing PR. Stored `shares` keys are dropped on read by the old model, and snapshots under `shares/` stay unused until the session is deleted.

## Open Questions

- Does the `sandbox-agent` daemon pass its environment on to agent processes? The allowlist fix is safe either way; the answer decides whether the spec scenario fails today.
- Does the SuperTokens fetch interceptor try a refresh on a 401 from `/shared/apps/` for a viewer with no cookies? If it does, the share page calls the routes without the interceptor.
