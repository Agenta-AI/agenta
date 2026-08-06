# Implementation plan

## Scope now

Slices 0 through 2 are one breaking pre-production cleanup. There is no feature flag, legacy
decoder, dual write, or saved-config migration.

## Slice 0: Pin the real delivery path

1. Keep external user MCP separate from the private `agenta-tools` channel.
2. Prove the service resolves saved `agent.mcps` into `/run.mcpServers`.
3. Prove the runner converts the resolved HTTP server into Claude ACP `sessionInit.mcpServers`.
4. Preserve URL validation, SSRF protection, redaction, and reserved-name checks.
5. Cover local and Daytona session layering with unit tests.

Exit: the static delivery path is pinned by tests. A live endpoint failure can be located without
confusing it with config gating or internal tools.

## Slice 1: Replace the public contract

1. Replace the flat transport object with `name`, `connection`, and `policy`.
2. Support only external HTTP connections. Remove public stdio, command, arguments, environment,
   and ambiguous flat tool lists.
3. Keep `credentials` as a discriminated object under `connection`.
4. Split saved author intent from the secret-bearing resolved run object.
5. Reserve `agenta-tools` in author validation.
6. Reject every old object as invalid. Development drafts must be recreated.

Exit: the old public shape is not representable or accepted.

## Slice 2: Make the UI truthful

1. Publish `mcp.user_servers` in the runtime harness catalog only for harnesses that work.
2. Show the MCP editor only when the selected harness publishes that capability.
3. Do not add a browser environment variable or deployment feature flag.
4. Show server name, HTTP URL, public headers, and the credential strategy.
5. Remove transport, command, arguments, environment, and manual exposed-tool controls.
6. Never show or count the internal `agenta-tools` channel.
7. Test fail-closed capability behavior and request serialization.

Cloud uses the same service capability document as local development. `agenta_cloud` does not
need a separate MCP environment variable.

Exit: Claude shows the editor; Pi and missing capability metadata do not. The UI cannot author a
public stdio process or the old flat object.

## Slice 2.1: Claude acceptance

Claude already accepts external HTTP MCP entries through ACP session initialization. This slice
does not change ACP. After slices 0 through 2 land:

1. Run a no-secret HTTPS MCP fixture on Claude local.
2. Run the same fixture on Claude Daytona.
3. Verify the server is delivered, lists a tool, and the tool can be called.
4. Record the first failed boundary if the reported live deployment still fails.

Exit: the no-secret Claude path works in both environments or has one evidenced runtime defect.

## Slice 2.2: Pi support

Pi is the next implementation slice, not a distant gateway phase. Pi is not currently an MCP
client in this runtime, so a separate plan must choose the smallest bridge from external MCP tools
onto Pi's existing tool plane. That decision must compare a runner MCP client with the future MCP
gateway and avoid changing the saved author object.

Exit: a dedicated design PR specifies and tests Pi local and Daytona delivery.

## Slice 3: Product features

Create a separate plan-feature draft PR for connection testing, discovery, status, tool selection,
policy enforcement, credentials, OAuth, and the long-run gateway boundary. Do not mix those
features into the contract/UI cleanup.

## PR sequence

1. Update the accepted design with the breaking-reset and capability-source decisions.
2. Implement slices 0 through 2 in one reviewable PR.
3. Verify Claude in slice 2.1.
4. Open the slice 2.2 Pi design PR.
5. Open the separate slice 3 feature-plan draft PR.
