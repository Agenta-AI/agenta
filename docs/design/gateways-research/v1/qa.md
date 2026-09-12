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
2. Give the agent a gateway LLM route. **Use the `custom` namespace, not a builtin route.** The
   builtin mock providers are generated in development only and production never lists them
   (`mocks.md`), so the dashboard is not meant to offer them: the model picker has no
   `builtin/mock` or `builtin/agenta` entry and `Add provider` offers the real providers plus
   `OpenAI-compatible endpoint`. Treat the builtin routes as the HTTP-level precondition proved in
   step 3 of the preconditions, and point a custom endpoint at the compose mock LLM service for
   this step. It still traverses browser → API → runner → harness → gateway, which is what this
   procedure is for.

   **Create one provider per protocol you intend to test.** A harness accepts or refuses the run on
   the endpoint's declared `provider_key`, which the provider form's protocol field sets: Claude
   Code needs `anthropic` and an Anthropic-protocol model, and refuses an `openai` endpoint with
   `422 provider 'openai' is not supported by harness 'claude'`. The `Harnesses` control disables
   the harnesses a declared protocol cannot serve, so an unrunnable pair is no longer offerable.
   Codex is offered on an OpenAI-compatible endpoint, but the model pin that lets it accept a
   gateway model key is runner and SDK work and has not shipped (OR31d), so record its refusal.

   Save a provider in Settings / AI providers with its protocol declared and the harnesses you
   intend to test enabled. That writes a `custom_provider` secret and registers the matching gateway
   endpoint under the same slug (OR26). Confirm it with
   `POST /api/gateways/llms/endpoints/query`, which must return one row per provider.

   If a stack predates that change, the endpoint can still be created by hand. Take the secret's id
   from `GET /api/vault/v1/secrets/`, then, from the signed-in dashboard so the request carries your
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

   Set `provider_key` in the endpoint body to the protocol the harness needs. Editing the provider
   in the dashboard afterwards heals the row either way, because registration is an upsert on the
   slug.

   Then use a prompt that produces an unmistakable echo response, for example
   `Reply with exactly: gateway-live-qa`.

3. Run it from the dashboard. Record the run link/id and confirm the response is exactly the
   expected mock response. This proves the browser → API → runner → harness → gateway path.
4. Add an MCP server pointed at the mock MCP route — `<AGENTA_API_URL>/gateways/mcps/builtin/mock/mock`
   — and ask the agent to call its `echo` tool with a unique marker. There is no builtin MCP
   catalogue to select from: `Add MCP server` is a free-form name, URL and authentication form.

   **Two preconditions, or the cell fails for a reason that is not the product.** The mock only
   echoes a prompt carrying an acceptance marker matching `MCP-ACCEPTANCE-[A-Za-z0-9_-]+`, which is
   what `_mcp_marker` in the mock adapter reads; a plain-English prompt gets no echo back. And on
   the Anthropic Messages path the server must be **named `mock-mcp`**, because
   `_default_mcp_echo_tool` returns the hardcoded tool name `mcp__mock-mcp__echo` for that protocol,
   so a server under any other name exposes a tool the harness cannot call.

   The cell passes when the `tools/call` reaches the mock and the assistant turn ends with the
   mock's round-trip confirmation, `mock MCP echo: <marker>`. A server whose handshake fails now
   rides an `mcp_server_failed` notice rather than vanishing (OR32). Automated acceptance covers
   this interaction for all three harnesses; record the live result as product-path evidence.
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
| Pi | echo response, on a custom endpoint of either protocol | echo tool result | record all visible fields | run link/id + screenshot |
| Claude Code | echo response, on a custom endpoint declaring `anthropic` | echo tool result | record all visible fields | run link/id + screenshot |
| Codex | no pass is available yet: it refuses a model id nobody declared to it, and the config pin that fixes this is runner and SDK work (OR31d). Record the refusal. | echo tool result | record all visible fields | run link/id + screenshot |

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
