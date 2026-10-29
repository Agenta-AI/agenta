# Implementation plan

> AGENT-GENERATED, low weight. This is a draft. Mahmoud must approve product and interface decisions.

## Recommended order

### Define the runner status check

Create a small detector for each harness. Each detector returns an allowed state. It never returns
file data.

Files:

- `services/runner/src/subscription-status.ts` for detector logic and response types.
- `services/runner/src/server.ts` for `GET /subscription-status` and runner-token authentication.
- `services/runner/tests/unit/subscription-status.test.ts` for filesystem and redaction tests.
- `services/runner/tests/unit/server.test.ts` for route authentication and response tests.

### Add the server-to-runner client

Add a Python client that calls the private runner endpoint. Reuse the internal runner URL and token.
Validate the runner response before it reaches the public route.

Put runner selection in one resolver. Both the status request and the model run must call this
resolver. The first version can resolve only the deployment runner. A cloud version can later
resolve a server-owned runner connection ID. Never accept an arbitrary runner URL from the browser.

Candidate files:

- `services/oss/src/agent/config.py` only if a shared timeout setting is required.
- `services/oss/src/agent/runtime_status.py` for the HTTP client and response mapping.
- `services/oss/src/agent/app.py` for `POST /runtime/subscription-status`.
- `services/oss/tests/` for connected, unavailable, incompatible, and invalid-response tests.

If the team selects the main FastAPI API for the public route, place the client beside
`api/oss/src/core/sessions/streams/runner_client.py` and add a small runtime router under
`api/oss/src/apis/fastapi/`. Do not implement both public routes.

### Add the frontend API boundary

Add the public response type and its runtime schema check. Follow the frontend rule that new main
API calls use the generated client. A direct agent-service route can use the existing service URL
pattern until the endpoint moves into the main API.

Candidate files:

- `web/packages/agenta-entities/src/workflow/api/api.ts` for a direct agent-service function, or a
  new runtime entity module if the main API owns the route.
- `web/packages/agenta-entities/src/workflow/state/subscriptionStatus.ts` for the query atom.
- `web/packages/agenta-entities/src/workflow/state/index.ts` and
  `web/packages/agenta-entities/src/workflow/index.ts` for exports.
- Unit tests beside the new API and state code.

### Connect the query to the subscription card

Resolve the selected harness in `useModelHarness.tsx`. Read the new status query only when the
selected connection mode is `self_managed`. Pass one display-ready status to the credentials
section.

Files:

- `web/packages/agenta-entity-ui/src/DrillInView/SchemaControls/agentTemplate/useModelHarness.tsx`
- `web/packages/agenta-entity-ui/src/DrillInView/SchemaControls/agentTemplate/ProviderCredentialsSection.tsx`
- Component tests for every visible state.

### Add compatibility and telemetry

Treat runner HTTP 404 as `incompatible`. Treat network failure as `unavailable`. Do not log response
bodies from a failed detector.

Record status counts without user or token data. Useful fields are runner state, harness, status,
and runner version.

### Update setup documentation

Explain the new status messages in the existing subscription runner guide. Keep the mounted-folder
instructions because the detection does not replace the mount.

## Delivery split

The work can use three dependent changes:

1. Runner endpoint and tests.
2. Public server endpoint and tests.
3. Frontend query, card states, and documentation.

Do not ship the frontend state before the public endpoint exists. An old runner remains safe because
the server maps a missing runner endpoint to `incompatible`.

## Approval required

Mahmoud must approve the public route location and the visible words before implementation starts.
