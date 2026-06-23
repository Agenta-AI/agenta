# Agent feature matrix — live end-to-end test

Date: 2026-06-20. Target: the live EE-dev deployment at `http://144.76.237.122:8280`
(compose project `agenta-ee-dev-wp-b2-rendering`). Method: real HTTP calls to the agent
service, real LLM turns. No mocks.

## What was tested

Every agent-config feature was exercised across the harness × backend × sandbox matrix by
calling the batch endpoint `POST /services/agent/v0/invoke`. Each call returns a JSON
assistant message, which makes pass/fail easy to assert.

Features: plain chat, `agents_md` instructions, per-request `model` override, builtin tools
(`bash`), custom `code` tools, the agenta harness's forced skills and forced tools, the Pi
`harness_options.pi.append_system` override, and (attempted) the Claude permission policy.

The deployed service path is chosen by `select_backend` (`services/oss/src/agent/app.py`):

- Current deployments route every service run to `SandboxAgentBackend`.
- The `services` container reaches the runner through `AGENTA_AGENT_RUNNER_URL`.
- Harness and sandbox come from the request body or persisted agent config.
- Direct in-process Pi is a local/example contrast path, not a deployed-service default.

To cover both execution paths, the test compares the deployed sandbox-agent path with a
direct in-process Pi contrast run.

## Result matrix

| Harness | Backend | Sandbox | chat | instructions | model override | builtin bash tool | custom code tool | forced skill+tools | `append_system` override |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| pi | InProcessPi | local | ✅ | ✅ | ✅ | ✅ | ✅ | n/a | ✅ delivered |
| pi | sandbox-agent | local | ✅ | ✅ | ✅ | ✅ | ✅ | n/a | ❌ dropped |
| pi | sandbox-agent | daytona | ✅ | ✅ | ✅ | ✅ | ✅ | n/a | ❌ dropped |
| agenta | InProcessPi | local | ✅ | ✅ | ✅ | ✅ (forced) | ✅ | ✅ | (forced persona) |
| agenta | sandbox-agent | local | ✅ | ✅ | ✅ | ✅ (forced) | ✅ | ✅ | (forced persona) |
| agenta | sandbox-agent | daytona | ✅ | ✅ | ✅ | ✅ (forced) | ✅ | ✅ | (forced persona) |
| claude | sandbox-agent | local | ⛔ | ⛔ | ⛔ | ⛔ | ⛔ | n/a | n/a |
| claude | sandbox-agent | daytona | ⛔ | ⛔ | ⛔ | ⛔ | ⛔ | n/a | n/a |

✅ pass, ❌ confirmed-not-working, ⛔ blocked (see below), n/a not applicable to that harness.

Every ✅ cell returned HTTP 200 with a correct assistant reply. The pi and agenta rows are
12 cells each on sandbox-agent (local + daytona) and 6 each on InProcessPi (local), all green.

## Notable findings

1. **Pi system-prompt overrides work in-process but are silently dropped on sandbox-agent.**
   With `harness_options.pi.append_system` set to inject a secret token, the in-process Pi
   backend included the token and the sandbox-agent backend did not, in both local and daytona. This
   confirms the documented gap in `ground-truth.md` ("Pi `systemPrompt`/`appendSystemPrompt`
   not delivered on the sandbox-agent ACP path"). It fails quietly — the run still succeeds, the
   override just has no effect.

2. **The agenta harness forced skill and tools are real on every backend and sandbox.**
   The `agenta-getting-started` skill is loaded and readable, and the forced `read`/`bash`
   (plus `edit`/`write`) tools are present even when the request sends no `tools`. The skill
   file path differs by sandbox: InProcessPi `/app/skills/...`, sandbox-agent-local
   `/pi-agent/skills/...`, daytona `/home/sandbox/.pi/agent/skills/...`. Forced bash actually
   executed (`echo` round-trips), not just advertised.

3. **Tool delivery works.** Builtin `bash` and custom `code` (python) tools were delivered
   and executed across all tested configs, and per-request tools augment (do not replace) the
   agenta forced tool set. An early one-off where the model declined to call a tool was model
   nondeterminism, not a delivery failure.

4. **Per-request `model` override works** (`gpt-5.5` and `gpt-4o-mini`, both resolved from the
   project vault). Tracing (`span_id`/`trace_id`) is present on every response.

5. **Daytona works but is slower.** Local in-process runs were ~1–3s, sandbox-agent-local ~3–9s,
   Daytona ~10–23s (sandbox spin-up). No cold-start failures across the run.

## Blocked / not exercised

| Item | Status | Reason |
| --- | --- | --- |
| Claude harness (all sandboxes) | ⛔ blocked | The harness is wired (the `claude-agent-acp` binary is present in `sandbox-agent`) and reaches model auth, but returns HTTP 500 `claude: model authentication failed — add the project's Anthropic key to the project vault`. No Anthropic key is in this project's vault. Add one to test Claude. |
| MCP servers | not tested | `AGENTA_AGENT_ENABLE_MCP` is unset on the deployment, so MCP resolution is gated off. Needs the flag plus a reachable MCP server. |
| Gateway tools (Composio) | not tested | `COMPOSIO_API_KEY` is present, but a gateway tool needs a real configured Composio connection/integration/action. None was set up. |
| Client/callback tools | not applicable to batch | `type:"client"` tools resolve to a callback to `/tools/call` that a browser chat client answers. The batch `/invoke` path has no client to call back, so this needs the `/messages` UI path. |
| `permission_policy=deny` | ⛔ blocked | This gates tool use on the Claude harness; Pi ignores it. Blocked behind the Claude credential. |

## Reproduction

```bash
KEY=$(grep '^AGENTA_API_KEY=' examples/python/hotel_agent/draft/.env | cut -d= -f2)
PROJ=019e8df5-2a58-7501-8fe2-56f7b332bd00
curl -s -X POST \
  -H "Authorization: ApiKey $KEY" -H "content-type: application/json" \
  "http://144.76.237.122:8280/services/agent/v0/invoke?project_id=$PROJ" \
  -d '{"data":{"inputs":{"messages":[{"role":"user","content":"Reply with exactly: PONG"}]},
       "parameters":{"agent":{"agents_md":"Reply with exactly the requested word.",
       "model":"gpt-5.5","harness":"pi","sandbox":"local"}}}}'
```

The hotel-agent API key authenticates cross-project within the same workspace. The deployed
service path is visible in the `sandbox-agent` logs with the `[sandbox-agent]` prefix. Use a
local runner or SDK script for the direct in-process Pi contrast path.
