
## Bridge

The page gets `window.agenta`: `await agenta.ready` first; then `canWrite`, `visible`, `dir`,
and `agenta.fs` with `read`, `readJSON`, `write`, `writeJSON`, `list`, `exists`, `stat`,
`remove`. Paths are relative to `index.html` and cannot leave the folder. Events:
`agenta.addEventListener("changed", cb)` when a file changes underneath the app, `"access"`
when `canWrite` changes, and `"visibilitychange"`. Failures reject with `error.code`:
`not_found`, `read_only`, `scope`, `conflict`, `too_large`, `bad_request`, `unavailable`.
Writes carry If-Match automatically.
