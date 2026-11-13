---
name: agent-release-gate
description: >-
  Run the agent release gate — a portable, wire-level QA harness for the agent runtime.
  Drives the same product endpoint the playground drives and asserts on the SSE frame
  stream and real side effects, never on model prose, so it works against any deployment
  (cloud or self-hosted) from three env vars. Use before an agent-workflows release, or
  after changing the runner, the SDK agent adapters, the runner Docker images, or the
  agent service. Triggers: "run the release gate", "QA the agent runtime", "does the
  agent still work end to end", "pre-release agent QA".
allowed-tools: Read, Edit, Write, Grep, Glob, Bash
user-invocable: true
---

# Agent release gate

Product-level sanity QA for the agent runtime, one layer below the playground UI. The question
is not "is every detail right". It is "**if a user opens the product and does the obvious first
things, do they work?**" This is the gate a release passes before shipping.

Every check asserts on the **wire** (the SSE frame types the browser sees) and on **side effects**
(the file really persisted, the revision really incremented), never on what the model says. That
makes it deployment-agnostic: point it at any stack and the assertions still hold.

Dated incidents, version facts, verification logs and pass rates that explain why the rules below
exist are in `docs/design/agent-workflows/projects/qa/release-gate-history.md`.

## Run it

Set three environment variables for the deployment under test, then run the gate:

```bash
export AGENTA_BASE=https://your-stack.example.com   # deployment origin
export AGENTA_PROJECT_ID=...                         # target project
export AGENTA_API_KEY=...                            # project API key

uv run resources/qa_product.py --all --custom-slug <vault-slug> --custom-name "<display-name>" --require-store  # everything
uv run resources/qa_product.py --cell P1                         # one cell
uv run resources/qa_product.py --cell C1 --only chat              # one journey
uv run resources/qa_product.py --cell S2 --only warm --only cold1 --require-store  # continuity
```

**EXPORT the three variables, do not just set them.** When `AGENTA_*` is absent from its
environment, the driver falls back to an env FILE. A credentials file of bare `KEY=value` lines
sourced with `. file` sets the shell only, so the child `uv run` process inherits nothing and the
driver silently runs against whatever deployment the fallback file names. The failure shows as
`401 Invalid credentials` from a stage whose key answered 200, or as a green run recorded against
the wrong stack. Use `set -a` around the source, or `export` each variable, and confirm the stage
in the results before you trust them.

Paths are relative to this skill's directory. The deployment's vault must hold the provider keys
the cells use (Anthropic / OpenAI / OpenRouter). If the three env vars are unset the driver stops
immediately and names exactly what is missing; a legacy `--env-file <path>` fallback also exists.
`--all` includes cells P2, P2b, and P3 (a custom OpenAI-compatible provider, with P2 and P2b
running locally and P3 on Daytona), which need a vault slug passed via `--custom-slug`; the driver
fails fast if it's missing. `--custom-name` is also required because `model_keys` is built from
the display name rather than the stable slug. Custom-provider cells skip the credential-rotation
journey because their value is write-only and cannot be safely restored. Cells S1, S2 and C1
additionally need the subscription sidecar logged in on the target deployment. See
`resources/coverage.md` for what each cell requires. The Daytona cells (C2, C4, P3, X2)
additionally run the `secret_opaque` journey and need the runner's Daytona API key to manage
Secrets, because credential hiding is on by default; without it those cells fail at sandbox
creation with an error naming the permission.

**The one flag a release conductor must not skip past.** The continuity journeys
(`warm`, `cold1`, `cold2`) only mean anything on a **store-backed** deployment: with no object
store the runner degrades silently to an ephemeral working directory, so those journeys SKIP by
default and FAIL with `--require-store`. Run the gate against a deployment with `AGENTA_STORE_*`
configured and pass `--require-store`, or the greenest possible run still says nothing about
durability. `cold2` additionally needs an operator hook that SIGKILLs the runner replica
(`--cold2-replace-cmd`) and SKIPs without it.

**Write that hook to kill AND start, and do not shorten it.** The kill has to be a SIGKILL,
because on SIGTERM the runner runs its shutdown handler and destroys every sandbox it owns,
including the session the journey wants to resume. The start has to be explicit, because Docker
treats an operator-issued kill as a manual stop and skips the `always` restart policy: a hook
that kills and then waits for the container to come back on its own waits forever. So the hook
is a kill, an explicit start, and a wait for health before it returns:

```bash
cat > /tmp/replace-runner.sh <<'SH'
set -eu
R=<runner>
docker kill -s KILL "$R"
docker start "$R"
for _ in $(seq 60); do
  [ "$(docker inspect -f '{{.State.Health.Status}}' "$R")" = healthy ] && exit 0
  sleep 2
done
echo "runner $R never reached healthy: $(docker inspect -f '{{.State.Status}}/{{.State.Health.Status}}' "$R")" >&2
exit 1
SH
chmod +x /tmp/replace-runner.sh
export AGENTA_QA_RUNNER_REPLACE_CMD=/tmp/replace-runner.sh
```

Bound the health wait and exit non-zero with the container's status when it lapses, as above.
The driver caps the hook at 180 seconds, but a hook that spins until that cap tells you nothing. A
hook without the explicit start leaves the runner down, and every later cell fails for an
unrelated reason. The session-control hook cells follow the same rule:
`DockerComposeHooks.kill_runner` uses `compose restart -t 0`, with `ensure_runner_healthy` in a
`finally` as the backstop.

**The cells that end with a human step: H1 and H2.** They test the HOSTED subscription connection:
the user's own ChatGPT subscription, signed in once through the product and delivered to the
sandbox. S1 and S2 read a login mounted by hand, so they prove the self-hosted case only. H1 and
H2 SKIP, with the reason, when the project has no connected subscription. Their `refresh` journey
expires the stored login and needs `--db-container`, `--stack-env` (crypt key) and
`--redis-container` (so the cached vault read does not hide the expiry). Their `dead` journey needs
`--runner`. Run `dead` LAST: it kills the login, and only a person can sign in again. When a
release changes subscription login storage or publication, `--release-base` forces `refresh` even
against `--only`, because a successful chat does not prove the rotated login reached the vault.
`relogin_needed` always SKIPs and its reason carries the steps. Runbook: `resources/coverage.md`.

**The flag that makes the gate fit the release: `--release-base`.** The matrix is fixed, so
without it a release that reworked a subsystem gets exactly the coverage of a release that did
not touch it. Pass the ref the release branches from, and the driver reads the release's own
changed paths, matches them against the rules in `resources/path_triggers.py`, and makes the
cells those rules name MANDATORY for this run:

```bash
uv run resources/qa_product.py --all --release-base origin/main --require-store   # every release run
uv run resources/path_triggers.py --release-base origin/main                      # preview only, runs nothing
```

A mandatory cell in `qa_product.py` is added to the run even when `--cell` did not ask for it. A
mandatory standalone script is a separate process the driver cannot observe, so it is printed,
written to `mandatory.json`, and listed in `summary.md` under "Mandatory for this release". **The
release is not green until each of those has a recorded result of its own.** If a rule names a
cell that does not exist, the driver stops before running anything. Add `--changed-path` to state
paths by hand where the checkout is not the release branch. With neither flag, nothing changes.

Adding a rule is one line in `PATH_TRIGGERS` (a glob, and the cells it makes mandatory) plus the
cell it names. Matching is `fnmatch` over the whole repo-relative path, so `*` crosses directory
separators and `a/b/*` covers the whole subtree; write `**` so a subtree rule reads as one.

**Reading the result.** Each journey prints `PASS`, `FAIL`, or `SKIP` with a one-line reason, and
a per-cell markdown table lands with the full JSON in `./qa-gate-runs/<timestamp>/` (override the
location with `AGENTA_QA_RUNS_DIR`). Runs are written to the current working directory, never into
the skill. `SKIP` is expected where a journey does not apply to a cell (for example `mcp` on any Pi
cell, because user MCP is Claude-only). Any `FAIL` blocks the release until triaged.

**A SKIPped integration test in a security- or concurrency-bearing area is a FAILURE in your
summary line, not green.** State it as "N passed, M skipped OF WHICH k are untested claims" and
name the k. A commit-lock race test skipping for want of a reachable Postgres is exactly how a
one-line syntax error (`SET LOCAL lock_timeout` with a bind parameter, which Postgres rejects
outright) survived 1911 green tests before a human hit it as his first live action.

**The two journeys that run many things at once: `burst` and `crosstalk`.** Every other journey
drives one run at a time, so the gate only ever saw faults that reproduce on a quiet deployment.
The credential-delivery fault of AGE-4249 does not: some fresh Daytona sandboxes start without
their Secret substitution wiring, roughly an 8 percent fault per cold sandbox. `burst` sends 16
first messages at the same time on 16 brand new sessions, so the run buys 16 cold starts instead
of one. `crosstalk` runs 3 two-turn conversations with long output beside 2 approval flows, and
checks that no stream carries another session's nonce, except on the codex harness, where the
gate rides a platform tool with empty arguments, so the approval command carries no nonce and
isolation is not checked there (`nonce_checked=false`). Both are Daytona-only by default and skip
elsewhere; both report the runner's stable error code per run, so a `credential_delivery_failed`
names itself.

```bash
uv run resources/qa_product.py --cell C4 --only burst --only crosstalk
uv run resources/qa_product.py --cell C4 --only burst --burst-size 24         # more cold starts
uv run resources/qa_product.py --cell C3 --only crosstalk --concurrency-everywhere  # local too
uv run resources/test_qa_product_concurrency.py                               # offline tests
```

**Read a green burst honestly.** At an 8 percent per-cold-start fault rate, 8 runs miss the fault
51 percent of the time, 16 miss it 26 percent, and two Daytona cells at 16 miss it about 7 percent.
A PASS is a sample, not an all-clear, and the result says so in its own reason line. A FAIL is
proof.

Each concurrent run holds a Daytona sandbox of about 5 GiB until its auto-delete window closes, so
a burst of 16 is about 80 GiB. The counts are `--burst-size` (default 16),
`--crosstalk-conversations` (default 3) and `--crosstalk-approvals` (default 2). The cap is 32
concurrent runs, for the burst size and for the two crosstalk counts together. When every failed run is a capacity refusal,
the cell is a loud SKIP, never a PASS or a FAIL. When any run failed for another reason, the cell
is a FAIL and the refused runs count as failed. `--concurrency-timeout` (default 300s) bounds one TURN as
an absolute deadline, so a two-turn crosstalk run gets twice that.

A release that changes `services/runner/src/engines/sandbox_agent/**` or
`services/runner/src/providers/daytona*` makes the Daytona cells C2, C4 and X2 mandatory through
`path_triggers.py`, and forces `burst` and `crosstalk` into the run even when `--only` named
something else.

**Before a human gets a deployment URL, run `resources/qa_commit_approval.py` too.** None of the
journeys in `qa_product.py` drive a live turn against a REAL, saved workflow revision (the
`commit` journey only exercises the REST API; `chat`, `tool`, `approve`/`deny` all run against an
inline, unsaved config). So nothing else in the gate sees the single-use execution-authorization
gate act around a real config mutation. This script creates a real workflow and revision, invokes
a live agent turn that calls `read_config` then `commit_revision`, expects the pause, approves it
in-band, and verifies the new revision landed with REST fetch-back. A FAIL here blocks the
release.

## Tiers: coached vs. mechanism-blind

Every cell in this gate declares which of two tiers it belongs to, in its own docstring:

- **Coached (backend-path test).** The prompt names the mechanism verbatim: which tool, which
  operation, which target path. This proves OUR CODE works (the gate, the base check, the
  authorization handoff, the sandbox path) when the right call is made. It proves NOTHING about
  whether a model finds that call from a plain-language human ask. Cells marked mechanical make
  no model call that matters, or no model call at all.
- **Mechanism-blind (model-behavior test).** The prompt is phrased the way a real user types,
  with no tool names, no operation names and no schema hints. Only these cells license a claim
  about what the model can do unprompted.

**Rule: claims of model behavior may only cite mechanism-blind cells.** Most cells here are coached
and test backend paths correctly, but they do not stand in for model-discovery evidence. Asked in
plain words to "add the skill I saved in your folder", a model once invented a nonexistent marker
syntax (`{"@ag.embed": {"@ag.references": ...}}`) and the engine accepted it as literal data. No
coached cell could catch that, because none tests whether the model reaches for the real mechanism
on its own. `resources/matrix_g1_guidance_discovery.py` is the first mechanism-blind cell. It
reuses `qa_matrix_lib.py` the same way the one-shot config-editing benchmark (Tier B,
`docs/design/agent-config-editing/benchmark/bench_lib.py`) does. Check both before you write a new
mechanism-blind cell from scratch.

## Session control cells

`resources/session_control.py` is a second, standalone driver with its own account bootstrap:
sixteen cells that cover Stop, durable commands, and the runner's recovery paths (park/resume,
watchdog quarantine), on the same product endpoint and wire.

**These cells are MANDATORY** whenever the release diff touches any of:

- `services/runner/src/sessions/**`
- `services/runner/src/engines/sandbox_agent/**`
- `api/oss/src/core/sessions/**`
- `api/oss/src/tasks/asyncio/sessions/**`
- `api/oss/src/apis/fastapi/sessions/**`

Run every cell with one line:

```bash
uv run resources/session_control.py --cells all --harness pi_core --sandbox local
```

Add `--project <docker-compose project name>` to run the eight cells that need direct Docker and
Postgres access (`sandbox-gone`, `records-outage`, `restart-after-stop`, `runner-gone`,
`runner-gone-late`, `post-stop-row`, `codex-child`, `stale-tail`) and the abort-log subcheck inside
`stop-after-finish`. Without `--project`, those eight cells SKIP with a named reason. They need a
docker-compose project on the same host as the runner, so they cannot run on a cloud stage; plan
them against the local stack. The other eight cells (`stop-warm`, `double-send`, `stale-stop`,
`stop-approval`, `stop-after-finish`, `repeat-stop`, `concurrent-stops`,
`stop-during-completion`) run over HTTP alone against any deployment. Add
`--resume <path to a prior run's results.json>` to pick a lost run back up: any cell already
recorded there is loaded instead of re-run.

Results land in a timestamped folder under `~/agenta-qa-evidence/` (override with
`AGENTA_QA_RUNS_DIR`), as `results.json` and `summary.md`, in the same PASS/FAIL/SKIP shape as the
rest of the gate. When a release path makes session control mandatory, pass that artifact to the
standing gate with `--session-control-results <path>`: a missing or incomplete artifact stops the
gate before the matrix runs, and a recorded FAIL makes the final gate exit nonzero.

**Environment, by name.** Same three-variable discipline as the rest of the gate, no env-file
fallback:

- `AGENTA_BASE`: the deployment origin.
- `AGENTA_ADMIN_KEY`: mints the ephemeral account this driver runs under. Lives in
  `~/.agenta-qa-secrets.env`.
- `QA_OPENAI_API_KEY`: stocked into that account's vault so the `pi_core` and `codex` harnesses
  have a provider key. Lives in `~/.agenta-qa-openai.env`.
- `ANTHROPIC_API_KEY`: only required for `--harness claude`, stocked into the same vault the
  same way. Lives in `~/.agenta-qa-secrets.env`. A pi_core- or codex-only run does not need it.

**Run `--harness claude` on a custom connection** (for example when the Anthropic key has no
credit). Set these, and `ANTHROPIC_API_KEY` is no longer needed:

- `AGENTA_QA_CLAUDE_MODEL`: the model key, `<connection name>/custom/<model slug>`, e.g.
  `orclaude/custom/anthropic/claude-haiku-4.5`.
- `AGENTA_QA_CLAUDE_PROVIDER`: the protocol the connection speaks; default `anthropic`.
- `AGENTA_QA_CLAUDE_CONNECTION_SLUG`: the vault slug the agent config names.
- `AGENTA_QA_CLAUDE_CUSTOM_URL` and `AGENTA_QA_CLAUDE_CUSTOM_KEY`: the connection's base URL
  and key (for OpenRouter: `https://openrouter.ai/api` and `OPENROUTER_API_KEY` from
  `~/.agenta-qa-secrets.env`).

The driver mints a fresh account per run and creates the custom connection in that vault under
the slug you give. `AGENTA_QA_CLAUDE_MODEL` and `AGENTA_QA_CLAUDE_PROVIDER` also work alone, to
change the model on the vault Anthropic key. `results.json` records the model the run used.

**The long-turn prompt is not a bare `sleep N`.** Claude Code refuses a standalone long sleep
(`Blocked: standalone sleep 45 ... use run_in_background`), the turn ends in seconds, and a later
Stop gets 409 `current: none`. The cells ask for `timeout N tail -f /dev/null; echo <codeword>`,
which runs in the foreground for N seconds.

**`stop-approval` asks for a mutating command.** Claude Code auto-approves a read-only command such
as a bare `echo` whatever the permission policy says, so no approval parks and the cell fails with
`no pending approval was seen before the Stop`. `runner.kind` is not the cause: the SDK reads only
`runner.permissions.default`.

**`stop-approval` sends an `Idempotency-Key`.** The durable approval path validates that header
before it decides whether the execution is still continuable, so an answer without it comes back
422 and never reaches the 409 the cell asserts. The cell sends a stable key derived from the
interaction id, and two tests in `test_session_control.py` pin both halves. The general rule: when
a gate asserts a specific status code on a durable endpoint, send the headers the browser sends,
or the assertion measures the validation layer instead of the behavior.

A Daytona run additionally needs a Secrets-capable Daytona key on the runner; the key in most
session env files returns 403 on the Secrets endpoint, so check that before you trust a Daytona
result.

## Running the gate against a preview stage

The cells were written on a dev box, where the operator's own Claude and Codex logins are mounted
and the local sandbox is free. A cloud stage is neither, and the mismatch arrives as a red cell
that reads like a release regression. Check these before you plan a stage run:

- **Which sandbox kinds the stage allows.** A stage can refuse the local sandbox (a 403 naming
  `AGENTA_RUNNER_ENABLED_SANDBOX_PROVIDERS`) or refuse Daytona. A local-sandbox cell cannot run on
  a stage that refuses local, and a Daytona cell cannot run on a stage that refuses Daytona. H1
  is local and H2 is Daytona, so they may need different stages.
- **Whether Daytona answers.** Pre-flight with one cheap sandbox create. A suspended organization
  returns 403 at sandbox create, which looks nothing like the cell's subject.
- **Whether the managed provider keys have credit.** Read an exhausted-key red as blocked
  coverage, never as a pass and never as a regression. A custom OpenAI-compatible connection to
  OpenRouter is a funded alternative.

**Overriding the cell shape without touching an assertion.** `qa_matrix_lib.agent_config` and
`qa_commit_approval.py` default to Claude on the operator's mounted subscription on a local
sandbox, which no stage can serve; left alone they die with `runtime_provided local run requires a
mounted subscription`. Both read the shape from the environment, the same way
`matrix_gw1_gateway_tools.py` does, so the client-tool cell (`matrix_l4_*`) and the
commit-approval script run on any stage:

```bash
export AGENTA_QA_HARNESS=pi_core            # claude | pi_core | codex
export AGENTA_QA_SANDBOX=daytona            # local | daytona
export AGENTA_QA_CONNECTION_MODE=agenta     # agenta (vault) | self_managed (operator login)
export AGENTA_QA_CONNECTION_SLUG=<vault slug>
export AGENTA_QA_MODEL=<model id>
export AGENTA_QA_PROVIDER=<provider>
```

A green client-tool round trip on pi_core against a real provider proves that surface on that
harness. It is not evidence about the claude harness.

### Calling the runner's `/run` directly

Most cells drive the product endpoint. A few diagnostics post to the runner's own `/run`:

- Send the shared token as an `X-Agenta-Runner-Token` header matching the stack's
  `AGENTA_RUNNER_TOKEN`.
- Send the credential in a `modelConnection` object (`provider`, `deployment`, `credentialMode`,
  `credentials`). A top-level `credentialMode` is rejected.
- Send a short multi-turn history, not a single fresh user message. A single message is the
  last-message-only shape, and the runner then tries to rebuild the conversation from the durable
  record log.
- Check that a ChatGPT account accepts the model before you use it in a subscription cell.
- Do not gate a cell on the harness list in the runner's health endpoint.

## When results lie

The runtime **fails open**: a component can break, get logged, and the turn still succeeds with a
normal-looking answer. A green turn is therefore not proof on its own. Before trusting a pass,
read `resources/LESSONS.md`: every trap there produced a green test that proved nothing. The three
that bite hardest: replay conversation history byte-faithfully (tool parts included) or every turn
silently goes cold; re-run any prior blocker-level finding after a redeploy before believing it;
and a multi-turn check that never leaves the warm daemon, on a deployment with no object store,
proves nothing about the durable working directory (LESSONS #16).

## Resources

Tiers: **coached**, **mechanism-blind** and **mechanical** as defined above. "Always" means every
release run. "Path rule" means `path_triggers.py` makes the cell mandatory when the release diff
touches the paths that rule names.

| File | Tier | What it asserts | When mandatory |
|---|---|---|---|
| `coverage.md` | doc | The cells (harness × sandbox × auth), the journeys with a one-line meaning each, the continuity tiers, and what each cell needs beyond the three env vars. | Read before a run. |
| `LESSONS.md` | doc | The traps. Read before you write or trust any agent QA test. | Read before a run. |
| `qa_product.py` | mixed, per journey | The gate driver (cells × journeys). | Always. |
| `path_triggers.py` | tooling | The path rules: glob to mandatory cells and forced journeys. `--release-base <ref>` previews. | Not a cell. Add a rule whenever a cell only matters for one part of the tree. |
| `qa_probe.py` | coached | One turn on the product path answers at all. | Before the full gate. |
| `qa_commit_approval.py` | coached | The commit-approval round trip against a real saved revision. Self-contained. `AGENTA_QA_*` moves its shape. | Before a human gets a deployment URL. |
| `qa_matrix_lib.py` | library | Shared helpers for the `matrix_*.py` cells and the two invariants below. Import only. | Not a cell. |
| `session_control.py` | coached | Stop, durable commands, park/resume, watchdog quarantine (sixteen cells). | Path rule: runner sessions, sandbox engine, API sessions. |
| `matrix_gw1_gateway_tools.py` | coached, one mechanism-blind leg | Gateway search filters by policy, an allowed tool executes with a real provider result, an ask-tier tool parks and is answered through the interactions API. | Path rule: gateway tools. |
| `matrix_w3.py` | coached, mechanism-blind recovery | Two sessions with disjoint edits; B gets a stale `base_revision_id` and must recover from the 409. | Optional. |
| `matrix_w4.py` | coached | A pending approval whose base goes stale is caught at EXECUTE time. | Optional. |
| `matrix_w5.py` | coached | A steered (interrupted) session still works on later turns, including its durable mount. | Optional. |
| `matrix_w7.py` | coached | An `@ag.file` commit: manifest carries digest and bytes, the commit lands with the exact bytes. | Optional. |
| `matrix_w7_per_harness.py` | coached | W7 on claude, codex and pi_core, each classified on its own. `--only <harness>`. | Optional. |
| `matrix_w7_daytona.py` | coached | W7 on `sandbox=daytona` (claude harness). Sandbox-axis guard. | Optional. |
| `matrix_w1_daytona.py` | coached | The commit round trip on Daytona: `DaytonaWorkspaceReader` and placeholder secrets. | Optional. |
| `matrix_t8_saved_files.py` | coached | The Daytona remote agent mount: planted marker reaches tool output and the commit, runner logs `remote agent mount active for artifact=<id>`. | Optional. |
| `matrix_t9_agent_tools.py` | coached | The runner restores `agent-files/.tools/` (`setup.sh`, `bin/qa-tool`) before a session. | Path rule: agent tools restore and image recipes. |
| `matrix_invariant_commit_auth_refusal.py` | coached scenario, mechanism-level invariant | No empty `isError:false` tool result for a call the runner log refused (`[commit-auth] refused`). | Optional. |
| `matrix_g1_guidance_discovery.py` | mechanism-blind | A plain-language ask to add a saved skill leads to an approved `commit_revision` whose stored revision carries the skill. | Optional. |
| `matrix_b1_builtin_find.py` | coached | Each harness's native file search returns the planted filenames in the tool output payload. | Optional. |
| `matrix_l1_lifecycle_routes.py` | mechanism-blind | The route the runner takes for each mid-conversation config change (one sandbox id = in place, two = rebuilt). | Always. |
| `matrix_l2_approval_across_config_change.py` | coached | An approval answered with a config change in the same request: commit lands, row resolves, change takes effect next turn via a rebuild. | Always. |
| `matrix_l3_abandoned_approval.py` | coached | A new message instead of an answer: gated tool does not run, row goes `cancelled`, session still works. | Always. |
| `matrix_l4_client_tool_lifecycle.py` | coached | The client-tool round trip reaches the model and stores the `client_tool` interaction. | Nice to have. |
| `matrix_l5_live_route_observed.py` | mechanism-blind, with a control | A mid-conversation instructions edit is observed by the harness, against a cold control. | Always. |
| `matrix_n1_session_context.py` | journey, with two controls | The per-turn session facts (session name after a rename, agent display name) reach the agent; a forged `meta.session_context` is ignored. | Path rule: session context. |
| `matrix_r1_two_replicas.py` | coached | Turn binding, Stop and follow-up routing, Kill by label and drain across two runner replicas. | Path rule: runner replicas. |
| `matrix_c5_first_call_race.py` | mechanical | A placeholder 401 on a cold Daytona first call is reported as `credential_delivery_failed`, never as the user's missing key. | Every gate (LESSONS #18). |
| `sweep_disagree.py` | mechanical | No untriaged `[reconcile] shadow ... DISAGREE` line in the runner log. Run after a gate session. | Every gate (LESSONS #18). |
| `matrix_h1_bad_harness.py` | mechanical | A malformed harness is refused at some boundary and never runs as a defaulted turn. | Every gate (LESSONS #18). |
| `check_secrets_teardown.py` | mechanical | No Daytona Secret created by the journey outlives its eviction. Needs `DAYTONA_API_KEY` or `AGENTA_RUNNER_DAYTONA_API_KEY`. Run alone. | Every gate (LESSONS #18). |
| `matrix_s1_custom_secrets.py` | coached | A custom-secret binding reaches local and Daytona sandboxes, a rotation is seen next turn, removal is seen as absent. Values never printed. | Path rule: custom secrets. |
| `matrix_i1_settlement.py` | mechanical | The interaction-card row lifecycle for every card kind: complete, decline, walk away, and `resolved` stays approval-only. | Optional. |
| `matrix_i2_card_journeys.py` | mechanical | Six scripted interaction-card journeys across several cards. SKIPs whole when `TELEGRAM_BOT_TOKEN` is unset. | Optional. |
| `qa_longctx.py` | coached | Long-context memory, Gmail tools, and concurrent-session bleed. Needs live Gmail and GitHub Composio connections. | Optional. |
| `seeds/` | data | Representative green `results.json` files kept as regression-seed references. | Not a cell. |
| `test_*.py` | offline unit tests | The gate's own logic (path rules, parsers, classifiers, session-control helpers). | Run after you change a resource script. |

**How to run the `test_*.py` files.** Run them with pytest from `resources/`, in any interpreter
that has pytest and httpx, for example `uvx --with httpx pytest test_path_triggers_registry.py`.
The `api/` environment also has both, so `uv run --no-sync pytest <path>` from `api/` works. Files
with an inline `# /// script` header also run on their own with `uv run <file>`.

### Cell notes

- **Two invariants in `qa_matrix_lib.py`.** `check_no_blank_success_on_refusal` reads the runner's
  own log line against the wire outcome. `check_no_silent_turn(turns)` fails a turn that comes
  back with no text, no tool call, no approval gate, no file or data payload and no error. That
  turn is a swallowed provider failure: the user sees a blank bubble with no reason. Its content
  definition mirrors `content_parts_emitted` in
  `sdks/python/agenta/sdk/agents/adapters/vercel/stream.py`, so reasoning alone does not count.
  **Wire `check_no_silent_turn` into the PASS condition of every new cell** as
  `... and not silent["violations"]`. Exclude only a turn the cell aborted or interrupted on
  purpose, as `matrix_w5.py` does.
- **`agent_config`** reads model, provider, connection mode and slug, harness and sandbox from the
  `AGENTA_QA_*` variables, so a cell that builds its config through it runs on a cloud stage. A
  cell that hardcodes its config dict does not, and each of those is deliberate.
- **A SKIP from a per-harness or per-sandbox leg is an untested leg, not a pass.** Name it as such
  in any release summary. This holds for `matrix_w7_per_harness.py` (codex and pi_core need one
  unambiguous funded OpenAI `provider_key` secret), `matrix_g1_guidance_discovery.py`,
  `matrix_b1_builtin_find.py` and every cell with an `--only` leg.
- **A SKIP from `matrix_invariant_commit_auth_refusal.py`** means the invariant was not tested
  this run. Its replay trigger is best-effort; a deterministic trigger is an open follow-up.
- **`matrix_w3.py`** passes on autonomous recovery, and also passes when the model diagnoses the
  409 and asks first, once one bare "yes, retry" completes it. Only the recovery step is
  mechanism-blind. Do not cite it for "the model finds `commit_revision` unprompted".
- **`matrix_w5.py`** guards a mount-lifecycle bug (the durable mount is not re-established after a
  steer). Keep it apart from the separate steer bug about turn currency and heartbeats when you
  triage.
- **`matrix_w7.py`**: `DEFERRED_NOT_EXECUTED` on a queued second tool call is benign (another gate
  is already pending). Naming `@ag.file` in the prompt means the cell cannot catch a model that
  fails to find the marker unprompted.
- **`matrix_w1_daytona.py`** and **`matrix_w7_daytona.py`** need a funded Anthropic vault key. The
  file's docstring gives the vault-secret shape and the `provider_key` slug gotcha.
- **`matrix_g1_guidance_discovery.py`**: PROBE asserts the rendered instructions file holds the
  platform-guidance block; TRIALS run the prompt N times and pass only when the stored revision
  carries the skill. Copying into the harness's own folder is a FAIL. Setup gotchas live in
  `qa_matrix_lib.py`: the Pi harness kind is `"pi_core"` (bare `"pi"` returns 500), `pi_core`
  needs `"claude-haiku-4-5"` rather than `"haiku"`, and codex accepts its curated short alias
  bare. Both legs need `sandbox=daytona` and a vault key. Treat its discovery rate as an open
  quality question.
- **`matrix_b1_builtin_find.py`** needs two explicit turns (write, then search). Codex SKIPs by
  design, because its exec output does not land in the `tool-output-available` payload's `.output`
  field.
- **Lifecycle cells (`matrix_l*.py`)** assert the STORED turn ledger (`POST /sessions/turns/query`,
  one `sandbox_id` per turn) or the stored interaction rows (`POST /sessions/interactions/query`),
  never the SSE echo. An empty ledger FAILS a cell. L1 blocks on six cases: no change stays warm;
  an instructions edit, a permissions edit and a tool-catalog edit escalate; a same-connection
  model switch stays warm on BOTH claude and pi_core. An instructions edit rebuilds, so L1's
  `instructions` case and L2's first variant expect TWO sandbox ids.
- **`matrix_l4_client_tool_lifecycle.py`** records rather than asserts the sandbox count, which is
  two today because a client-tool pause is not parkable (#5384). If it reads one, the warm hold
  landed and the docstring needs an update.
- **`matrix_l5_live_route_observed.py`** reports INCONCLUSIVE when the cold control also fails. It
  asserts the edit, never the route. `--only <harness>` runs one leg.
- **`matrix_n1_session_context.py`** is the one cell that asserts on model prose, because
  `turnContext` is a prompt string the runner never logs. Every expected value carries a random
  token spoken nowhere in the conversation. An echo probe makes the cell INCONCLUSIVE when the
  model cannot repeat a literal token, and a read-back of the stored header follows every rename.
- **`cold1` forcing function.** It moves `harness.permissions` (the `harnessSession` facet, which
  goes to `reopen-session`) and asserts two distinct sandbox ids. A forcing function must depend
  on a route that is escalated by POLICY, not by current capability.
- **Stale-approval regate has no live cell.** `shouldRegateStaleApproval` has unit coverage only.
  Do not write a pure HTTP cell for it; it needs a runner-side hook or the `mixed-gate-no-park`
  approach described in the history file.
- **`matrix_r1_two_replicas.py`** needs a stack with TWO runner containers, `--project <compose
  project>` and `--stack-env <env file>`. It decides which container served a turn from the
  containers' logs, the turn ledger, `runner_replica_id` and `session_commands.claimed_by`, never
  from the stream. Phase 1 cells (`--cells phase1`): `warm-holder`, `approval-warm`,
  `queued-input`, `stop-on-b`, `kill-from-non-holder`, `duplicate-turn-id`, `inprocess-warm`.
  Phase 2 cells kill, stop or recreate a runner and SKIP without `--allow-destructive`;
  `identity-mismatch` also needs `--worktree`, `--recreate-license`, `--recreate-stage` and
  `--recreate-env-file`. **A release record needs BOTH phases: `--cells all --allow-destructive`.**
  A run where every selected cell SKIPs exits 2. A queued input must carry only the trailing user
  message, as the browser sends it. `--subscription hosted` (with `--subscription-slug`,
  `--subscription-sandbox daytona|inprocess`, `--pi-model`) runs the routing cells on Pi with the
  project's hosted ChatGPT connection, plus `hosted-both-pods`, `hosted-refresh-across-pods` and
  `hosted-restart-reconnect`; `--subscription mounted` uses the operator's mounted Pi login,
  `inprocess` only. `--daytona-harness pi_core` runs the Daytona cells on Pi with the
  `--custom-name` / `--custom-model` connection. `--kube-namespace <ns>` (with `--kube-context`,
  `--kubeconfig`, `--kube-release`, optional `--kube-secret`) runs against a Helm release with two
  runner pods and adds `rollout-during-turn` and `drain-node-parked-approval`; there
  `identity-mismatch` SKIPs.

## Contributing

Before committing any resource script, run the repo-pinned ruff (`uv run --no-sync ruff format`
then `uv run --no-sync ruff check` from the repo root covers it), not `uvx`, whose pulled
version has different defaults and produces a false block. Unformatted resource files break the
repo-wide format CI job.

When you add a cell, ask whether it is only meaningful for changes in one part of the tree. If it
is, add the rule to `resources/path_triggers.py` in the same change. A cell whose subsystem can be
rewritten without anyone remembering to run it is coverage on paper. Add a row to the Resources
table in the same change.

Release-night findings and the full evidence history are archived in
`docs/design/agent-workflows/projects/qa/` (`release-gate-history.md`, `findings.md`,
`matrix.md`).
