# Agent-workflows QA and autohealing recipe

This folder holds the manual QA program for the agent-workflows feature, the findings it
produces, and the regression tests those findings justify. It is written so a future agent
can re-run the whole loop cold: diagnose the feature across its full matrix, record what is
broken with enough context to fix it, fix the simple things, and leave durable tests behind.

The goal state is a feature that works end to end across every meaningful cell of the
matrix, a findings log for the cells that do not, a set of fixes for the simple breaks, and
replayable regression tests that keep the working cells working without calling a paid LLM.

## Files in this folder

- `README.md` (this file): the recipe. How to configure each axis, run each environment,
  triage a finding, and capture a test. This is the reusable workflow.
- `matrix.md`: the coverage matrix and the Gherkin scenarios. The matrix says which cells
  are valid, which are not applicable, and which are blocked. The scenarios say exactly how
  to exercise each capability and what a pass looks like.
- `findings.md`: the findings log, in the `open-issues.md` style. One entry per defect, each
  with enough provenance and repro to hand to a fixer cold.
- `runs/`: captured request and response pairs from real runs. These are the raw material
  for regression fixtures. Created on first run.

## The three axes

The matrix is the product of three axes. The full product is large, so `matrix.md` marks
each cell valid, not-applicable, or blocked. Do not test cells that cannot exist.

**Environment** (the execution path that actually runs the harness):

- `E1` service / in-process Pi. `AGENTA_AGENT_RUNTIME=pi`, `sandbox=local`. The `services`
  container drives Pi through the `agent-pi` sidecar. Sidecar logs show `[pi-wrapper]`.
- `E2` service / Rivet local. `AGENTA_AGENT_RUNTIME=rivet` (or any cell that forces Rivet),
  `sandbox=local`. The harness runs over ACP through `sandbox-agent` in local mode. Sidecar
  logs show `[rivet-wrapper]`.
- `E3` service / Rivet Daytona. `sandbox=daytona`. Same as E2 but the sandbox is a Daytona
  cloud workspace. Always Rivet. Slower to start.
- `E4` local SDK backend. No service. A standalone Python script pulls the agent config from
  Agenta and runs it on the host through the SDK (`InProcessPiBackend` or `RivetBackend`).
  This is the path a user takes when they run their agent outside the platform.

**Harness**: `pi`, `agenta`, `claude`.

**Capability**: chat, instructions, model override, builtin tools, code tools, gateway
tools (Composio), MCP, skills without code, skills with code, client tools.

## How the backend is chosen

`select_backend` in `services/oss/src/agent/app.py` picks the engine from
`AGENTA_AGENT_RUNTIME` plus the request's harness and sandbox:

- `AGENTA_AGENT_RUNTIME=rivet` routes every run to Rivet.
- `AGENTA_AGENT_RUNTIME=pi` routes `pi` and `agenta` plus `local` to in-process Pi.
- A `daytona` sandbox, or the `claude` harness, always forces Rivet regardless of the env.

To switch a deployment between E1 and E2/E3, recreate the `services` container with the
chosen runtime. The command is under "Configuring the environment" below. The harness and
sandbox themselves come from the request body, not from a container restart.

## Configuring the agent

Two ways to set the agent config, and the choice matters for which environment you test.

1. **Per-request override.** Put the whole agent config inside the `/invoke` request body
   under `data.parameters.agent`. Fast, stateless, no commit. This is how the service paths
   (E1, E2, E3) are driven. The prior `feature-matrix-test.md` run used this.
2. **Committed revision.** Edit the agent variant in Agenta and commit a revision. The
   config persists and the SDK can pull it by app slug plus variant. The local SDK path
   (E4) needs this, because the whole point of E4 is to pull the real stored config and run
   it off-platform.

Drive E1/E2/E3 with per-request overrides for speed. For E4, commit the config under test to
a variant first, then point the SDK script at it.

## Running each environment

### Service paths (E1, E2, E3)

```bash
KEY=<AGENTA_API_KEY>
PROJ=<project_id>
curl -s -X POST \
  -H "Authorization: ApiKey $KEY" -H "content-type: application/json" \
  "http://localhost:8280/services/agent/v0/invoke?project_id=$PROJ" \
  -d '{"data":{"inputs":{"messages":[{"role":"user","content":"<prompt>"}]},
       "parameters":{"agent":{ <agent config: agents_md, model, harness, sandbox,
       tools, mcp_servers, permission_policy, harness_options> }}}}'
```

The response is one JSON assistant message. That makes pass and fail easy to assert: grep
the reply for the token the scenario asked the agent to produce. The response also carries
`span_id` and `trace_id`.

Switch runtime for E1 vs E2/E3 (restore `rivet` after a `pi` phase):

```bash
D=hosting/docker-compose/ee
ENV_FILE=.env.ee.dev.local DOCKER_NETWORK_MODE=bridge AGENTA_AGENT_RUNTIME=pi \
  docker compose -p agenta-ee-dev-wp-b2-rendering -f $D/docker-compose.dev.yml \
  --env-file $D/.env.ee.dev.local up -d --no-deps --force-recreate services
```

Confirm the active path in the sidecar logs:

```bash
docker logs --tail 50 agenta-ee-dev-wp-b2-rendering-agent-pi-1 2>&1 | grep -E 'pi-wrapper|rivet-wrapper'
```

### Local SDK path (E4)

Write a `uv run` script (per repo convention, inline `# /// script` deps) that:

1. Pulls the committed agent config from Agenta with the SDK or the config API.
2. Builds a `SessionConfig` from it.
3. Picks a backend (`InProcessPiBackend()` for Pi/Agenta, `RivetBackend(sandbox=...)` for
   Claude or Daytona) and a harness with `make_harness`.
4. Runs `harness.setup()` then `harness.prompt(config, messages)` then `harness.cleanup()`.
5. Asserts the reply contains the scenario's expected token.

Keep these scripts under `qa/scripts/`. They double as the seed for E4 regression tests.

## The autohealing loop

For each valid cell in the matrix, in this order:

1. **Configure.** Set the agent config for the capability under test (per-request for
   E1/E2/E3, committed revision for E4). Set the environment (runtime + sandbox + harness).
2. **Run.** Send a message that forces the capability. For a tool, ask for something only
   the tool can answer. For a skill with code, ask for something only the script computes.
   For an MCP server, ask for something only that server exposes.
3. **Assert.** Check the reply for the expected token or side effect. A capability that is
   advertised but never invoked is a fail, not a pass. Where possible confirm the call
   happened (tool-call event, script output, file side effect), not just that the text looks
   right.
4. **Capture.** Save the request and the response under `qa/runs/<cell>.json`. This is the
   fixture seed.
5. **Record.** Update the matrix cell to pass, fail, or blocked. On a fail or a surprise,
   write a finding in `findings.md`.
6. **Triage** the finding with the decision tree below.
7. **Fix** the simple ones. Spin a subagent to implement, a second subagent to review, then
   re-run step 2 and 3 to confirm green. Commit the fix to the right PR or branch.
8. **Test.** When the cell is green and worth pinning, turn the captured fixture into a
   replayable regression test that does not call a live LLM.

## Triage decision tree

When a finding lands, classify it before touching code:

- **Fix now.** A missing or minor implementation with an obvious home. A stale doc. A small
  adapter gap. A wrong default. One clear file, no design question, no security surface.
  Spin a fixer subagent, then a reviewer subagent, then retest.
- **Defer to findings.** Real defect, but the fix needs a design decision, touches a
  security surface (secret handling, sandbox escape, auth), or spans several files with an
  unclear home. Leave a full entry in `findings.md` and move on. Do not guess at structure.
- **Escalate to user.** A repo restructure, a new public interface whose shape is a product
  decision, or anything that changes how a user configures an agent. Write the finding and
  raise it. Do not decide it alone.

When in doubt between fix-now and defer, defer. A wrong fix in a security-adjacent path
costs more than a deferred finding.

## Subagent roles

Keep each subagent's job narrow and hand it full context. It does not share your memory.

- **Fixer.** Gets one finding, the repro, the relevant files, and the acceptance check.
  Implements the smallest correct change. Returns a diff summary and the files touched.
- **Reviewer.** Gets the diff and the finding. Confirms the fix addresses the root cause,
  not the symptom, and introduces no regression. Returns approve or change-requests.
- **Test author.** Gets a captured fixture and the regression-test skill. Writes a
  replayable test that asserts the captured behavior without a live LLM. Returns the test
  file and the run command.
- **Researcher** (once, early). Gets the task of finding regression-test best practices for
  LLM-agent systems on the web and distilling them into the regression-test skill.

Every fixer is followed by a reviewer. Every fix is followed by a retest. No exceptions.

## Capturing tests without paying OpenAI

Most cells need a real LLM turn to run the first time. The regression test must not. The
strategy is record once, replay forever:

- The wire between the SDK and the runner is a JSON `/run` request and an NDJSON or JSON
  response. Capture both at the boundary. Replay the recorded response through a fake runner
  transport so the SDK and service code run for real while the LLM does not.
- The existing unit tests already fake the `Backend`, `Sandbox`, and `Session` ports and the
  runner transport. New regression tests extend that pattern with captured payloads instead
  of hand-written ones, so the fixtures match real runner output.
- Pin the wire shape with golden fixtures. The Python and TypeScript `/run` payloads must
  stay in sync. A captured request that no longer round-trips is a contract regression.

The regression-test skill (built in phase 3) holds the detailed pattern. Follow it so every
capture-and-replay test looks the same.

## Provenance for findings

Every finding in `findings.md` carries: status, date, commit and branch, the environment and
harness and capability it was found in, the exact repro, and the triage decision. Match the
`open-issues.md` format. A fixer should be able to act on the entry without this session's
context.
