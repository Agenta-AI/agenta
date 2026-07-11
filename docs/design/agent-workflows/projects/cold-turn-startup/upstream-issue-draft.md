# Draft upstream issue for svkozak/pi-acp

File this at https://github.com/svkozak/pi-acp/issues as part of plan Stage 2b. Adjust the
version numbers if a release has happened since. Related existing issue to cross-reference:
#70 (the update-check notice arriving after the turn ends).

---

Title: Startup version probes add ~1.2-1.6s to every session/new; no way to disable the update check

## Summary

`session/new` is blocked by three synchronous child processes before it returns:

- `buildUpdateNotice()` runs `spawnSync("pi", ["--version"])` and then
  `spawnSync("npm", ["view", "@earendil-works/pi-coding-agent", "version"], { timeout: 800 })`,
  unconditionally.
- `buildStartupInfo()` runs `spawnSync("pi", ["--version"])` again, unless `quietStartup` is
  set.

Measured on our hosts (pi-acp 0.0.31, pi 0.80.6): each `pi --version` is ~440-750 ms (a full
Node boot plus the Pi bundle import), and `npm view` is ~230-305 ms over the network. Together
they add ~1.2 s (with `quietStartup: true`) to ~1.6 s (default) of latency to every new
session, serialized before the first prompt can be answered. In network-restricted or
high-latency environments (we run pi-acp inside sandboxes) the `npm view` call is also an
unexpected outbound network dependency at session start.

`quietStartup` cannot remove this: as the README notes, the update notice is still emitted
when `quietStartup` is enabled, so `buildUpdateNotice` and its two spawns always run.

## Proposal

Any of these would solve it; happy to send a PR for whichever you prefer:

1. A setting such as `checkForUpdates: false` (next to `quietStartup`) that skips
   `buildUpdateNotice` entirely.
2. Fold the update check under `quietStartup`, so quiet means fully quiet.
3. Make the check non-blocking and cheap: read the installed version from the pi package's own
   `package.json` instead of spawning `pi --version`, and run the `npm view` asynchronously
   after `session/new` returns rather than blocking it. (Note #70 shows the async notice then
   needs to be delivered in-turn, so options 1 or 2 are simpler.)

## Environment

- pi-acp: 0.0.31
- pi (@earendil-works/pi-coding-agent): 0.80.6
- Client: sandbox-agent (ACP)
