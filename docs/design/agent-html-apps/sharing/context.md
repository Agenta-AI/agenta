# Context

## What people can do today

An agent can build an HTML app in a session. The owner opens it in the session drive and runs
it. Nobody outside the project can see it. There is no link, no public page, and no share
button. The only "share" in the product copies a deep link to a session, and that link needs
sign-in and project membership (`web/packages/agenta-sessions/src/link/sessionDeepLink.ts`).

## Goal

After the agent makes an app, the owner can share it:

- with **workspace members**, who must sign in, or
- with **anyone who has the link**, with no sign-in.

The viewer opens the link and uses the app on a standalone page, like a Claude artifact.

## Requirements

1. **Visibility.** Two values: `workspace` (the viewer is signed in and is a member of the
   app's workspace) and `link` (anyone).
2. **Who can share.** A person with `EDIT_MOUNTS` on the project, in an interactive sign-in
   session. The agent cannot create, change, or stop a share.
3. **What viewers see.** A snapshot of the app folder, data files included, taken when the
   owner shares. Viewers cannot write. The owner's drive files never change because of a
   viewer.
4. **Versions.** Only "Update share" makes a new version. The link shows the latest version.
   `?v=N` shows version N. The owner sees the version list and can restore an old version,
   which makes it the next version.
5. **Controls for each app.** Change visibility (the link stays the same). Stop sharing (the
   link stops at once). Share again (a new link; the old link stays dead).
6. **Bound to the session.** Only apps in a session mount can be shared. Deleting the session
   ends the share. Archiving the session pauses the share until it is unarchived.
7. **No new table.** Share settings live in `mounts.data`. Snapshot files live in the object
   store.
8. **Link and page.** `/m/share/<token>`, one link shape for both visibilities. The page is
   standalone, not the session drive.
9. **Header.** Like the Claude artifact header: logo, app name, "App by <name>", and buttons
   that depend on who views (see `design.md`).
10. **No network for viewers.** Shared apps run under a strict CSP. On "Update share", the
    server downloads the app's external scripts, styles, and fonts once and stores them in the
    snapshot, so apps that use a CDN still work.
11. **Fix first.** Confirmed bugs that break the security of a public link ship as a separate
    change before the sharing change (see `plan.md`).

## Out of scope

- Comments on shared apps.
- Viewers who write data.
- Sharing apps in the agent mount or in standalone mounts.
- Organization or workspace switches that turn sharing off.
- Link expiry dates.
- A page that lists every shared app in a project.
- Code changes in `web/oss` and `web/ee`. The Share button lives in `@agenta/entity-ui`,
  which the desktop drive also renders, so desktop users get the button with no desktop code.
  The share page lives in `web/mobile`.
