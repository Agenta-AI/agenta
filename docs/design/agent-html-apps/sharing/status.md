# Status

## Current state

Planning is done. No code is written. The next step is change 1 (fix-first) in `plan.md`.

## Decisions

| Decision | Choice |
|---|---|
| What a link shows | A frozen snapshot, not the live folder. |
| Viewer data | Read-only for every viewer. |
| Versions | A new version only on "Update share". The owner can restore an old version. |
| Storage | No new table. Settings in `mounts.data`, snapshots in the object store. |
| Visibility values | `workspace` (signed-in workspace members) and `link` (anyone). |
| Who can share | `EDIT_MOUNTS` and an interactive sign-in session. Not the agent. |
| Controls | Per app: change visibility, stop sharing, share again with a new link. No org or workspace switch. |
| Which apps | Only apps in a session `cwd` mount. |
| Lifetime | Ends when the session is deleted. Pauses while it is archived. |
| Link | `/m/share/<token>`, one shape for both visibilities. |
| Page | Standalone page with a header modeled on the Claude artifact header. No password warning. |
| Network for viewers | Strict CSP with no network. External files are downloaded once at publish time. |
| Order | Fix-first change before the sharing change. |

## Open questions

1. **Snapshot limits.** `design.md` proposes 200 files, 5 MB per file, 25 MB per version,
   30 external URLs, and 5 MB per external file. Confirm or change.
2. **CORS change.** Removing the `*.vercel.app` and localhost entries may break preview
   deployments or local setups that rely on them. The owner of `api/entrypoints/routers.py`
   must confirm before change 1 task 5 ships.
3. **Local runner environment.** It is unproven whether the `sandbox-agent` daemon passes its
   environment to agent processes. Change 1 task 6 starts by confirming it.
4. **SuperTokens refresh on the share page.** It is unproven whether the fetch interceptor
   tries a refresh on a 401 from `/shared/apps/` for a viewer with no cookies. Check during
   change 2 task 10.
