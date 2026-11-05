# Session version update

A session moves to the agent's newer version on its own when nothing can be lost. When something must wait, the `Update to vN` pill stays, and the update applies once the wait ends.

## Sub-features

- `update-auto` moves the session with no click on a switch, a tab return, or a history drawer open.
- `update-held-running` waits for this session's running turn.
- `update-held-unsaved` waits for a draft, a save in flight, or a failed save.
- `update-manual` is the pill's click, used while an update is held.
- `update-leaf-bound` leaves a session bound to a variant or revision where it is.

## How to get to it (user POV)

- Change the agent from one session, then open an older session of the same agent.
- Change the agent elsewhere, then return to the browser tab.

## Driving it with Claude in Chrome

Preconditions: the baseline, with both sessions on the same agent.

- **Auto.** Read `__v.words()` on session A. Run `await __v.go(__v.sessionB)`, `await __v.commitElsewhere("check")`, then `await __v.go(__v.sessionA)`. Poll every 150 ms. The word count rises and `__v.pill()` stays null at every sample.
- **Held by a running turn.** Run `await __v.simulateRunning(true)`, wait 11 seconds, run `__v.recheck()`, and confirm `__v.stopVisible()`. Repeat the Auto steps. The pill shows and the word count holds.
- **Release.** Run `await __v.simulateRunning(false)`. Within about 15 seconds the pill goes, and the word count rises a moment later.
- **Cross-agent.** While held, `__v.go` to a session of another agent. That session keeps its own word count and shows no pill. Return to session A after the release, and it holds the newer version.
- **Proof.** Screenshot session A after each step. Restore with `await __v.restore()`.

## Gotchas

- `update-held-unsaved` is covered by `web/mobile/tests/unit/agentRevisionAutoUpdate.render.test.tsx`. Page-level blocks do not stop the save, because it does not pass through `window.fetch` or the page's patched XHR.
- A session that never pinned lands on the latest anyway, so that run proves nothing. See the rule on `words()`.
- Liveness polls slowly for idle sessions and has a 10 second stale time, so `recheck()` too soon does nothing.
- `update-leaf-bound` needs a session whose row has no workflow reference. Only a trigger written through the SDK makes one.
- The version check runs only while the page is visible, and it swallows a failed read. A miss looks like nothing happening: no pill and no update. Check `document.visibilityState` and the API, because `uvicorn --reload` restarts it when anyone edits `api/`. The next check recovers.
