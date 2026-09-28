# Plan

Two changes ship in order. The fix-first change closes bugs that already exist and that would
make a public link unsafe. The sharing change builds the feature on top of it. Each change is
its own PR.

## Change 1: fix-first

Each item points to its bug in `research.md`.

### Tasks

1. **Separate signing keys** (bug 1).
   - Add a helper that derives a key per purpose: `HMAC-SHA256(sha256(crypt_key), label)`.
   - Use it for scope tokens with the label `agenta/app-scope/v1`. Existing scope tokens stop
     working once; the client mints a new one on the next call.
   - Add `is_default_crypt_key()` and log an error at startup when it is true. Do not stop
     startup, because zero-config self-hosting depends on it.
2. **Archived mounts refuse file access** (bug 2).
   - `_resolve_mount` refuses a mount with `deleted_at` set, with a new `MountArchived` error.
     It gets an `allow_archived` parameter. `archive_mount` and `unarchive_mount` call
     `_resolve_mount` (`api/oss/src/core/mounts/service.py:900-935`) and pass
     `allow_archived=True`.
   - `upsert_mount` stops clearing `deleted_at`. `get_or_create_session_mount` on an archived
     mount raises `MountArchived`. Only `unarchive_session_mounts` unarchives.
   - Check every caller of `fetch_mount` and `_resolve_mount` for the new error.
3. **App scope fails closed** (bug 3).
   - When minting a scope token fails, Run does not start and shows an error.
   - An HTML file at the mount root cannot use Run. Preview still works.
4. **Assemblers never return raw HTML** (bug 4). On error they return a small error document
   that carries the CSP.
5. **CORS** (bug 5). No change in this plan. The current CORS settings stay (see
   `status.md`).
6. **Local runner environment** (bug 6).
   - Confirm whether the `sandbox-agent` daemon passes its environment to agent processes.
   - If it does, build the daemon environment from an allowlist in
     `services/runner/src/engines/sandbox_agent/daemon.ts`, as the agent-tools setup script
     does.
7. **Session delete leaves no objects** (bug 7).
   - `delete_session_mounts` deletes the prefixes first and the rows last. A retry then finds
     the rows and tries again.
   - `delete_keys` returns the keys that failed, and `delete_prefix` raises when any failed.

### Tests

- API unit tests: key derivation; `_resolve_mount` and file routes refuse archived mounts;
  upsert on an archived mount raises; `delete_session_mounts` order and failure handling.
- Package unit tests (`web/packages`): assembler error path; Run refuses to start without a
  scope token and for a root-level file.
- Runner unit test: the daemon environment contains only allowlisted names.
- Existing API tests pass: `cd api && py-run-tests`.

## Change 2: sharing

### Tasks

1. **Data model.** Add `AppShare`, `AppShareVersion`, and `MountData.shares` (`exclude=True`).
   Add the DAO method `update_app_share` with a row lock.
2. **Token.** Add `api/oss/src/core/apps/share_token.py` with `mint` and `parse`, using the
   derived key `agenta/app-share/v1` from change 1.
3. **Share service.** Add `api/oss/src/core/apps/sharing.py` with `publish`, `restore`,
   `edit`, `stop`, `fetch`, and `resolve_public` (the access check table in `design.md`).
4. **External file download.** In the share service, parse HTML and CSS for `https:` URLs and
   download them through `open_egress`, with the limits in `design.md`.
5. **Owner routes.** Add the five routes to the mounts router. Each write route checks
   `EDIT_MOUNTS` and `is_interactive_session`.
6. **Public router.** Add the router at `/shared/apps/`, register it in
   `api/entrypoints/routers.py`, and add `"/shared/apps/"` to `_PUBLIC_ENDPOINTS`. Set the blob
   response headers.
7. **Session delete.** `delete_session_mounts` also deletes
   `[<ns>/]shares/<project_id>/<mount_id>/`.
8. **Fern client.** Regenerate with `bash ./clients/scripts/generate.sh --language typescript`
   and rebuild `@agentaai/api-client`.
9. **Packages.**
   - `@agenta/entities`: `SHARE_CSP`, the `csp` option on `buildRunFrame`, the read-only
     snapshot `FsClient`, share API calls with zod validation.
   - `@agenta/entity-ui`: `ShareAppButton`, `ShareAppDialog`, and a `SharedAppView` that renders
     `RunView` from a snapshot.
10. **Mobile page.** `src/pages/share/[token].tsx`, `src/features/share/` with the header, and
    the exemptions for `AuthGate`, `decideMobileGate`, and PostHog.
11. **Docs.** Update `docs/design/agent-html-apps/contracts.md` with the share routes and the
    strict CSP.

### Tests

- API tests with the account fixtures in `api/oss/tests/pytest/utils/accounts.py`:
  - publish, update, restore, edit, stop, share again (new token, old token fails);
  - `Secret` and `ApiKey` callers cannot publish;
  - a viewer role (no `EDIT_MOUNTS`) cannot publish;
  - `link` share opens with no credentials;
  - `workspace` share: no session gives 401, a user from another workspace gives 403, a member
    gets 200;
  - archived session gives `share_unavailable`; unarchive restores it;
  - deleted session gives `share_not_found` and leaves no objects under `shares/`;
  - a blob hash not in the manifest gives 404;
  - blob responses carry the required headers;
  - apps in the agent mount and in standalone mounts are refused;
  - external URLs to private addresses are refused.
- Package unit tests: snapshot `FsClient` refuses writes; `SHARE_CSP` is in the assembled
  document; external URLs are replaced by `data:` URIs.
- Mobile unit tests: `authRedirectTarget` and `decideMobileGate` pass `/share/`.
- Manual check in the local stack (`hosting/AGENTS.md`), OSS and EE: share an app from the
  board starter, open it signed out, open it as a member of another workspace, stop sharing.

## Order and dependencies

- Change 2 depends on change 1 tasks 1 (derived keys), 2 (archived mounts), 4 (assembler
  errors), and 7 (session delete order).
- Inside change 2, tasks 1 to 7 (API) come before task 8 (Fern client), which comes before
  tasks 9 and 10 (frontend).
