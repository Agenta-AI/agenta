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

2. Read `AGENTA_WEB_URL` from `hosting/docker-compose/ee/.env.ee.dev` and open it in a browser.
   Sign in to the local development deployment and create a disposable project named
   `gateway-harness-qa-<date>`.

3. First establish the automated baseline. It must pass before manual QA begins:

   ```bash
   bash hosting/docker-compose/test.sh --ee --dev --api -a -- \
     oss/tests/pytest/acceptance/gateways/test_gateway_mock_matrix_acceptance.py
   ```

   This proves the eight mock rows: LLM builtin `agenta`, LLM builtin `mock`, LLM standard
   `mock`, LLM custom mock; MCP builtin `agenta`, MCP builtin `mock`, MCP standard `mock`, and
   MCP custom mock.

## Dashboard procedure

Use the dashboard's managed-agent creation and run flow. For each harness available in the
deployment — **Pi**, **Claude Code**, and **Codex** — create an otherwise identical disposable
agent/run configuration:

1. Select that harness in the dashboard. Record its displayed version and login/connection state.
2. Select the local builtin LLM mock route (`builtin/mock`) and use a prompt that produces an
   unmistakable echo response, for example `Reply with exactly: gateway-live-qa`.
3. Run it from the dashboard. Record the run link/id and confirm the response is exactly the
   expected mock response. This proves the browser → API → runner → harness → gateway path.
4. For Claude Code and Codex, repeat with the local builtin MCP mock (`builtin/mock`) and ask the
   agent to invoke its `echo` tool with `gateway-live-qa`. Confirm the tool result is shown in the
   run transcript. Pi cannot yet receive an author-supplied external MCP server; WP34 must land
   before this step applies to Pi.
5. Induce a **typed gateway refusal** using the dashboard-supported configuration — preferably a
   missing/disabled endpoint or an endpoint for which the selected project lacks permission. Do
   not use an arbitrary upstream failure: that is intentionally forwarded as `upstream_error`.
6. In the run transcript and any visible interaction UI, record whether the failure exposes:
   `code`, human message, `retryable`, `next_step`, and `details`. Capture a screenshot and the
   run link/id. Redact credentials and cookies.

## Harness acceptance table

| Harness | Happy LLM | Happy MCP | Typed refusal surfaced | Required evidence |
| --- | --- | --- | --- | --- |
| Pi | echo response | unavailable until WP34 | record all visible fields | run link/id + screenshot |
| Claude Code | echo response | `echo` tool result | record all visible fields | run link/id + screenshot |
| Codex | echo response | `echo` tool result | record all visible fields | run link/id + screenshot |

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
