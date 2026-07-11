# Research

Every claim here was read out of the code on 2026-07-11. File paths are absolute-from-repo-root.
Line numbers are from the working tree that day and may drift; the surrounding code is quoted
so the reader can re-find it.

## Fix A: the Pi adapter startup probes

### What the probes are and where they run

The Pi adapter is the npm package `pi-acp`. At the moment a session opens, inside the adapter's
"new session" handler, it builds two pieces of startup text and both call child processes:

`node_modules/.pnpm/pi-acp@0.0.29/node_modules/pi-acp/dist/index.js` around line 1761:

```
const quietStartup = getQuietStartup(params.cwd);
const updateNotice = buildUpdateNotice();
const preludeText = quietStartup ? (updateNotice ? updateNotice + "\n" : "")
                                 : buildStartupInfo({ cwd, fileCommands, updateNotice });
```

`buildUpdateNotice` (same file, around line 2550) runs two child processes:

```
const piVersion = spawnSync("pi", ["--version"], { encoding: "utf-8" });
...
const latestRes = spawnSync("npm", ["view", "@earendil-works/pi-coding-agent", "version"],
                            { encoding: "utf-8", timeout: 800 });
```

`buildStartupInfo` (around line 2570) runs a third child process:

```
const piVersion = spawnSync("pi", ["--version"], { encoding: "utf-8" });
```

So a cold session start runs `pi --version` twice and `npm view ... version` once, one after
another, before the session response is returned and before the first model request. The
profiler attributed roughly 440 ms to each `pi --version` (a full Node boot plus the Pi bundle
import) and 230 to 280 ms to `npm view` (a network round trip to the npm registry). The
aggregate measured on the cold path was about 1.6 seconds.

### Only one of the three probes is optional today

`buildUpdateNotice` runs unconditionally. Nothing gates it. `buildStartupInfo` runs only when
`quietStartup` is false. `quietStartup` comes from Pi settings:

`pi-acp/dist/index.js`, `getQuietStartup` (around line 1547) reads it from `getMergedSettings`,
which (around line 1529) merges two files:

```
const globalSettingsPath = join(getAgentDir(), "settings.json");
const projectSettingsPath = resolve(cwd, ".pi", "settings.json");
```

`getAgentDir()` resolves to the environment variable `PI_CODING_AGENT_DIR`, which the runner
sets and controls (`services/runner/src/engines/sandbox_agent/pi-assets.ts` writes into that
dir; `run-plan.ts` line 455 sets `sourcePiAgentDir` to `PI_CODING_AGENT_DIR` or
`~/.pi/agent`). So the runner can turn `quietStartup` on with no patch by writing
`{"quietStartup": true}` into that settings file. That removes the `buildStartupInfo` probe,
one of the two `pi --version` calls, about 440 ms.

Turning `quietStartup` on does NOT remove `buildUpdateNotice`. Its `pi --version` plus
`npm view` still run, about 670 to 720 ms, and that is also the part that reaches npm over the
network from inside a Daytona sandbox. Removing it needs a change to the adapter's own code.

### The adapter copy that runs is not the runner's dependency (most important finding)

The runner declares `pi-acp` as a direct dependency, version `0.0.29`
(`services/runner/package.json` line 34), and pnpm materializes it at
`node_modules/.pnpm/pi-acp@0.0.29/...`. It is natural to assume the runner's existing patch
mechanism (`services/runner/patches/`, wired through `patchedDependencies` in `package.json`)
could patch this copy. That assumption is probably wrong, and this is the single fact that most
shapes Fix A.

The runner does not spawn `pi-acp` itself. It launches the compiled `@sandbox-agent/cli`
binary (`services/runner/src/engines/sandbox_agent/daemon.ts`, `resolveDaemonBinary`). That
binary contains its own "agent manager" that resolves and installs adapters. Reading printable
strings out of the binary
(`node_modules/.pnpm/@sandbox-agent+cli-linux-x64@0.4.2/.../bin/sandbox-agent`) shows an
adapter registry and an npm-install path:

```
SANDBOX_AGENT_ACP_REGISTRY_URL
https://cdn.agentclientprotocol.com/registry/v1/latest/registry.json
agent_manager.install_agent_process_from_registry: npm package installed
"npmPackage": "pi-acp"
```

On this machine the binary has already done that install. It keeps a separate, self-managed
copy of the adapter here:

```
~/.local/share/sandbox-agent/bin/agent_processes/pi/node_modules/pi-acp   (version 0.0.31)
~/.local/share/sandbox-agent/bin/agent_processes/pi/package.json          -> { "pi-acp": "^0.0.31" }
```

So the copy that actually runs the probes is version `0.0.31`, installed by the CLI from the
ACP registry into a directory outside the repository, against a floating `^0.0.31` range. The
runner's patchable `0.0.29` copy is a different file tree. The CLI's resolution order (also
visible in the strings) tries a builtin, then a "PATH binary hint", then a local launcher,
then the registry install. The runner does put its own `pi-acp` on `PATH`
(`daemon.ts` sets `PATH` to include `node_modules/.bin`, which has a `pi-acp` launcher), so it
is possible the "PATH binary hint" wins at run time and the `0.0.29` copy is used after all.
Static reading cannot decide which branch wins. This must be confirmed at runtime before a
patch target is chosen. See `open-questions.md`, question 1.

Consequences either way:

- If PATH resolution wins, a pnpm patch of `pi-acp@0.0.29` fixes the LOCAL path. It still does
  not fix Daytona, because inside the sandbox the CLI installs its own adapter copy from the
  registry (see below), where there is no runner `node_modules` to patch.
- If the registry install wins, the pnpm patch is inert even locally, because the running copy
  lives under `~/.local/share/sandbox-agent` and floats to whatever `^0.0.31` currently
  resolves to.

### How the adapter reaches a Daytona sandbox

Inside a Daytona sandbox the harness runs remotely. The runner installs the `pi` binary into
the sandbox itself (`services/runner/src/engines/sandbox_agent/daytona.ts`, `installPiInSandbox`
runs `npm install @earendil-works/pi-coding-agent@<pinned>` into
`/home/sandbox/.agenta-pi`). The `pi-acp` ADAPTER, however, is resolved by the same
`@sandbox-agent/cli` agent manager running inside the sandbox, which installs it from the ACP
registry the same way it does on the host. So the in-sandbox adapter is also the floating
registry copy, and its `npm view` probe runs from the sandbox's network location. There is no
repository file to patch for the sandbox copy; reaching it means either baking a fixed adapter
into the Daytona snapshot or making the in-sandbox CLI resolve an adapter the runner controls.

### The runner already deletes the probe output

`services/runner/src/tracing/otel.ts` (around lines 735 to 785, `isBannerLine` and
`stripStartupBanner`, plus a streaming variant near line 993) exists solely to remove the
banner and the "New version available" line that these probes produce, because Pi emits them
as the first assistant message chunk. Its own comment (line 753) notes that the "New version
available" notice survives even when `quietStartup` suppresses the rest. This confirms the
gating described above from the consumer side. Once both probes are gone, this stripping code
has nothing left to strip and can be retired. While only `quietStartup` is applied and
`buildUpdateNotice` still runs, the stripping can be narrowed to the two update-notice lines
but not removed.

### `pi-acp` reads no environment gate for the update check

Grepping the adapter for `process.env` shows it reads only `HOME`,
`PI_ACP_ENABLE_EMBEDDED_CONTEXT`, `PI_ACP_PI_COMMAND`, and `PI_CODING_AGENT_DIR`. There is no
`NO_UPDATE_NOTIFIER`-style switch and no environment variable that disables `buildUpdateNotice`.
So there is no environment-only way to remove the unconditional probe. Removing it requires
changing the adapter code (a patch to the running copy, or a fix upstream in the `pi-acp`
source followed by a version bump), or replacing the running adapter with one the runner
controls.

## Fix B: the eager durable mount on chat-only turns

### Where the mount happens and what it costs

`services/runner/src/engines/sandbox_agent.ts`, inside `acquireEnvironment`, mounts the durable
working directory before it opens the session:

```
// line ~1030
// Durable cwd: mount BEFORE createSession (so the session opens inside it) and BEFORE
// workspace materialization (so AGENTS.md, harness files, and skills land in the durable
// prefix instead of being hidden under the FUSE mount).
if (environment.mountCreds && !plan.isDaytona) {
  await mountLocalDurableCwd("initial");   // line ~1034
}
```

`mountLocalDurableCwd` (line ~888) calls `mountStorage`
(`services/runner/src/engines/sandbox_agent/mount.ts` line 288), which spawns `geesefs` in the
foreground and polls up to about 15 seconds for the mount to serve input/output. On the normal
path this resolves in the 0.55 to 0.6 seconds the profiler measured. This is on the critical
path: nothing else in `acquireEnvironment` proceeds until it returns.

### Why the mount is placed before the session, not after

The ordering is deliberate and the code comment states the two reasons. Both are real
dependencies, and both are why "just make it lazy" is not a one-line change.

1. Workspace materialization writes into the mounted directory. Right after the mount,
   `prepareWorkspace` (`services/runner/src/engines/sandbox_agent/workspace.ts` line 43) writes
   the instructions file (`AGENTS.md` or `CLAUDE.md`), any harness files, and non-Pi skill
   directories into `plan.cwd` with plain `writeFileSync` and `cpSync` (lines 111 to 124).
   Because `plan.cwd` is the mount point, those writes land in the durable store and persist to
   the next turn. If the mount is deferred, those writes land on plain local disk instead.

2. A FUSE mount placed over a directory hides what the directory already held. So if the
   workspace files were written to local disk first and the mount arrived later, the mount
   would shadow them: the harness would stop seeing the `AGENTS.md` and skills it was started
   with, and any files it had already written would vanish under the mount and never reach the
   durable store.

3. The session's `cwd` is `plan.cwd` (`createSession({ cwd: plan.cwd, ... })`,
   sandbox_agent.ts line ~1218). The harness process opens with that directory as its working
   directory. Mounting over a directory that a running process already holds as its working
   directory is the same shadowing hazard applied to a live process: the process keeps the old,
   pre-mount view.

### What this means for the "lazy" versus "overlap" framing

The honest scope is not "make the mount lazy" as a small change. Two framings exist and neither
is free:

- Lazy mount on first file use. The runner would write workspace files to local disk, start the
  session, and mount only when the harness first calls a file tool. To be correct it must then
  solve the shadowing problem: after mounting, the workspace files and anything the harness
  already wrote must be copied up into the durable store, and the harness's working-directory
  view must be refreshed. That is real new machinery, not a reordering.

- Overlap the mount with the harness cold start. Start the mount as a background promise and let
  it run while the session cold-starts (the same cold start that runs the Fix A probes), then
  await it before the session actually needs the directory. This is safer than lazy mounting
  because it never defers past the point where files must persist. But `prepareWorkspace`
  depends on the mount being complete (reason 1 above), so the overlap window is only the part
  of the cold start that happens before workspace materialization, not the whole cold start.
  Whether that window is large enough to hide 0.55 seconds depends on runtime timing that
  static reading cannot supply. See `open-questions.md`, question 3.

### Verdict on Fix B

Fix B is genuinely complicated. The eager mount is required, not incidental: workspace files
must persist and must be visible to the harness at session start, and FUSE shadowing makes a
late mount actively wrong rather than merely late. The lazy variant needs new copy-up and
view-refresh machinery. The overlap variant is safer but its saving is bounded by a timing
window we have not measured. The recommendation in `plan.md` is to ship Fix A first and carry
Fix B as a measured follow-up, which the brief explicitly permits.
