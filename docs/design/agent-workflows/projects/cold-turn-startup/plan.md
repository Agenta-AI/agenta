# Plan

The plan ships Fix A in stages that each stand alone, then treats Fix B as a measured
follow-up. Each stage names the change, the files it touches, and how to prove it worked.

Terms used here are defined in `README.md`. Read `research.md` first; several stages depend on
a runtime fact that static reading could not settle (which adapter copy runs), and that fact is
the first task.

## Stage 0: confirm which adapter copy runs (blocks the patch stages)

Before choosing where to remove `buildUpdateNotice`, confirm at runtime whether the running
`pi-acp` is the runner's `0.0.29` copy (reachable via the "PATH binary hint") or the CLI's
self-installed `0.0.31` copy under `~/.local/share/sandbox-agent`.

- How: start a cold local run and observe which file executes. Options, in order of directness:
  add a temporary marker line to each candidate `dist/index.js` and see which appears; or run
  the sandbox-agent CLI with its adapter-resolution logging enabled
  (`SANDBOX_AGENT_LOG_STDOUT` and related, seen in the binary strings) and read which branch it
  reports; or `strace`/`lsof` the adapter child process to see which `index.js` path it opened.
- Output: a one-line answer recorded in `status.md`, plus the exact path of the running copy.
- Why it blocks: Stage 2's patch target and Stage 4's Daytona approach both depend on this.

## Stage 1: turn on `quietStartup` (no patch, removes one probe)

Remove the `buildStartupInfo` probe (about 440 ms) by writing `{"quietStartup": true}` into the
Pi agent settings file the runner controls.

- Change: ensure the settings file at `PI_CODING_AGENT_DIR/settings.json` carries
  `quietStartup: true`. The runner already copies `settings.json` when it seeds a per-run agent
  dir (`services/runner/src/engines/sandbox_agent/pi-assets.ts`, `prepareLocalAgentDir` copies
  `auth.json` and `settings.json`; the Daytona path uploads `settings.json` in
  `daytona.ts` `uploadPiAuthToSandbox`). The cleanest point is to write or merge the flag when
  the runner prepares the agent dir, so it applies to local and Daytona without depending on the
  developer's own `~/.pi/agent/settings.json`.
- Design note: this is a configuration value the runner owns, not user data. Merge it into the
  settings object rather than overwriting the file, so a developer's other Pi settings survive.
- Test: a runner unit test that runs the agent-dir preparation and asserts the resulting
  `settings.json` parses to an object with `quietStartup === true`. Add it beside the existing
  `pi-assets` tests.
- Verify live: cold local run; confirm the reply no longer contains the `pi v...` / `Context`
  banner and that one of the two `pi --version` child processes is gone (process trace or the
  cold-turn timing dropping by roughly 440 ms).
- Independence: this stage is safe and useful even if Stage 2 is deferred.

## Stage 2: remove the unconditional `buildUpdateNotice` probe

Remove the remaining `pi --version` plus `npm view` (about 670 to 720 ms). This needs a code
change to the adapter, because `research.md` showed there is no environment gate for it.

Choose the mechanism by Stage 0's answer:

- If the running local copy is the runner's `0.0.29`: add a pnpm patch under
  `services/runner/patches/` for `pi-acp@0.0.29`, alongside the existing
  `sandbox-agent@0.4.2.patch`, and add the `patchedDependencies` entry. The patch's content
  should be the smallest safe edit: make `buildUpdateNotice` return `null` without spawning any
  child process, or read the installed version from the adapter's own `package.json` instead of
  spawning `pi --version` and skip the `npm view` entirely. Returning `null` is simplest and
  loses only an upgrade hint the runner already deletes.
- If the running local copy is the CLI's self-installed `0.0.31`: a runner pnpm patch will not
  reach it. Prefer fixing this upstream in the `pi-acp` source (gate `buildUpdateNotice` behind
  an environment variable, or drop the `npm view` network call and read the version locally),
  then pin the CLI to that version. If an upstream fix is not available in this project's
  timeframe, the fallback is to force the CLI to resolve an adapter the runner controls (via the
  PATH binary hint or a pinned local launcher) and patch that copy. Record the chosen path in
  `status.md` with its reasoning.

- Test: if a pnpm patch is used, a runner test that imports or executes the patched
  `buildUpdateNotice` equivalent and asserts it performs no child-process spawn and returns
  empty. If the fix is upstream, the regression guard is the cold-turn timing test in Stage 5.
- Design note: prefer removing the network `npm view` call over merely caching it. A cached
  result still costs the first cold turn and still reaches npm from a sandbox.

## Stage 3: retire or shrink the banner-stripping in `otel.ts`

The stripping in `services/runner/src/tracing/otel.ts` exists only to clean up the probe
output.

- After Stage 1 only (update notice still emitted): narrow `isBannerLine` /
  `stripStartupBanner` to match just the "New version available" and "Run: npm i" lines, since
  the `pi v...` / `Context` / `Skills` banner no longer appears. Keep the streaming variant in
  step.
- After Stage 2 (no probes emit any banner): remove the stripping entirely, including its unit
  tests, since there is nothing left to strip. Confirm by reading a cold-turn reply and seeing
  no banner lines before the stripping is removed, so the removal is provably safe.
- Test: update the existing `otel` unit tests to match whichever state ships. Do not leave
  dead matchers behind.

## Stage 4: make Fix A reach Daytona

Local removal does not fix the in-sandbox adapter copy (`research.md`, "How the adapter reaches
a Daytona sandbox"). Depending on Stage 2's mechanism:

- If Stage 2 is an upstream `pi-acp` fix plus a version pin: ensure the in-sandbox CLI resolves
  the pinned, fixed version. Confirm the Daytona snapshot or the in-sandbox install path picks
  it up.
- If Stage 2 is a local patch only: bake a fixed adapter into the Daytona snapshot, or set the
  in-sandbox CLI to resolve a runner-controlled adapter, so the sandbox copy is also fixed. The
  `npm view` from a European sandbox is the worst single instance of this cost, so the sandbox
  copy is the higher-value target even though it is harder to reach.
- Test: a Daytona cold run with the timing captured, compared against the same run before the
  change. Record both numbers in `status.md`.

## Stage 5: cold-turn timing regression guard

Add one test that captures cold-turn startup time (or the count of `pi --version` / `npm view`
child processes spawned during a cold session start) so a future dependency bump that
reintroduces the probes is caught. This is the durable guard, especially where Stage 2's fix is
upstream and has no unit-testable surface in this repository.

## Fix B: follow-up, not part of the Fix A ship

`research.md` concludes Fix B is genuinely complicated. Do not block Fix A on it. Carry it as a
separate investigation with these first steps:

1. Measure the timing window between session cold-start begin and workspace materialization, to
   learn whether the "overlap the mount with the harness cold start" variant can hide 0.55
   seconds. This answers `open-questions.md` question 3 with a number.
2. If overlap captures most of the saving with no shadowing risk, prefer it: start
   `mountLocalDurableCwd` as a background promise, keep `prepareWorkspace` and `createSession`
   waiting on it, and only overlap it with the pre-workspace part of the cold start. This never
   defers past the point where files must persist, so it needs no copy-up machinery.
3. Only if overlap does not pay off, scope the full lazy-mount design (mount on first file
   tool, plus copy-up of local writes and a working-directory view refresh). Treat that as its
   own plan.

Recommendation: ship Stages 0 through 5 (Fix A) and defer Fix B to the follow-up above. The
brief explicitly allows dropping Fix B.
