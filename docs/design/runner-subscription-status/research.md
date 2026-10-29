# Research

> AGENT-GENERATED, low weight. This is a draft. Mahmoud must approve product and interface decisions.

## Observations

These statements describe the current code.

### The frontend does not contact the runner

The Python agent service reads `AGENTA_RUNNER_INTERNAL_URL` and uses it to contact the runner. The
frontend contacts the agent service through the gateway. The runner port stays private.

Evidence:

- `services/oss/src/agent/config.py` defines `runner_url()`.
- `sdks/python/agenta/sdk/agents/utils/ts_runner.py` sends authenticated HTTP requests to the runner.
- `docs/design/agent-workflows/documentation/running-the-agent.md` states that the frontend talks to
  the agent through the gateway.

### The current runner route is deployment-wide

The current backend selects the runner from `AGENTA_RUNNER_INTERNAL_URL`. The agent configuration
can select `runner.kind: sidecar`, but it does not carry a per-user runner connection or URL.

Evidence:

- `sdks/python/agenta/sdk/agents/handler.py` selects the backend from
  `AGENTA_RUNNER_INTERNAL_URL`.
- `sdks/python/agenta/sdk/utils/types.py` defines the current runner configuration.

This means the current code can report the status of the deployment runner. It cannot select one
runner for each Agenta Cloud user. Per-user cloud runners need a separate server-owned connection
reference and routing feature.

### The runner already knows the required login location

For a local subscription run, `run-plan.ts` selects one environment variable for each harness:

| Harness | Runner environment variable |
| --- | --- |
| Codex | `CODEX_HOME` |
| Claude Code | `CLAUDE_CONFIG_DIR` |
| Pi | `PI_CODING_AGENT_DIR` |

The runner stops the run if the required variable is not set. This check happens only after the user
starts a run.

Evidence: `services/runner/src/engines/sandbox_agent/run-plan.ts`.

### The runner can check a login file without returning the file

Codex subscription mode uses `CODEX_HOME/auth.json`. The runner already checks whether this file is
empty or unreadable when it explains an authentication failure.

Evidence: `services/runner/src/engines/sandbox_agent/codex-assets.ts`.

### The runner health response has no login status

`GET /health` returns the runner version, protocol version, engines, and harnesses. It does not
return subscription login status. The route is also available without the runner token.

Evidence: `services/runner/src/server.ts`.

### The frontend has a static harness catalog

The frontend reads `GET /workflows/catalog/harnesses/` to learn which models, providers, and
connection modes each harness supports. The frontend stores this result for five minutes and also
persists it in the browser.

This catalog describes product capability. It does not describe the current runner process.

Evidence:

- `api/oss/src/apis/fastapi/workflows/router.py`
- `web/packages/agenta-entities/src/workflow/state/inspectMeta.ts`
- `web/packages/agenta-entities/src/workflow/api/api.ts`

### The current subscription card has no live status

`ProviderCredentialsSection.tsx` shows a static self-managed card. It receives the selected mode and
cloud flag. It does not read runner state.

Evidence:
`web/packages/agenta-entity-ui/src/DrillInView/SchemaControls/agentTemplate/ProviderCredentialsSection.tsx`.

## Interpretation

These are low-confidence design conclusions. They are not confirmed product decisions.

The shortest safe path is to add a private runner endpoint and proxy its sanitized result through
the Python agent service. This path uses the same private runner URL and runner token as model runs.
It does not give the browser access to the runner.

The status request must use the same runner resolver as the model run. Otherwise, the frontend can
show the status of one runner and send the model run to another runner.

The static harness catalog is not a suitable path. The catalog is global and durable. Runner status
is local and can change at any time.

## Important limit

A file check proves only that the runner can read a file with the expected shape. It does not prove
that the token is current or that the subscription can use the selected model. Only a successful
run proves provider access.
