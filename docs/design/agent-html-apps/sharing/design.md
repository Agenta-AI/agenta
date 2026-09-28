# Design

## Overview

1. The owner clicks **Share** on an app in a session drive.
2. The API copies the app folder into a snapshot, downloads the app's external files once,
   and stores the share settings in `mounts.data`.
3. The API returns a link: `https://<host>/m/share/<token>`.
4. A viewer opens the link. The API checks access and returns the snapshot. The share page
   runs the app in a sandboxed iframe with no network.

## Share settings in `mounts.data`

`MountData` (`api/oss/src/core/mounts/dtos.py`) gets one field. The key is the app path
relative to the mount, for example `apps/board`.

```python
class AppShareVersion(BaseModel):
    version: int                      # 1, 2, 3, ...
    created_at: datetime
    created_by_id: UUID
    restored_from: Optional[int] = None

class AppShare(BaseModel):
    enabled: bool                     # policy: false after "Stop sharing"
    visibility: Literal["workspace", "link"]   # policy
    nonce: str                        # credential material: 16 random bytes, base64url
    latest: int                       # data: the version the link shows
    versions: List[AppShareVersion]   # data
    created_by_id: UUID               # metadata: shown as "App by <name>"
    created_at: datetime
    updated_at: datetime

class MountData(BaseModel):
    shares: Dict[str, AppShare] = Field(default_factory=dict, exclude=True)
```

- `exclude=True` keeps `shares` out of `MountResponse` and `MountsResponse`. Share state is
  read only through the share routes.
- One DAO method, `update_app_share`, locks the mount row with `with_for_update`, reads
  `data`, changes one entry, assigns a new dict, and commits. It makes no other DAO call
  inside the lock (see `research.md`, async session facts).
- "Stop sharing" sets `enabled=false`. "Share again" sets `enabled=true` and a new `nonce`,
  so the old link stays dead. The version list is kept.

## Snapshot storage

All keys start with the store namespace, as mount keys do.

| Object | Key |
|---|---|
| File content | `[<ns>/]shares/<project_id>/<mount_id>/blobs/<sha256>` |
| Version manifest | `[<ns>/]shares/<project_id>/<mount_id>/apps/<app_path>/v<N>.json` |

Version manifest:

```json
{
  "version": 3,
  "app_path": "apps/board",
  "name": "Sprint Board",
  "entry": "index.html",
  "created_at": "2026-09-28T10:00:00Z",
  "created_by_id": "…",
  "files": {
    "index.html": {"sha256": "…", "size": 5120, "content_type": "text/html"},
    "board.json": {"sha256": "…", "size": 812, "content_type": "application/json"}
  },
  "external": {
    "https://cdn.jsdelivr.net/npm/chart.js@4.4.0/dist/chart.umd.min.js":
      {"sha256": "…", "size": 205000, "content_type": "text/javascript"}
  }
}
```

`files` keys are relative to the app folder.

## Publish: how a version is made

`publish` runs these steps in order. A failure at any step leaves the previous version live.

1. **Check the mount.** It exists, `deleted_at` is not set, `session_id` is set,
   `name == "cwd"`, and `SessionStreamsService.fetch` finds the session.
2. **Check the app.** `app_path` passes `validate_file_path` and is not the mount root.
   `<app_path>/app.json` passes the server `validate_manifest`.
3. **List the files** under `app_path`, recursively. Skip any subfolder that has its own
   `app.json`. Limits: 200 files, 5 MB per file, 25 MB in total. Over a limit, refuse with
   `snapshot_too_large`.
4. **Find external files.** In `.html` files: `<script src>`, `<link rel="stylesheet" href>`,
   and `<img src>`. In `.css` files and `<style>` blocks: `url(...)` and `@import`. Only
   `https:` URLs count. Limits: 30 URLs, 5 MB each.
5. **Download external files** through `open_egress` (`api/oss/src/core/gateways/egress.py`),
   which refuses private addresses and follows no redirects. A failed URL goes into the
   response list `external_failed`. It does not stop the publish.
6. **Write blobs** with `put_object_if_absent`, so a file that did not change is not written
   again.
7. **Write the manifest** `v<N+1>.json` with `put_object_if_absent`.
8. **Move the pointer.** `update_app_share` sets `latest = N+1` and appends the version.

**Restore** of version K writes a new manifest `v<N+1>.json` with the content of `vK.json` and
`restored_from = K`. Blobs are reused.

## Share token

```
<base64url(payload)>.<base64url(HMAC-SHA256(share_key, payload))>
payload = {"a": "ag-share-v1", "p": <project_id>, "m": <mount_id>, "d": <app_path>, "n": <nonce>}
share_key = HMAC-SHA256(sha256(crypt_key), "agenta/app-share/v1")
```

- The `a` value and the separate key mean a scope token is never accepted as a share token.
- The token has no expiry. The nonce is the revocation: a new nonce makes every old token fail.
- The payload is readable. It shows the project id, mount id, and app path. These are ids,
  not secrets, and they give no access without the signature.
- When `crypt_key` is the default `"replace-me"`, the API refuses to issue or accept share
  tokens with `sharing_disabled`.

## API routes for the owner

Added to the mounts router (`api/oss/src/apis/fastapi/mounts/router.py`). All take the app path
as `path`, like the file routes.

| Method and path | Operation id | Needs | Does |
|---|---|---|---|
| `GET /mounts/{mount_id}/apps/share?path=` | `fetch_app_share` | `VIEW_MOUNTS` | Returns the share state, the token when enabled, and the version list. `share: null` when never shared. |
| `POST /mounts/{mount_id}/apps/share/publish` | `publish_app_share` | `EDIT_MOUNTS`, interactive session | Body `{path, visibility?}`. First call creates the share and needs `visibility`. Later calls make a new version. Re-enables a stopped share with a new nonce. Returns the share state and `external_failed`. |
| `PATCH /mounts/{mount_id}/apps/share` | `edit_app_share` | `EDIT_MOUNTS`, interactive session | Body `{path, visibility}`. The link stays the same. |
| `POST /mounts/{mount_id}/apps/share/restore` | `restore_app_share` | `EDIT_MOUNTS`, interactive session | Body `{path, version}`. Makes a new version from an old one. |
| `DELETE /mounts/{mount_id}/apps/share?path=` | `stop_app_share` | `EDIT_MOUNTS`, interactive session | Sets `enabled=false`. |

"Interactive session" means `is_interactive_session(request)` is true. It refuses the agent's
`Secret` token and `ApiKey` callers, so the agent cannot share even with the user's
`EDIT_MOUNTS`.

## API routes for viewers

A new router at `/shared/apps/`. The entry `"/shared/apps/"`, with the trailing slash, is added
to `_PUBLIC_ENDPOINTS`.

| Method and path | Operation id | Returns |
|---|---|---|
| `GET /shared/apps/{token}?v=` | `fetch_shared_app` | App name, shown version, latest version, `entry`, the `files` and `external` maps (path or URL to `sha256`), author name, and `viewer`. |
| `GET /shared/apps/{token}/blobs/{sha256}?v=` | `fetch_shared_app_blob` | The bytes of one blob listed in that version's manifest. |

`viewer` in the first response:

```json
{"role": "anonymous" | "member" | "editor", "can_open_session": true, "session_id": "…",
 "workspace_id": "…", "project_id": "…"}
```

`role` is `editor` when the viewer has `EDIT_MOUNTS` on the project. `can_open_session` is true
only for project members, and the ids are sent only then.

### Access check, in order, on both routes

| Step | Failure |
|---|---|
| `crypt_key` is not the default | 503 `sharing_disabled` |
| Token signature and `a` value are valid | 404 `share_not_found` |
| Mount `(p, m)` exists | 404 `share_not_found` |
| Mount is not archived | 404 `share_unavailable` |
| `shares[d]` exists, `enabled` is true, `nonce == n` | 404 `share_not_found` |
| For `workspace`: `resolve_session_user_id` returns a user | 401 `sign_in_required` |
| For `workspace`: `AuthService.check_organization_access` passes (EE SSO and domain rules) | 403 with the policy error |
| For `workspace`: `workspace_member_exists` is true (uncached) | 403 `not_a_member` |
| `v` exists (default `latest`) | 404 `version_not_found` |
| Blob route only: `sha256` is listed in that version's manifest | 404 `blob_not_found` |

For `link` shares, the metadata route still calls `resolve_session_user_id` to fill `viewer`.
The blob route does not, to keep blob requests cheap.

### Blob response headers

Blob bytes are agent-written. They must never run as a page on the API origin.

```
Content-Type: <from the manifest>
X-Content-Type-Options: nosniff
Content-Disposition: attachment
Content-Security-Policy: sandbox; default-src 'none'
Cache-Control: no-store
```

`no-store` applies to both routes, so "Stop sharing" takes effect on the next request.

## The share page

`/m/share/<token>` in `web/mobile`, route `src/pages/share/[token].tsx`, feature folder
`src/features/share/`.

### Header

The header is outside the app's iframe. The app cannot cover it.

| Viewer | Left | Right |
|---|---|---|
| Anonymous | Logo, app name, "App by <name>" | "Sign in" |
| Workspace member | Logo, app name, "App by <name>" | Avatar, "Open in session" when `can_open_session` |
| Editor | Logo, app name, version menu `v3 ▾`, "App by you" or "App by <name>" | Avatar, "Open in session", "Share" |

- The logo goes to `/m/` for signed-in viewers and to the Agenta site for anonymous viewers.
- "Open in session" goes to `/m/w/<workspace_id>/p/<project_id>/sessions/<session_id>`.
- "Share" opens the same `ShareAppDialog` as the drive.
- The version menu lists versions and opens `?v=N`.

### Body

- The page loads the metadata, then fetches every blob it needs into an in-memory map.
- It renders `RunView` with a host built on a read-only snapshot `FsClient`. Reads come from
  the map. Writes return `read_only`.
- It assembles the document with the existing assembler. It replaces each URL in `external`
  with a `data:` URI from the map.
- It uses `SHARE_CSP` (below), the Run sandbox `allow-scripts allow-forms`, and always
  injects the stub.
- If assembly fails, it shows an error state. It never renders raw HTML.

### Exemptions the page needs

| Place | Change |
|---|---|
| `web/mobile/src/features/app/authRoute.ts` and `AuthGate.tsx` | `/share/` is public. No redirect to `/auth`. |
| `web/packages/agenta-shared/src/utils/mobileGate/index.ts` `decideMobileGate` | `/share/` passes, with no Classic mode redirect. |
| `web/mobile/src/features/analytics/Analytics.tsx` | No PostHog on `/share/`. |
| Feature flag | The share page does not read `agent-apps`. |

## Strict CSP for shared views

```
default-src 'none'; script-src 'unsafe-inline'; style-src 'unsafe-inline';
img-src data: blob:; font-src data:; media-src data: blob:; connect-src 'none';
form-action 'none'; frame-src 'none'; object-src 'none'; base-uri 'none'
```

It is exported as `SHARE_CSP` from `web/packages/agenta-entities/src/drive/htmlApp/protocol.ts`.
`buildRunFrame` gets a `csp` option. The owner's Run mode keeps `RUN_CSP`.

With this policy, an app can load only inline code and snapshot files. It cannot send data
anywhere, so a form that asks for a password cannot send what the viewer types. A request
that the app makes at runtime to an outside URL is blocked, even when the same URL was
downloaded at publish time.

## Owner UI in the drive

`ShareAppButton` and `ShareAppDialog` in `web/packages/agenta-entity-ui/src/drive/htmlApp/share/`.

- The button shows in `HtmlAppBody` and `RunView` when the file is in a session `cwd` mount and
  the viewer has `EDIT_MOUNTS`.
- The dialog has: visibility select, Copy link, Update share, the version list with Restore,
  Stop sharing, and the note "This link stops working if the session is deleted."
- After a publish, the dialog lists `external_failed` URLs: "These files did not load and will
  not work for viewers."
- API calls go through the Fern client (`web/AGENTS.md`), after the client is regenerated.

## Session lifecycle

| Event | Effect on the share |
|---|---|
| Session archived | Mount `deleted_at` is set. Both public routes return `share_unavailable`. |
| Session unarchived | The same link works again. |
| Session deleted | `delete_session_mounts` deletes the mount row and the `mounts/…` prefix, and also deletes `[<ns>/]shares/<project_id>/<mount_id>/`. The link returns `share_not_found`. |
