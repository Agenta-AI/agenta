# QA plan

## Contract parity

For the same resolved model or HTTP MCP consumer, assert that local and Daytona accept the same
consumer-owned contract.

- Local materializes plaintext only into the selected harness subprocess or MCP header.
- Daytona materializes a placeholder and never copies an isolated value to `envVars` or ACP
  plaintext.
- Model destination derives from the effective endpoint.
- HTTP MCP destination derives from the validated server URL.
- Non-secret configuration never becomes a Daytona Secret.
- Missing values, empty values, resolution errors, unknown usage, and missing routes fail before
  sandbox creation.

## Plaintext absence

Use a unique random marker for every credential and search for it in:

- environment APIs and `/proc` process environments;
- process arguments and listings;
- ACP session configuration and debug output;
- uploaded files, settings, shell history, and durable mounts;
- sandbox-agent, harness, runner, and application logs;
- traces, errors, responses, and persisted session or lease state.

The placeholder may appear only where the consumer needs it. Logs must not contain placeholders,
vault slugs, Daytona Secret names, or full create payloads.

## Network substitution

| Case | Expected result |
|---|---|
| Exact allowlisted HTTPS host | Host receives plaintext; sandbox sees placeholder. |
| Different host | Placeholder or rejected request; never plaintext. |
| Subdomain | No plaintext. |
| Any wildcard declaration | Rejected before Secret creation. |
| Redirect to another host | Redirect target never receives plaintext. |
| Non-HTTPS URL | Rejected before Secret creation. |
| IP literal, localhost, or metadata address | Rejected before Secret creation. |
| Alternate port | Live result documented; policy never broadens beyond the host. |
| DNS change or rebinding | No plaintext outside the approved TLS host boundary. |

Run the matrix for an environment-backed model key and a placeholder passed directly in an HTTP
MCP header.

## Provider and credential matrix

| Credential | Expected mode |
|---|---|
| OpenAI and Anthropic direct API keys | Isolated |
| One additional direct header-key provider | Isolated |
| Azure OpenAI API key with configured endpoint | Isolated |
| Custom OpenAI-compatible key with configured endpoint | Isolated |
| HTTP MCP authorization header | Isolated if the Phase 0 header path passes |
| Bedrock bearer token | Candidate isolated mode; live regional-host proof required |
| AWS SigV4 access-key triple | Explicit non-isolated mode or rejected by strict policy |
| Vertex service-account or ADC configuration | Explicit non-isolated mode or rejected by strict policy |
| Vertex API key | Out of first scope unless the connection contract adds it explicitly |
| Private key, signing seed, JSON parsed locally | Non-isolated unsupported; never proxy-claimed |
| Self-managed subscription OAuth | Unchanged and outside this feature's isolation claim |

## Custom-secret resolution

- A selected HTTP MCP secret resolves only its requested name.
- Missing name, empty resolved value, authorization failure, and resolver transport failure abort
  before runner dispatch and sandbox creation.
- A project secret requested by no selected consumer is never resolved.
- The old MCP `env` merge cannot erase the distinction between non-secret headers and credential
  headers.
- A generic agent-wide secret list is rejected.

## Lifecycle and cleanup

- Complete Secret creation, sandbox creation, run, delete, and Secret cleanup.
- Partial multi-Secret creation failure with compensation.
- Sandbox creation or daemon start failure after Secret creation.
- Stop and resume with the same lease.
- Manual archive is treated as existing, not orphaned.
- Credential-epoch mismatch deletes the old sandbox and lease and creates fresh.
- Runner termination before and after each persistence boundary.
- Daytona auto-delete without runner teardown.
- Secret deletion retry and two cleanup workers racing.
- Listing beyond one SDK page or response limit.
- An administrator-widened host list is restored to the exact approved set before any later
  in-place rotation path proceeds.

## Dependency and regression checks

- Runner `pnpm test` and TypeScript typecheck.
- Python SDK agent contract tests.
- Exact `@daytona/sdk` lockfile version and no production `@daytonaio/sdk` duplicate.
- Existing create, preview, process, upload, mount, pause, reconnect, delete, timer, and network
  policy tests.
- Live Pi and Claude Daytona smoke runs where supported.
- Unsupported self-hosted control plane fails startup capability validation.

## Control-plane isolation

- Production uses the approved dedicated organization boundary or records explicit blast-radius
  acceptance.
- The runner credential has only required Daytona permissions.
- Secret reads and audit events never return plaintext.
- `DAYTONA_API_KEY`, Agenta/session authorization, OTLP authorization, and internal relay
  credentials never enter a Daytona Secret or sandbox payload.

## Acceptance bar

Unit tests are not sufficient. Release requires the Phase 0 adversarial live matrix, disposable
provider and MCP credentials, a deliberate runner-kill cleanup test, and zero Daytona sandboxes and
Agenta-owned Secrets left after the test.
