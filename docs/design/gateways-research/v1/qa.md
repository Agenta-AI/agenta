# Gateway live-web QA

This is the manual complement to the mock acceptance matrix. It proves that a real managed-agent
run launched through the dashboard reaches the gateway and that each installed harness exposes a
typed gateway failure to the user. Do not replace this check with direct `curl`, a fixture, or an
API-only request: those prove the proxy, not the product path.

## Preconditions

1. In a fresh worktree, create the EE development environment and start it:

   ```bash
   bash hosting/docker-compose/env.sh --ee --dev
   bash hosting/docker-compose/run.sh --ee --dev --build --nuke
   ```

   Set `AGENTA_GATEWAYS_MOCKS_ENABLED=true` in the env file before starting, or the mock
   catalogue and the mock routes do not exist. On a deployment served over plain HTTP, also set
   `AGENTA_GATEWAYS_INSECURE_HTTP_ALLOWED=true`: the SDK in the `services` container and the
   runner both read it, and without it every gateway resolution is refused (OR24). Setting both in
   the env file reaches every service, which the compose files alone do not.

2. Read `AGENTA_WEB_URL` from `hosting/docker-compose/ee/.env.ee.dev` and open it in a browser.
   Sign in to the local development deployment and create a disposable project named
   `gateway-harness-qa-<date>`.

3. First establish the automated baseline. It must pass before manual QA begins:

   ```bash
   bash hosting/docker-compose/test.sh --ee --dev --api -a -- \
     oss/tests/pytest/acceptance/gateways/test_gateway_mock_matrix_acceptance.py
   ```

   This proves the seven mock-backed rows: LLM builtin `agenta`, LLM builtin `mock`, LLM standard
   `mock`, LLM custom mock; MCP builtin `mock`, MCP standard `mock`, and MCP custom mock.
   `builtin/agenta/run` is not a mock route: it requires an invocation-scoped credential and is
   verified through an agent/runner run with an existing Agenta callback tool.

## Dashboard procedure

Use the dashboard's managed-agent creation and run flow. For each harness available in the
deployment — **Pi**, **Claude Code**, and **Codex** — create an otherwise identical disposable
agent/run configuration:

1. Select that harness in the dashboard. Record its displayed version and login/connection state.
2. Give the agent a gateway LLM route. **The builtin routes are not selectable in the dashboard in
   this increment** — the model picker has no `builtin/mock` or `builtin/agenta` entry, and
   Add provider offers only the real providers plus `OpenAI-compatible endpoint` (OR26). Use a
   custom OpenAI-compatible endpoint pointed at the compose mock LLM service instead. It still
   traverses browser → API → runner → harness → gateway, which is what this procedure is for.

   Save an `OpenAI-compatible endpoint` provider in Settings / AI providers, with the harnesses
   you intend to test enabled. That writes a `custom_provider` secret and **does not** create the
   gateway endpoint, so create it explicitly. Take the secret's id from
   `GET /api/vault/v1/secrets/`, then, from the signed-in dashboard so the request carries your
   session:

   ```js
   await fetch("/api/gateways/llms/endpoints/?project_id=<project-id>", {
     method: "POST",
     headers: {"Content-Type": "application/json"},
     body: JSON.stringify({
       endpoint: {
         slug: "gw-mock-llm-<suffix>",
         name: "gw-mock-llm",
         deployment_kind: "custom",
         secret_id: "<the custom_provider secret id>",
         flags: {is_active: true},
         data: {
           route: {base_url: "http://mock-llm-gateway:9091/v1"},
           models: {allowlist: ["mock/echo"]},
         },
       },
     }),
   });
   ```

   Confirm `POST /api/gateways/llms/endpoints/query` now returns one row. Remove this step once
   OR26 is closed and the providers page registers the endpoint itself.

   Then use a prompt that produces an unmistakable echo response, for example
   `Reply with exactly: gateway-live-qa`.

3. Run it from the dashboard. Record the run link/id and confirm the response is exactly the
   expected mock response. This proves the browser → API → runner → harness → gateway path.
4. Add an MCP server pointed at the mock MCP route — `<AGENTA_API_URL>/gateways/mcps/builtin/mock/mock`
   — and ask the agent to call its `echo` tool with a unique marker. There is no builtin MCP
   catalogue to select from: `Add MCP server` is a free-form name, URL and authentication form. Two
   known defects gate this step today, so record what happens rather than expecting a pass. The
   supplied URL is discarded and the request goes out as `custom/<server name>`, which has no
   registered endpoint and returns `404`; and with Pi selected the configuration panel has no
   `MCP servers` row at all (OR31). Automated acceptance covers this interaction for Pi and Codex;
   record the live result as product-path evidence.
5. Add an existing Agenta callback tool and the builtin Agenta MCP server. Confirm the tool list is
   scoped to the run and that the selected callback can be invoked.
6. Induce a **typed gateway refusal** using the dashboard-supported configuration — preferably a
   missing/disabled endpoint or an endpoint for which the selected project lacks permission. Do
   not use an arbitrary upstream failure: that is intentionally forwarded as `upstream_error`.
7. In the run transcript and any visible interaction UI, record whether the failure exposes:
   `code`, human message, `retryable`, `next_step`, and `details`. Capture a screenshot and the
   run link/id. Redact credentials and cookies.

## Harness acceptance table

| Harness | Happy LLM | Happy MCP | Typed refusal surfaced | Required evidence |
| --- | --- | --- | --- | --- |
| Pi | echo response | echo tool result | record all visible fields | run link/id + screenshot |
| Claude Code | echo response | echo tool result | record all visible fields | run link/id + screenshot |
| Codex | echo response | echo tool result | record all visible fields | run link/id + screenshot |

The required invariant is that every harness preserves the human message and the machine-readable
gateway `code`. Pi or Claude Code may preserve the complete error envelope. Codex is expected to
preserve only `message` plus the embedded code marker, so absent `retryable`, `next_step`, and
`details` is acceptable only if the code reaches the UI and the UI offers the generic recovery
path.

## Result and follow-up

Record the date, worktree commit, compose project name, harness versions, run ids, screenshots,
and the field matrix above in the PR QA comment or release evidence. A failure to surface `code`
is a gateway/runner regression. A discrepancy in the richer fields is a harness-compatibility
finding and must be added to `open-reviews.md`; do not silently normalize it in the UI.

Delete the disposable project when the run is complete. Do not place screenshots, tokens, or raw
request headers in the repository.
