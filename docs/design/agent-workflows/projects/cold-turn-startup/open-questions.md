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

## 4. What is the correct Daytona delivery for a fixed adapter? (largely answered)

Upstream research answered the mechanism question: the CLI honors a pre-seeded
`agent_processes/pi/` directory ("already installed" short-circuit), so baking a fixed adapter
copy into the Daytona snapshot at that path is the preferred delivery, with a runner-hosted
registry JSON via `SANDBOX_AGENT_ACP_REGISTRY_URL` as the alternative. See `research.md`,
"How the installed adapter version is actually chosen".

What remains open is only verification: confirm the in-sandbox CLI's data directory path (the
in-sandbox equivalent of `~/.local/share/sandbox-agent/bin/agent_processes/pi/`) and that the
snapshot build can write there.

- How to answer: run a Daytona cold turn and locate the adapter install directory inside the
  sandbox; then add the pre-seed to the snapshot build and confirm the CLI logs
  "already installed" instead of a registry fetch.
- Depends on it: Stage 4.
