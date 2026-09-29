# Proposal

## Why

An agent can build an HTML app in a session, but only project members can see it, and only inside the session drive. There is no link, no public page, and no share button. People want to share an app the way they share a Claude artifact: with workspace members, or with anyone who has the link.

A public link also exposes gaps that exist today: archived session drives still accept writes and storage credentials, deleting a session can leave files in storage, an app can run without its folder scope, the agent's tool credential carries the user's full permissions, and the local runner passes every one of its environment variables to agent processes. These gaps must close before any link is public.

## What Changes

- The owner can share an app from a session drive. A share has one of two visibilities: `workspace` (signed-in workspace members) or `link` (anyone with the link).
- A share serves a frozen snapshot of the app folder, data files included. Viewers cannot write. "Update share" replaces the snapshot the link shows. A share keeps no history.
- The owner can change visibility (the link stays the same), stop sharing (the link stops at once), and share again (a new link; the old one stays dead).
- Only a person with `EDIT_MOUNTS` in an interactive sign-in session can create or change a share. The agent cannot, even though it acts with the user's permissions.
- Only apps in a session drive can be shared. Deleting the session ends the share. Archiving the session pauses it until the session is unarchived.
- A new standalone page at `/m/share/<token>` shows the app under a header modeled on the Claude artifact header. It needs no sign-in for `link` shares.
- Shared apps run with no network. When the owner publishes, the server follows the app's references, including those inside external stylesheets, downloads its external scripts, styles, images, and fonts once, and stores them in the snapshot. The share page inlines them the same way Run inlines local files.
- A viewer loads a share in one request, with one access check.
- Sign-in on `/m` returns the user to the page that sent them to sign in.
- Prerequisite fixes, shipped first as their own PR:
  - Archived session drives are read-only: reads still work, and writes and storage credentials are refused. A sign call or `create_app` no longer unarchives a drive.
  - Deleting a session removes every stored object of its drives and can be retried.
  - Run mode does not start without a folder scope, and a file at the drive root cannot use Run.
  - A document that fails to assemble is never rendered raw.
  - Token signing keys are separate per purpose. A rejected scope token is re-minted once.
  - The local runner's child environment holds only the variables it lists.
- **BREAKING** (internal): archived drives refuse the mounts write routes. A scope token that the server cannot use now gets 401 `scope_token_invalid` instead of 403 `scope`. Scope tokens issued before the key change are rejected once, and the client mints new ones.

## Capabilities

### New Capabilities

- `agent-app-sharing`: How an owner shares an app, which apps can be shared, updates, visibility, stopping, and how a share follows the session lifecycle.
- `shared-app-viewer`: Who can open a share link, what the viewer page shows, and how a shared app is isolated from the network and from Agenta credentials.
- `session-drive-lifecycle`: What an archived or deleted session drive allows, and what storage remains after a session is deleted.
- `agent-app-run-isolation`: When Run mode may start, how a rejected scope token recovers, what the page renders when an app document cannot be built, and what environment agent processes get.

### Modified Capabilities

None. No existing specification covers apps or drives.

## Impact

- API: `api/oss/src/core/mounts/` (archive checks, delete order, share settings in `mounts.data`), `api/oss/src/core/apps/` (share service, share token, key derivation), `api/oss/src/apis/fastapi/mounts/router.py` (owner routes), a new public router at `/shared/apps/`, `api/oss/src/middlewares/auth.py` (`_PUBLIC_ENDPOINTS`), `api/oss/src/core/store/storage.py` (delete failures), `api/oss/src/core/apps/scope_token.py` (two scope errors).
- No database migration and no new table. `mounts.data` gets a `shares` field that API responses leave out.
- Object store: a new prefix `[<ns>/]shares/<project_id>/<mount_id>/`.
- Runner: `services/runner/src/engines/sandbox_agent/daemon.ts` (child environment equals the allowlist).
- Frontend: `@agenta/entities` and `@agenta/entity-ui` (share dialog, snapshot runtime, strict policy, one inlining path for local and captured files, scope token re-mint), `@agenta/shared` (mobile gate), `web/mobile` (share page, auth gate and analytics exemptions, sign-in return path). The desktop drive gets the Share button through `@agenta/entity-ui` with no desktop code change.
- The Fern TypeScript client is regenerated for the new routes.
- CORS settings stay as they are.
