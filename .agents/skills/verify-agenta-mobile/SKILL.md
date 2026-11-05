---
name: verify-agenta-mobile
description: Drive the real Agenta web app (web/mobile, served at localhost:3000/m on the local EE stack) in a browser and capture proof. Use before calling a frontend change done, when a feature needs a before and after, or when a session, revision, or config pane behavior must be proven in the running app.
---

# Verify the Agenta app

The surface is the browser app at `http://localhost:3000/m`. `web/oss` is abandoned, so never run or drive it. The API, Postgres and the runner run in the local docker-compose stack.

## Launch

Most of the time both parts are already up. Run Doctor first and start only what is missing.

- Stack, from the repo root: `load-env hosting/docker-compose/ee/.env.ee.dev`, then `bash ./hosting/docker-compose/run.sh --ee --dev --build`. The API answers `200` on `http://localhost/api/health` when ready. `run.sh` stops every running service first, so use it only when the whole stack is down. If part of the stack is up, other agents may be using it: stop and report what is missing.
- App, from `web/`: `pnpm dev-mobile`. Ready when `http://localhost:3000/m` answers. New `NEXT_PUBLIC_*` flags go by hand into the gitignored `web/mobile/public/__env.js`.

There is one shared instance. Other agents may hot-reload the same dev server, and `uvicorn --reload` restarts the API when anyone edits `api/`. Two runs cannot be isolated by port without a second stack, so do not change shared stack state.

## Doctor

`.agents/skills/verify-agenta-mobile/scripts/doctor.sh`

It is read-only. It reports the web and API status, the folder the dev server runs from, and recent membership 401s. Run it first and again whenever the page misbehaves.

## Drive

Use Claude in Chrome. The app's in-window browser pane counts as hidden when not displayed, and the version watcher skips hidden pages, so a hidden pane gives false results.

1. Find the signed-in user. A page that shows `Select project` or a full-page `Failed to fetch` overlay usually means the session's user is not a member of the project in the URL. The API log line says `stage=membership reason=project_member`.
2. Pick data: `.agents/skills/verify-agenta-mobile/scripts/pick-fixture.sh <user-email>`. Use an agent nobody depends on, with two or more sessions.
3. Open `http://localhost:3000/m/w/<workspace>/p/<project>/sessions/<session>`. The app corrects a wrong workspace id itself.
4. Wait until the config pane shows the `AGENTS.md` word count. After a cold load this can take over 20 seconds. Only then set `window.__verifyConfig = {agentId, sessionA, sessionB}` and paste `scripts/page-helpers.js` with the JavaScript action. A full reload removes the helpers and the in-memory revision pins.

Helpers on `window.__v`: `go(sessionId)` for a client-side switch, `commitElsewhere(message)` for a version made outside this session, `restore()`, `words()`, `pill()`, `stopVisible()`, `recheck()` for the check that a tab return runs, and `simulateRunning(true|false)`.

Stable handles: the `Version N, Saved. Open version history` aria-label, the button text `Update to vN`, the `Stop` button, and the `AGENTS.md N words` row. `words()` is the cheapest proof of which revision a session shows.

Read the matching file in `features/` before driving.

## Evidence

Save images to `<scratchpad>/pr-images/` as `before-<what>.png` and `after-<what>.png`, from the same screen, data and theme. Convert a saved JPEG with `sips -s format png`.

- Drive the user path. Change state through the app or through the same API another client would use.
- Capture the state before the action, and the state after it. A check that starts from an unrendered page proves nothing: `words()` must be a number before you leave a session.
- Check the side effect too, such as the version the server now reports.
- `simulateRunning` rewrites one liveness response in this page only. Say so when a proof uses it. The `Stop` button must be visible or the simulation did not take.
- A content-identical commit makes no new version. The server returns the old one.

## Cleanup

- Call `__v.restore()` so the agent's latest config matches where it started. Versions stay in the history. Report how many you added.
- Close the tabs you opened. Reloading removes the helpers.
- Stop only processes you started. Leave a shared dev server or stack running.
- Keep `<scratchpad>/pr-images/`. Cleanup never removes proof.
