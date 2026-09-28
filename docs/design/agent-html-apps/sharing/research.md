# Research

Every statement here was read in the code. Paths are relative to the repo root. Items marked
**unproven** could not be confirmed from the code.

## How apps are stored and run today

| Fact | Evidence |
|---|---|
| An app is a folder with a direct-child `app.json`. There is no app table. | `api/oss/src/core/apps/service.py`, `docs/design/agent-html-apps/specs.md:31-33` |
| `create_app` always writes to the session `cwd` mount, resolved from `$ctx.session.id`. | `api/oss/src/core/apps/handlers.py:70, 177-191` |
| Files live at `[<ns>/]mounts/<project_id>/<mount_id>/<path>`. `<ns>` is `env.store.namespace`. | `api/oss/src/core/mounts/service.py:442-455`, `api/entrypoints/routers.py:1050` |
| Mount STS credentials and list calls are limited to the mount prefix, so a sibling `shares/` prefix is not reachable through the mounts API or the sandbox. | `api/oss/src/core/store/storage.py:291-323`, `api/oss/src/core/mounts/service.py:692, 1298-1307` |
| The object store has get, put (with `if_match` and `if_none_match_any`), list, stat, and `delete_prefix`. It has no copy. | `api/oss/src/core/store/storage.py:171-725` |
| Run mode renders `srcdoc` with `sandbox="allow-scripts allow-forms"` and `RUN_CSP`, which allows `https:` scripts, styles, fonts, images, and `connect-src`. | `web/packages/agenta-entities/src/drive/htmlApp/protocol.ts:200, 217-218` |
| The stub removes `RTCPeerConnection` before app code runs. | `web/packages/agenta-entities/src/drive/htmlApp/stub.ts:62-96` |
| `RunView` accepts any host. `createHtmlAppHost` accepts an injected `FsClient`. | `web/packages/agenta-entity-ui/src/drive/htmlApp/RunView.tsx:78`, `web/packages/agenta-entities/src/drive/htmlApp/host.ts:41-44` |
| The assemblers read files only through an `AssembleIo` interface, so an in-memory file map works. | `web/packages/agenta-entity-ui/src/drive/htmlApp/assemble.ts:56-61` |
| The bridge already has the `read_only` error code, and the host refuses writes for a `read` grant before any network call. | `protocol.ts:27-34`, `host.ts:113-115` |
| The `agent-apps` flag is per user in localStorage. With no user it is `false`. `RunView` does not read it. | `web/packages/agenta-shared/src/state/featureFlags.ts:38-66` |

## Storage facts for share settings

| Fact | Evidence |
|---|---|
| `mounts.data` is a `json` column (not `jsonb`). No migration changed it. | `api/oss/databases/postgres/migrations/core_oss/versions/oss000000006_add_mounts.py:39` |
| Only server code writes `data`. No request model has it. Create and upsert write `{}`. Edit never touches it. | `api/oss/src/core/mounts/dtos.py:38-51`, `api/oss/src/dbs/postgres/mounts/mappings.py:48, 76, 111-128`, `dao.py:87-96` |
| `MountData` is an empty model. Unknown keys are dropped when a row is read. | `dtos.py:15-18`, `mappings.py:103` |
| `Mount.data` is returned in every `MountResponse` and `MountsResponse`. | `dtos.py:31`, `api/oss/src/apis/fastapi/mounts/models.py:71-78` |
| Async sessions support `with_for_update`. The mounts DAO has no example yet. A nested DAO call in the same task shares the session and commits early. | `api/oss/src/dbs/postgres/shared/engine.py:40-66`, `api/oss/src/dbs/postgres/sessions/attachments/dao.py:170` |
| A mount is archived when `deleted_at` is set. | `api/oss/src/dbs/postgres/mounts/dao.py:200-201` |
| Deleting a session deletes its mount rows, then the mount prefixes. | `api/oss/src/core/sessions/service.py:336-367`, `api/oss/src/core/mounts/service.py:953-973` |
| The session stream row is read with `SessionStreamsService.fetch`. | `api/oss/src/core/sessions/streams/service.py:971-995` |

## Auth facts for the public route

| Fact | Evidence |
|---|---|
| `/api` is removed before auth runs. Public routes match `_PUBLIC_ENDPOINTS` by plain string prefix and skip auth fully. | `api/oss/src/middlewares/prefix.py:43-47`, `api/oss/src/middlewares/auth.py:430` |
| `resolve_session_user_id(request)` returns the signed-in user or `None`. It does not refresh an expired session. | `auth.py:541-589` |
| `is_interactive_session(request)` is true only for a SuperTokens session, not for `ApiKey` or `Secret` credentials. `delete_user_account` uses it. | `auth.py:592-596`, `api/oss/src/routers/user_profile.py:120` |
| `workspace_member_exists(*, workspace_id, user_id)` runs an uncached query. | `api/oss/src/services/db_manager.py:186-204` |
| The EE org policy (SSO, allowed domains) runs in the middleware, so public routes skip it. `AuthService.check_organization_access` can be called directly. | `auth.py:1334-1390`, `api/oss/src/core/auth/service.py:565` |
| `EDIT_MOUNTS` is in the editor, developer, admin, and owner roles. OSS always enforces RBAC. | `api/oss/src/core/access/permissions/types.py:245-274`, `api/oss/src/core/access/permissions/service.py:293-310` |
| The agent calls tools with a `Secret` token that carries the user's project permissions and no audience limit. A permission check alone does not tell the agent and the user apart. | `api/oss/src/core/workflows/service.py:3099-3108`, `auth.py:1127-1143` |
| `open_egress` fetches an outside URL safely: it resolves the host, refuses private ranges, pins the address, and follows no redirects. | `api/oss/src/core/gateways/egress.py:1-33, 262` |

## Frontend facts for the share page

| Fact | Evidence |
|---|---|
| The mobile app uses `basePath: "/m"` and the pages router. There is no `/share` page. | `web/mobile/next.config.ts:29`, `web/mobile/src/pages/` |
| `AuthGate` wraps every page and sends a signed-out viewer to `/auth`. Only `/auth/callback` is exempt. | `web/mobile/src/features/app/authRoute.ts:14-21`, `AuthGate.tsx:28-52`, `AppProviders.tsx:43` |
| With the cookie `agenta-classic-mode=1`, `/m/share/...` redirects to `/w`, because the path has no desktop match. | `web/packages/agenta-shared/src/utils/mobileGate/index.ts:214-217, 250, 350-351` |
| PostHog records `$pageview` with the full URL on every non-auth page. | `web/mobile/src/features/analytics/Analytics.tsx:21-33, 64` |
| `/m` and the API share one host behind Traefik, and auth is a cookie session. | `hosting/docker-compose/oss/docker-compose.gh.yml:54, 120`, `web/packages/agenta-auth/src/client.ts:35-62` |
| New frontend API code must use the Fern client, which is generated from the OpenAPI spec. | `web/AGENTS.md` ("Frontend API: use the Fern client"), `clients/scripts/generate.sh` |
| **Unproven:** whether the SuperTokens fetch interceptor tries a refresh on a 401 from a share route for a viewer with no cookies. | `node_modules` not installed |

## Confirmed bugs that affect sharing

Each bug is fixed in the fix-first change (`plan.md`), or it becomes a rule in `design.md`.

### Bugs that break the security of a public link

1. **Default crypt key.** `crypt_key` falls back to `"replace-me"` with no startup check. The
   same `sha256(crypt_key)` bytes are the Fernet key and the scope-token HMAC key.
   `api/oss/src/utils/env.py:766`, `api/oss/src/utils/crypting.py:22`,
   `api/oss/src/core/apps/scope_token.py:82`.
2. **Archived mounts still work.** `fetch_mount` and `_resolve_mount` do not check
   `deleted_at`, so file reads, writes, `/sign`, and `/apps/scope` work on archived mounts.
   `upsert_mount` clears `deleted_at` on conflict, so a sign call or `create_app` unarchives a
   mount. `dao.py:91-93, 113-116`, `mounts/service.py:1027-1042`.
3. **App scope fails open.** When minting a scope token fails, the client runs unscoped. An
   app at the mount root gets `dir = ""`, which means the whole mount.
   `web/packages/agenta-entities/src/drive/htmlApp/scopeToken.ts:60-64`, `assemble.ts:44-45`.
4. **Assemblers return raw HTML on error.** The HTML then runs without the CSP and without the
   stub. `assemble.ts:219-220, 336-340`.
5. **CORS allows any `*.vercel.app` origin with credentials.** `api/entrypoints/routers.py:624-625`.
6. **Local runner leaks its environment to the harness daemon.** `AGENTA_RUNNER_TOKEN` always,
   and `AGENTA_API_KEY` when set. `services/runner/src/engines/sandbox_agent/daemon.ts:117-124`,
   `services/runner/patches/sandbox-agent@0.4.2.patch:184-186`. **Unproven:** whether the `sandbox-agent`
   binary passes this environment on to agent processes.

### Bugs that lose or orphan data

7. **Session delete orphans objects.** Rows are deleted before prefixes, and a failed
   `delete_prefix` is never retried. `delete_keys` ignores failed keys and reports success.
   `mounts/service.py:963-973`, `dao.py:257-263`, `storage.py:708-714`.

### Rules the sharing change must follow (not fixed separately)

8. A public prefix entry must end with `/`, because the match is a plain string prefix.
   `auth.py:430`.
9. Raw app files served by a public route must never render as a top-level page on the API
   origin.
10. The server has no size limit on file bodies (`api/oss/src/apis/fastapi/mounts/router.py:707`).
    Snapshot creation must set its own limits.
11. The two manifest validators disagree (`apps/service.py:132-190` and
    `web/packages/agenta-entities/src/drive/htmlApp/manifest.ts:67-113`). The share route
    uses the server validator only.
12. Bundled SeaweedFS keeps deleted objects as old versions for `version_retention_days`.
    `storage.py:184-229`, `api/oss/src/utils/env.py:1625-1631`. A stopped share's files stay
    in storage for that time.
