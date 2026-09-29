# Tasks

Groups 1 to 3 are the prerequisite PR. Groups 4 to 8 are the sharing PR.

## 1. Session drive lifecycle

- [x] 1.1 Add a required `access: Literal["read", "write", "lifecycle"]` keyword to `_resolve_mount` with no default, and a `MountArchived` error mapped to HTTP in the mounts router. Classify each of the 15 callers as the access table in `design.md` shows, and refuse `write` on a drive with `deleted_at` set. Verify with API tests that on an archived drive, list, read, stat, export, attachment originals, and a `read` scope mint still work; that write, create folder, delete, upload, `/sign`, and a `read-write` scope mint are refused; and that unarchive restores writes.
- [x] 1.2 Stop `upsert_mount` from clearing `deleted_at`, and make `get_or_create_session_mount` raise `MountArchived` for an archived drive; verify with API tests that a session sign call and `create_app` on an archived session are refused and leave the drive archived.
- [x] 1.3 Make `delete_keys` return failed keys and `delete_prefix` raise when any key fails; verify with a unit test that uses a store stub that fails one key.
- [x] 1.4 Reorder `delete_session_mounts` to remove prefixes before rows; verify with a unit test that a failed prefix removal keeps the rows and a second delete removes the rest.

## 2. Signing keys and scope errors

- [x] 2.1 Add a per-purpose key helper (`HMAC-SHA256(sha256(crypt_key), label)`) and `is_default_crypt_key()` in `api/oss/src/utils/`, and log an error at startup when the key is the default; verify with unit tests for distinct labels and the default check.
- [x] 2.2 Split `ScopeTokenInvalid` (token unusable) from a new `ScopeDenied` (request outside the grant) in `api/oss/src/core/apps/scope_token.py`: `parse` raises the first, `enforce` raises the second. Map them in the mounts router to 403 `scope_token_invalid` and 403 `scope` (never 401, which makes the SuperTokens interceptor refresh the session). Verify with unit and API tests for a bad signature, an expired token, a path outside the folder, and a write on a `read` grant.
- [x] 2.3 Sign scope tokens with the `agenta/app-scope/v1` key; verify that the scope token tests pass and that a token signed with the old key gets `scope_token_invalid`.

## 3. Run isolation

- [x] 3.1 In `scopeToken.ts` and the host's client, on `scope_token_invalid` evict the cached token, mint once, and retry the call once; on `scope` do not retry; when minting fails, fail closed, so Run shows an error and makes no file call. Verify with package unit tests for a rejected cached token that heals on retry, a second rejection that fails closed, a `scope` denial with no retry, and a failed mint.
- [ ] 3.2 Hide Run for an HTML file at the drive root; verify with a package unit test on `HtmlAppBody` that Run is not offered and Preview renders.
- [x] 3.3 Make `assemblePreview` and `assembleRunDocument` return an error document under the content policy on failure; verify with unit tests that throw from `AssembleIo` and assert the result has the policy and none of the input scripts.
- [x] 3.4 In `buildDaemonEnv` (`services/runner/src/engines/sandbox_agent/daemon.ts`), set to `""` every key in `process.env` that the function did not set, and add `TMPDIR`, `LANG`, `LC_ALL`, `TZ`, `USER`, `SHELL`, and `TERM` to what it copies. Verify with a runner unit test that, with `AGENTA_API_KEY`, `AGENTA_RUNNER_TOKEN`, and an unrelated provider key in `process.env`, the merged result `{...process.env, ...env}` has each of them empty and keeps the allowlisted keys.
- [x] 3.5 Update `docs/design/agent-html-apps/contracts.md` and `specs.md` for fail-closed scope, the two scope errors, root-level files, and the error document; verify the text matches the tests.

## 4. Share data and token

- [x] 4.1 Add `AppShare` and `MountData.shares` with `exclude=True`; verify with a unit test that a drive response has no `shares` and that a stored entry survives a read.
- [ ] 4.2 Add the locked DAO method that updates one share entry; verify with a Postgres test that two concurrent updates both land.
- [x] 4.3 Add `api/oss/src/core/apps/share_token.py` (mint, parse, refuse on the default key) using the `agenta/app-share/v1` key; verify with unit tests for a valid token, a tampered token, a scope token passed as a share token, a wrong nonce, and the default key.

## 5. Publishing

- [x] 5.1 Add the share service with publish: drive and session checks, manifest validation, file listing that skips nested apps, the snapshot budget, blob and manifest writes, pointer move; verify with API tests for a session drive, an agent drive, a standalone drive, a folder with no manifest, the drive root, and an app over the limits.
- [x] 5.2 Add the reference graph walk from the rules table in `design.md`. It records `refs` for every HTML and CSS entry, resolves CSS references against the stylesheet's own base, and fetches `https:` URLs through `open_egress` with up to 3 redirect hops, each checked again, to a depth of 3, inside the shared budget. Verify with unit tests for HTML and CSS reference discovery, a Google Fonts stylesheet whose font files are captured, a CDN stylesheet with relative `url()`, a redirect to a public address, a redirect to a private address, a private address, a URL over 5 MB, a graph over 30 URLs, captured bytes that exceed 25 MB in total, and a module script with a URL import that gives `module_imports_not_captured`.
- [x] 5.3 Add edit, stop, and share again (new nonce); verify with API tests that the link stays the same on edit, fails after stop, and that the old link still fails after share again.
- [x] 5.4 Remove `[<ns>/]shares/<project_id>/<mount_id>/` in `delete_session_mounts`; verify with an API test that a deleted session leaves no share objects.

## 6. API routes

- [ ] 6.1 Add the five owner routes to the mounts router with `EDIT_MOUNTS` and `is_interactive_session` on writes; verify with API tests using the fixtures in `api/oss/tests/pytest/utils/accounts.py` that an editor session succeeds and an API key, the agent `Secret` token, and a viewer role are refused.
- [ ] 6.2 Add the public router at `/shared/apps/` with the one `fetch_shared_app` route, register it in `api/entrypoints/routers.py`, and add `"/shared/apps/"` to `_PUBLIC_ENDPOINTS`; verify with API tests for every row of the access check in `design.md`, including a member of another workspace and an archived session.
- [ ] 6.3 Stream the response body blob by blob and set its headers; verify with an API test that asserts each header and that a snapshot's content round-trips, and with a unit test that the route reads one blob at a time.
- [ ] 6.4 Run `ruff format` and `ruff check --fix` in `api/`, then `cd api && py-run-tests`; verify both pass.
- [x] 6.5 Regenerate the TypeScript client with `bash ./clients/scripts/generate.sh --language typescript` and rebuild `@agentaai/api-client`; verify the new operations appear in the generated client.

## 7. Frontend packages

- [ ] 7.1 Add `SHARE_CSP` and a `csp` option on `buildRunFrame` in `@agenta/entities`; verify with a unit test that the assembled shared document carries `SHARE_CSP` and the owner's Run still carries `RUN_CSP`.
- [x] 7.2 In `assemble.ts` (`@agenta/entity-ui`), add the optional `AssembleIo.resolve(base, ref)` and make the inliner handle a reference by its kind: script to script text, stylesheet to `<style>` with its `url()` and `@import` inlined against its own base, image or font to a `data:` URI. Verify with unit tests that Preview and Run keep leaving `https:` references alone, that a relative `url()` in a local stylesheet is now inlined, and that with `resolve` a captured script and stylesheet become inline text and a captured font becomes a `data:` URI.
- [x] 7.3 Add the read-only snapshot `FsClient`, the snapshot `AssembleIo` that answers `resolve` from `refs` and content from the response, and the share API call with zod validation, in `@agenta/entities`; verify with unit tests that reads come from the snapshot, writes return `read_only`, and a reference with no `refs` entry is removed and reported.
- [ ] 7.4 Add `ShareAppButton` and `ShareAppDialog` in `@agenta/entity-ui` (visibility, copy link, update share, stop sharing, the session-delete note, failed external files, and warnings), shown only for session drives and `EDIT_MOUNTS`; verify with component tests and a Storybook story.
- [ ] 7.5 Add `SharedAppView` in `@agenta/entity-ui` that renders `RunView` from a snapshot and shows an error state on any build failure; verify with a unit test.
- [ ] 7.6 Run `pnpm lint-fix` in `web/`; verify it passes.

## 8. Share page

- [ ] 8.1 Add `web/mobile/src/pages/share/[token].tsx` and `web/mobile/src/features/share/` with the header variants from the viewer spec; verify with unit tests for the anonymous, member, project member, and editor headers.
- [x] 8.2 Exempt `/share/` from `AuthGate` and `authRedirectTarget`, from `decideMobileGate`, and from PostHog; verify with unit tests for each and a test that classic mode does not redirect.
- [x] 8.3 Add `rememberReturnPath` and `takeReturnPath` to `web/mobile/src/lib/context.ts`, built like the template key store. Call `rememberReturnPath` from `AuthGate` on a redirect to `/auth` and from the share page before sign-in, and make `useAuthSuccess` go to the kept path. Verify with unit tests that an internal path is kept and used once, that `//evil`, an absolute URL, and an `/auth` path are refused, that an expired path falls back to `/`, and that the template key flow is unchanged.
- [x] 8.4 Refuse on `/shared/apps/` with 403 and a `code`, never 401, so the SuperTokens interceptor does not try a refresh for a viewer with no cookies; record the decision in `design.md`.
- [x] 8.5 Update `docs/design/agent-html-apps/contracts.md` with the share route, `SHARE_CSP`, and the reference rules; verify the route, policy, and rules text match the code.

## 9. Integration check

- [ ] 9.1 In the local stack (OSS and EE), share an app that loads a CDN script and a Google Fonts stylesheet, open it signed out as `link` with the network panel open, sign in through an OAuth provider from a `workspace` share and land back on it, open it as a member of another workspace, update the share, archive the session and check that its history still shows attachments while the link fails, unarchive, stop sharing, and delete the session. Verify each outcome matches the specs, that the shared app makes no network request, and that no object remains under `shares/` after the delete.
- [ ] 9.2 Run one local session with each harness after the runner environment change; verify each one starts and completes a turn.
- [ ] 9.3 Test whether `<link rel="prerender">` sends a request from a shared app in Chrome; record the result in `design.md`.
- [ ] 9.4 Run `openspec validate share-agent-html-apps --strict`; verify it passes.
