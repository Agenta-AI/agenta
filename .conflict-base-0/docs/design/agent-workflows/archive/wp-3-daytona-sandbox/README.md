# WP-3: Daytona sandbox running Pi

Status: **POC complete** against Daytona cloud (`target=eu`). See
[`poc/`](poc/README.md). Ran in parallel with WP-1 and WP-2.

## Goal

Prove the sandbox track end to end: create a Daytona sandbox with Pi installed, inject the
agent's files and secrets, run an agent, stream the output back, and tear down. This takes
the local Pi wrapper (WP-2) and shows it running inside a sandbox. The two can be developed
in parallel, since the Daytona lifecycle and image work do not depend on the wrapper being
finished.

## What the POC established

The POC ([`poc/`](poc/README.md)) does the full loop against Daytona cloud and answers the
key unknowns:

- **Bake Pi into a snapshot.** `build_snapshot.py` builds `agenta-pi-harness` from
  `node:22-bookworm` + Pi `0.79.4` + ripgrep/fd in ~26s. Daytona injects its toolbox daemon
  into the custom image, so `process.exec` / `fs` / sessions work on a plain node base (no
  need to layer on `daytonaio/sandbox`).
- **Cold start is sub-second warm.** Creating a sandbox from the prebuilt snapshot is
  ~0.7-1.1s on a warm runner, with an occasional few-second spike when a runner pulls the
  custom image cold. That beats installing Pi per run (npm install alone is ~3s).
- **Inject config + secret, run, stream, tear down.** `run_agent.py` lays an `AGENTS.md`
  and a task file into a per-run dir, injects the provider credential (env var or uploaded
  credential file), runs Pi headless in `--mode json`, streams the typed event lines, and
  deletes the sandbox. The agent honored the injected `AGENTS.md` and used tools
  (`read`, `read`, `write`).
- **Gotcha: Pi blocks on a trust prompt.** With an `AGENTS.md` in cwd, Pi asks to trust
  project-local files and hangs in a non-interactive session. Pass `--approve` and run with
  stdin from `/dev/null`. This was the main trap.

Full findings, the measured numbers, and how to run it: [`poc/README.md`](poc/README.md).

## Scope

In:

- Create a Daytona sandbox from the Python SDK (`pip install daytona`,
  `Daytona` / `AsyncDaytona`): `create` -> `process.exec` / sessions -> `stop` -> `delete`.
- Bake Pi into a Daytona snapshot (declarative `Image` builder or Dockerfile) so runs skip
  per-run `npm install`. Pre-install `rg` / `fd`.
- Inject files (`fs.upload_file` / `upload_files`) and secrets (`env_vars` at create, or
  per-exec `env`).
- Run Pi headless and stream stdout/stderr back (session with `run_async=True`,
  `get_session_command_logs_async`).
- Expose and use the port via `get_preview_link(port)` (the "works with our port" contract).
- One shared long-lived sandbox (`auto_stop_interval: 0`), per-run working directory plus a
  per-run tmpfs for `TMPDIR`, bounded concurrency.

Out:

- Volume-per-execution. Not feasible in Daytona (volumes mount at create time only); use the
  per-run dir + tmpfs approach instead.
- The provider abstraction for non-Daytona sandboxes. Keep the seam thin, but only implement
  Daytona here.

## Approach (grounded in research)

See [`../research/daytona-sandbox.md`](../research/daytona-sandbox.md) and
[`../research/sandbox-sharing.md`](../research/sandbox-sharing.md).

## Definition of done

- [x] A script creates a sandbox from a Pi snapshot, injects an AGENTS.md and a provider
  key, runs an agent, streams the multi-message output, and tears down cleanly.
- [x] Nothing invocation-specific is written to a persistent volume. No volume is mounted;
  each run uses a per-run dir plus a `TMPDIR` inside it, and the sandbox is deleted at the
  end.
- [x] Cold-start with the custom snapshot is measured and recorded (`poc/README.md`).

## Open questions

Answered by the POC:

- Daytona cloud works end to end with the provided `eu` credentials; the node-base snapshot
  gets a working toolbox; cold start from the prebuilt snapshot is sub-second warm.
- Secret injection has two working paths: `env_vars` at create (secret-as-env) and an
  uploaded credential file via `fs.upload_file` (secret-as-file).

Still open:

- Self-hosted Daytona vs Daytona cloud (AGPL review if self-host-and-modify). POC used
  cloud only.
- Whether an actively streaming session resets the auto-stop idle timer. Sidestepped with
  `auto_stop_interval=0` and owning the lifecycle; not independently confirmed.
- Realistic safe parallel-run count for one small sandbox (needs load testing).
- The snapshot build/version pipeline: who builds and pins `agenta-pi-harness` per agent
  revision, and where that runs (CI or config-publish time).

## Links

- [`poc/`](poc/README.md) — the working POC (build snapshot, run agent, bench cold start)
- [`../research/daytona-sandbox.md`](../research/daytona-sandbox.md)
- [`../research/sandbox-sharing.md`](../research/sandbox-sharing.md)
- [`../research/diskless-in-memory-config.md`](../research/diskless-in-memory-config.md)
- [Project README](../README.md)
