
## Bridge

The page gets `window.agenta`: `await agenta.ready` first; then `canWrite`, `visible`, `dir`,
and `agenta.fs` with `read`, `readJSON`, `write`, `writeJSON`, `list`, `exists`, `stat`,
`remove`. Paths are relative to `index.html` and cannot leave the folder. Events:
`agenta.addEventListener("changed", cb)` when you or the person edit a file underneath the app,
and `"visibilitychange"`. Failures reject with `error.code`: `not_found`, `read_only`, `scope`,
`conflict`, `too_large`, `bad_request`, `unavailable`. Writes carry If-Match automatically: on
`conflict`, re-read the file and reapply the change once.
