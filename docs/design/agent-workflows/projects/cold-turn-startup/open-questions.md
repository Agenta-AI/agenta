# Open questions

These could not be settled by reading the code. Each names how to answer it and what depends on
the answer.

## 1. Which `pi-acp` copy actually runs at session start?

Static reading found two candidate copies: the runner's dependency `pi-acp@0.0.29` under
`node_modules`, reachable through the CLI's "PATH binary hint", and the CLI's own
registry-installed copy `pi-acp@0.0.31` under `~/.local/share/sandbox-agent/bin/agent_processes`.
The CLI's resolution order could pick either. The pnpm patch mechanism only reaches the first.

- How to answer: add a temporary marker to each `dist/index.js` and see which prints on a cold
  local run, or enable the CLI's adapter-resolution logging, or trace the adapter child
  process to see which `index.js` path it opens.
- Depends on it: Stage 2 (patch target) and Stage 4 (Daytona approach). This is the first task.

## 2. Does turning on `quietStartup` have any unwanted side effect?

`quietStartup` suppresses the whole startup banner, not only the version line. The runner
already strips that banner, so the user should see no change. Confirm nothing else in the
runner or the Pi extension reads the banner text or the startup-info metadata before it is
stripped.

- How to answer: grep the runner and the Pi extension for reads of the startup-info field
  (`_meta.piAcp.startupInfo`) and confirm none depend on its content; then a cold local run
  with `quietStartup` on, checking the reply is unchanged apart from the missing banner.
- Depends on it: Stage 1 shipping cleanly.

## 3. Is the harness cold-start window long enough to hide the 0.55 second mount?

The "overlap" variant of Fix B can only overlap the mount with the part of the cold start that
runs before workspace materialization, because `prepareWorkspace` depends on the mount being
complete. Whether that pre-workspace window is large enough to hide 0.55 seconds is a runtime
timing question.

- How to answer: instrument `acquireEnvironment` to log timestamps at mount begin, mount
  complete, workspace-prep begin, and session-open begin on a cold local chat turn.
- Depends on it: whether Fix B's overlap variant is worth building, or whether only the full
  lazy-mount design would pay off. This is the first task of the Fix B follow-up.

## 4. What is the correct Daytona delivery for a fixed adapter?

If Fix A's adapter change is a local patch rather than an upstream version, the in-sandbox copy
must be fixed separately. Whether that is a snapshot bake, a pinned in-sandbox install, or a
runner-controlled adapter resolution depends on how the Daytona snapshot is currently built and
how the in-sandbox CLI resolves adapters.

- How to answer: inspect the Daytona snapshot build for whether it bakes or installs the
  adapter, and confirm the in-sandbox CLI's resolution order matches the host's.
- Depends on it: Stage 4.
