# Tasks

Groups 1 to 3 are the prerequisite PR. Groups 4 to 8 are the sharing PR.

## 1. Session drive lifecycle

- [ ] 1.1 Make `_resolve_mount` refuse drives with `deleted_at` set (new `MountArchived` error, mapped to HTTP in the mounts router), with `allow_archived=True` for archive and unarchive; verify with API tests that every file route, upload, download, export, `/sign`, and `/apps/scope` refuse an archived drive and that unarchive restores access.
- [ ] 1.2 Stop `upsert_mount` from clearing `deleted_at`, and make `get_or_create_session_mount` raise `MountArchived` for an archived drive; verify with API tests that a session sign call and `create_app` on an archived session are refused and leave the drive archived.
- [ ] 1.3 Make `delete_keys` return failed keys and `delete_prefix` raise when any key fails; verify with a unit test that uses a store stub that fails one key.
- [ ] 1.4 Reorder `delete_session_mounts` to remove prefixes before rows; verify with a unit test that a failed prefix removal keeps the rows and a second delete removes the rest.

## 2. Signing keys

- [ ] 2.1 Add a per-purpose key helper (`HMAC-SHA256(sha256(crypt_key), label)`) and `is_default_crypt_key()` in `api/oss/src/utils/`, and log an error at startup when the key is the default; verify with unit tests for distinct labels and the default check.
- [ ] 2.2 Sign scope tokens with the `agenta/app-scope/v1` key; verify that the scope token tests pass and that a token signed with the old key is refused.

## 3. Run isolation

- [ ] 3.1 Make the scope token client fail closed in `scopeToken.ts`, so Run shows an error and makes no file call when minting fails; verify with a package unit test.
- [ ] 3.2 Hide Run for an HTML file at the drive root; verify with a package unit test on `HtmlAppBody` that Run is not offered and Preview renders.
- [ ] 3.3 Make `assemblePreview` and `assembleRunDocument` return an error document under the content policy on failure; verify with unit tests that throw from `AssembleIo` and assert the result has the policy and none of the input scripts.
- [ ] 3.4 Build the local daemon environment from an allowlist in `services/runner/src/engines/sandbox_agent/daemon.ts`; verify with a runner unit test that `AGENTA_API_KEY` and `AGENTA_RUNNER_TOKEN` are absent, and record in `design.md` whether the daemon passed its environment on before the fix.
- [ ] 3.5 Update `docs/design/agent-html-apps/contracts.md` and `specs.md` for fail-closed scope, root-level files, and the error document; verify the text matches the tests.

## 4. Share data and token

- [ ] 4.1 Add `AppShare`, `AppShareVersion`, and `MountData.shares` with `exclude=True`; verify with a unit test that a drive response has no `shares` and that a stored entry survives a read.
- [ ] 4.2 Add the locked DAO method that updates one share entry; verify with a Postgres test that two concurrent updates both land.
- [ ] 4.3 Add `api/oss/src/core/apps/share_token.py` (mint, parse, refuse on the default key) using the `agenta/app-share/v1` key; verify with unit tests for a valid token, a tampered token, a scope token passed as a share token, a wrong nonce, and the default key.

## 5. Publishing

- [ ] 5.1 Add the share service with publish: drive and session checks, manifest validation, file listing that skips nested apps, snapshot limits, blob and manifest writes, pointer move; verify with API tests for a session drive, an agent drive, a standalone drive, a folder with no manifest, the drive root, and an app over the limits.
- [ ] 5.2 Add external file capture through `open_egress`; verify with unit tests for HTML and CSS URL discovery, a private address, a redirect, a URL over 5 MB, and more than 30 URLs.
- [ ] 5.3 Add restore, edit, stop, and share again (new nonce); verify with API tests that the link stays the same on edit, fails after stop, and that the old link still fails after share again.
- [ ] 5.4 Remove `[<ns>/]shares/<project_id>/<mount_id>/` in `delete_session_mounts`; verify with an API test that a deleted session leaves no share objects.

## 6. API routes

- [ ] 6.1 Add the five owner routes to the mounts router with `EDIT_MOUNTS` and `is_interactive_session` on writes; verify with API tests using the fixtures in `api/oss/tests/pytest/utils/accounts.py` that an editor session succeeds and an API key, the agent `Secret` token, and a viewer role are refused.
- [ ] 6.2 Add the public router at `/shared/apps/`, register it in `api/entrypoints/routers.py`, and add `"/shared/apps/"` to `_PUBLIC_ENDPOINTS`; verify with API tests for every row of the access check in `design.md`, including a member of another workspace and an archived session.
- [ ] 6.3 Set the blob response headers; verify with an API test that asserts each header.
- [ ] 6.4 Run `ruff format` and `ruff check --fix` in `api/`, then `cd api && py-run-tests`; verify both pass.
- [ ] 6.5 Regenerate the TypeScript client with `bash ./clients/scripts/generate.sh --language typescript` and rebuild `@agentaai/api-client`; verify the new operations appear in the generated client.

## 7. Frontend packages

- [ ] 7.1 Add `SHARE_CSP` and a `csp` option on `buildRunFrame` in `@agenta/entities`; verify with a unit test that the assembled shared document carries `SHARE_CSP` and the owner's Run still carries `RUN_CSP`.
- [ ] 7.2 Add the read-only snapshot `FsClient` and the share API calls with zod validation in `@agenta/entities`; verify with unit tests that reads come from the map, writes return `read_only`, and captured URLs become `data:` URIs.
- [ ] 7.3 Add `ShareAppButton` and `ShareAppDialog` in `@agenta/entity-ui` (visibility, copy link, update share, versions with restore, stop sharing, the session-delete note, failed external files), shown only for session drives and `EDIT_MOUNTS`; verify with component tests and a Storybook story.
- [ ] 7.4 Add `SharedAppView` in `@agenta/entity-ui` that renders `RunView` from a snapshot and shows an error state on any build failure; verify with a unit test.
- [ ] 7.5 Run `pnpm lint-fix` in `web/`; verify it passes.

## 8. Share page

- [ ] 8.1 Add `web/mobile/src/pages/share/[token].tsx` and `web/mobile/src/features/share/` with the header variants from the viewer spec; verify with unit tests for the anonymous, member, project member, and editor headers.
- [ ] 8.2 Exempt `/share/` from `AuthGate` and `authRedirectTarget`, from `decideMobileGate`, and from PostHog; verify with unit tests for each and a test that classic mode does not redirect.
- [ ] 8.3 Let sign-in return to a `next` path limited to `/share/...` in `useAuthSuccess`; verify with a unit test that `/share/x` is honored and any other path falls back to `/`.
- [ ] 8.4 Check whether the SuperTokens interceptor refreshes on a 401 from `/shared/apps/` for a viewer with no cookies, and bypass it on the share page if it does; record the result in `design.md`.
- [ ] 8.5 Update `docs/design/agent-html-apps/contracts.md` with the share routes and `SHARE_CSP`; verify the routes and policy text match the code.

## 9. Integration check

- [ ] 9.1 In the local stack (OSS and EE), share the board starter app, open it signed out as `link`, open it as a member of another workspace as `workspace`, update and restore a version, archive and unarchive the session, stop sharing, and delete the session; verify each outcome matches the specs and that no object remains under `shares/` after the delete.
- [ ] 9.2 Test whether `<link rel="prerender">` sends a request from a shared app in Chrome; record the result in `design.md`.
- [ ] 9.3 Run `openspec validate share-agent-html-apps --strict`; verify it passes.
