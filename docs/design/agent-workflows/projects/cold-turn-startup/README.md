# Cold-turn startup cost removal

This workspace plans two changes that each remove fixed wall-clock delay from the start of
a "cold" agent turn. Profiling on the live local runner on 2026-07-11 measured both. Together
they add up to roughly two seconds that the user waits before the model even begins to answer.

## Glossary

Read this once. Later files use these terms without re-defining them.

- **Runner**: the Node sidecar under `services/runner/`. It receives a `/run` request and
  drives one agent turn. Written in TypeScript because the agent harnesses are Node libraries.
- **Harness**: the coding-agent program the runner drives (Pi, Claude Code, Codex). This plan
  is about the Pi harness.
- **ACP**: Agent Client Protocol. The JSON-RPC protocol the runner speaks to a harness.
- **Adapter**: a small program that translates ACP on one side into a specific harness's own
  interface on the other. For Pi the adapter is an npm package named `pi-acp`. It spawns the
  real `pi` binary and bridges it to ACP.
- **sandbox-agent**: an npm package plus a compiled command-line binary (`@sandbox-agent/cli`).
  The runner launches this binary; the binary chooses and launches the adapter. The runner
  already ships one hand-written change to this package through pnpm's patch mechanism.
- **Probe**: a short child-process call the adapter runs at session start to gather version
  information (`pi --version`, `npm view ...`). Each probe blocks the turn until it returns.
- **Cold turn**: the first turn of a conversation, or any turn where no warm harness session is
  reused. A cold turn pays full session-startup cost. This plan only concerns cold turns.
- **Session**: one harness conversation. `createSession` opens it; this is where the Pi cold
  start (and the probes) happen.
- **Mount**: attaching a remote object store as if it were a local directory, using a
  user-space filesystem. The runner mounts the caller's durable working directory this way so
  files the agent writes persist across turns.
- **geesefs / FUSE**: geesefs is the program that performs the mount. FUSE ("filesystem in
  user space") is the Linux mechanism it uses. A FUSE mount placed over an existing directory
  hides whatever that directory already contained.
- **cwd**: the working directory a harness session runs in. The runner sets it to the mounted
  durable directory.
- **Daytona**: the remote sandbox provider. When a run is remote, the harness runs inside a
  Daytona sandbox instead of on the runner host.
- **Patch (pnpm)**: a stored diff pnpm re-applies to a dependency's files on every install. The
  runner keeps these under `services/runner/patches/`. A patch only affects the copy of the
  package inside the runner's own `node_modules`.

## The two changes

- **Fix A, remove the Pi startup probes.** The Pi adapter runs three version probes at every
  cold session start, serialized before the first model request. They cost about 1.6 seconds
  and add nothing the user asked for. The change removes them. This is the higher-value and
  better-understood change.
- **Fix B, stop paying for the durable mount on chat-only turns.** The runner mounts the
  durable working directory before it opens the session, even for a turn that never touches a
  file. The mount costs about 0.55 to 0.6 seconds. The change avoids that cost when no file is
  used. Research below shows this is genuinely harder than it looks; the plan recommends
  shipping Fix A first and treating Fix B as a follow-up.

## Reading order

1. `context.md` answers: what does the user experience today, and why does it happen.
2. `research.md` answers: exactly what the code does now, with file and line references, and
   which facts changed the plan. Read this before proposing any edit.
3. `plan.md` answers: what to change, in what order, and how to test each step.
4. `open-questions.md` answers: what must be confirmed at runtime before or during the work,
   because static reading of the code could not settle it.
5. `upstream-issue-draft.md` is the ready-to-file text for the upstream `pi-acp` issue asking
   for a switch that disables the update-check probes (plan Stage 2b).
6. `status.md` tracks progress and decisions. It is the running source of truth.
