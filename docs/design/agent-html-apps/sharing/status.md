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
| Snapshot limits | 200 files, 5 MB per file, 25 MB per version, 30 external URLs, 5 MB per external file. Checked on the server. |
| CORS | No change. The `*.vercel.app` regex and the localhost entries stay. Known risk: where cookies are `SameSite=None`, a page on any `*.vercel.app` site can read a credentialed response from a `workspace` share route. |

## Open questions

1. **Local runner environment.** It is unproven whether the `sandbox-agent` daemon passes its
   environment to agent processes. Change 1 task 6 starts by confirming it.
2. **SuperTokens refresh on the share page.** It is unproven whether the fetch interceptor
   tries a refresh on a 401 from `/shared/apps/` for a viewer with no cookies. Check during
   change 2 task 10.
