# WP-3 POC: run a Pi agent in a Daytona cloud sandbox

Bakes Pi into a Daytona snapshot, then creates a sandbox from it, injects the agent's
credential and config, runs the agent headless, streams its multi-message output back,
and tears the sandbox down. Runs against **Daytona cloud** (`target=eu`).

This is the sandbox half of the agent runtime. It validates the `DaytonaRuntime` adapter
that WP-2 leaves behind its `Runtime` port (`start` -> create sandbox, inject config ->
lay down the per-run dir, `invoke` -> run Pi and stream, `shutdown` -> delete).

## What's here

- `build_snapshot.py` — bake Pi (+ ripgrep, fd) into the reusable `agenta-pi-harness`
  snapshot so per-run cold start skips `npm install`. Run once.
- `run_agent.py` — the deliverable. Create -> inject -> run -> stream -> tear down.
- `bench_coldstart.py` — measure cold start, Pi snapshot vs the default image.
- `cleanup.py` — list sandboxes and delete leaked WP-3 ones.

## Setup

Needs `uv` and Daytona cloud credentials. Export them (the dev values live in
`hosting/docker-compose/ee/.env.ee.dev.local`):

```bash
export DAYTONA_API_KEY=dtn_...
export DAYTONA_API_URL=https://app.daytona.io/api
export DAYTONA_TARGET=eu
```

Each script declares its own deps inline, so `uv run <script>.py` is enough.

### Build the snapshot (once)

```bash
uv run build_snapshot.py        # ~26s; idempotent, pass --force to rebuild
```

### Provider credential

The agent needs a model. `run_agent.py` supports two injection paths:

- `--auth codex` (default): uploads your local Pi ChatGPT login
  (`~/.pi/agent/auth.json`) into the sandbox and runs on `openai-codex/gpt-5.5`. This is
  the **secret-as-file** path and needs no paid key. Log in once locally with `pi` then
  `/login` -> "ChatGPT Plus/Pro (Codex)".
- `--auth anthropic|openai|google`: injects the matching `*_API_KEY` env var into the
  sandbox (`env_vars`) and runs on that provider. This is the **secret-as-env** path.

## Run

```bash
uv run run_agent.py                       # codex / gpt-5.5
uv run run_agent.py --auth anthropic      # needs ANTHROPIC_API_KEY with credit
uv run run_agent.py --keep                # leave the sandbox up for debugging
```

The agent reads a task file and an injected `AGENTS.md`, then writes `greeting.txt`. A
clean run streams `[tool] read`, `[tool] read`, `[tool] write`, prints the reconstructed
multi-message transcript and the file the agent produced, then deletes the sandbox.

## What the POC proves (definition of done)

- A script creates a sandbox from a Pi snapshot, injects an `AGENTS.md` and a provider
  credential, runs an agent, streams the multi-message output, and tears down cleanly.
  **Done.** The agent honored the injected `AGENTS.md` (it signed the file `-- signed,
  Pip`, an instruction that exists only in the injected file) and used the `read`/`write`
  tools to do the task.
- Nothing invocation-specific is written to a persistent volume. **Done.** No Daytona
  volume is mounted. Each run gets `/home/daytona/runs/<id>/` for its config, session
  file, and `TMPDIR` (Pi's only forced write, the bash output spillover). The sandbox is
  deleted at the end.
- Cold start with the custom snapshot is measured and recorded. **Done.** See below.

## Cold start (measured)

`create()` to `STARTED`, Daytona cloud `eu`:

| snapshot              | min   | mean  | max   | notes                                  |
| --------------------- | ----- | ----- | ----- | -------------------------------------- |
| `agenta-pi-harness`   | 0.7s  | ~1s   | 4.9s  | sub-1.1s warm; spikes when a runner pulls the custom image cold |
| `daytona-small`       | 0.66s | 0.86s | 1.06s | steadier; the base image is pre-cached on every runner |

The prebuilt Pi snapshot lands in the same sub-second range as the stock image on a warm
runner, and occasionally pays a one-time image-pull penalty (a few seconds) on a cold
runner. Both beat installing Pi at runtime, where `npm install` alone is ~3s every run.
The agent task itself (gpt-5.5, read + read + write) ran in ~11s.

## Findings and gotchas

- **The node base image works.** Daytona injects its toolbox daemon into the custom image,
  so `process.exec` / `fs` / sessions work on a `node:22-bookworm` base. No need to layer
  on `daytonaio/sandbox`. Inside: `USER=root`, `HOME=/root`, `PWD=/home/daytona`.
- **Pi blocks on a trust prompt without `--approve`.** With an `AGENTS.md` in the working
  dir, Pi asks to trust project-local files and hangs in a non-interactive session. Pass
  `--approve` (and run with stdin from `/dev/null`) so headless runs never stall. This was
  the single biggest gotcha; the run looked hung when it was waiting on a prompt.
- **Streaming maps cleanly.** Run Pi as `--mode json`; each stdout line is one typed
  event. `get_session_command_logs_async(session_id, cmd_id, on_stdout, on_stderr)` streams
  them live. The `agent_end` event carries the full `messages[]` array (the multi-message
  output); `message_end` events carry per-message token usage and cost. Chunks are not
  line-aligned, so buffer and split on `\n`.
- **`SessionExecuteRequest` has no `env`/`cwd`.** Only the one-shot `process.exec` does. For
  the streaming session path, inject the key via `env_vars` at create time and `cd` into
  the per-run dir inside the command string.
- **All three stored API keys are dead** (Anthropic: no credit; OpenAI: invalid; Gemini:
  expired), so the POC defaults to the developer's ChatGPT login. Production needs a real
  provider key or org credential injected the same way (`env_vars` or a credential file).
- **Avoid `gpt-5.3-codex-spark` on a ChatGPT login** (it 400s). Use `gpt-5.5` / `gpt-5.4`.

## Open questions answered vs. still open

Answered: prebuilt-snapshot cold start (sub-1.1s warm), the node-base toolbox question
(works), and the secret-injection path (env var or uploaded credential file).

Still open: realistic safe parallel-run count in one shared sandbox (needs load testing,
not measured here); whether an actively streaming session resets the auto-stop timer (we
sidestep it with `auto_stop_interval=0`); and the snapshot build/version pipeline (who
builds and pins `agenta-pi-harness` per agent revision).
