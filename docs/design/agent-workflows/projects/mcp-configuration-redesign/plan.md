# Implementation plan

## Dependency order

```text
Live trace ───────────────────────────────┐
                                         v
Author contract -> capability gate -> no-secret Claude acceptance -> discovery and policy
       |                                      |                              |
       v                                      v                              v
pre-prod migration                      local + Daytona                 gateway seam -> Pi
                                                                              |
                                                                              v
                                                                         credentials
```

## Slice 0: Reproduce the enabled Claude failure

This is the first gate because the static code path already claims to work.

1. Identify the exact live deployment, service container, revision, harness, and sandbox provider
   used in the reported run.
2. Confirm the effective service flag inside that process, not only deployment configuration.
3. Save a no-secret HTTPS MCP server with a distinctive name.
4. Capture the invoked revision's `agent.mcps`.
5. Capture the service-resolved `/run.mcpServers` without logging headers.
6. Capture runner `sessionInit.mcpServers` and confirm the external entry is distinct from
   `agenta-tools`.
7. Query or instrument Claude's MCP status after initialization.
8. Classify the first missing boundary and write a regression test before fixing it.

Exit: one root cause with reproducible evidence, or a proven successful connection with the UI
diagnostic gap isolated.

## Slice 1: Clean the public contract

This slice fixes the interface without expanding runtime capability.

1. Add version 2 author models for remote HTTP connection, credentials, and policy.
2. Add a single v1-to-v2 normalization boundary.
3. Remove stdio, command, arguments, and environment from the version 2 public model.
4. Keep the private internal `McpServerStdio` runner type unchanged.
5. Split author and resolved types. Mark secret-bearing resolved fields non-repr and non-loggable.
6. Make tool policy explicit as `all` or `include`.
7. Reserve `agenta-tools` in author validation.
8. Update built-in authoring descriptions and generated schema fixtures.

Exit: new saves emit only version 2; all schema and normalization tests pass; unsupported stdio is
not representable in version 2.

## Slice 2: Clean and gate the UI

This slice also avoids claiming new functionality.

1. Publish the effective `mcp.user_servers` capability through inspect/catalog metadata.
2. Fail closed when the capability is absent, false, or still loading.
3. Never count or render the internal `agenta-tools` server.
4. Replace the transport form with server name, remote MCP URL, credentials type, tool policy,
   and permission.
5. For the initial deployment capability, allow only credentials `None`.
6. Remove Environment, command, arguments, and manual tool-name tags.
7. If a legacy entry exists during the migration window, show a read-only unsupported notice or
   migrate it. Do not silently reinterpret stdio.
8. Add UI unit tests for capability gating, version 2 editing, and hidden legacy controls.

Exit: the UI accurately represents current deployment support and cannot create a config that the
runner rejects merely because it is stdio.

## Slice 3: Make no-secret Claude remote MCP observable and reliable

1. Fix the boundary found in Slice 0.
2. Add structured, redacted correlation from saved server name through service, runner, and ACP.
3. Surface Claude MCP connection state after session initialization.
4. Return a specific run error if a required MCP server fails to connect, or explicitly model
   optional servers later. Do not silently continue as if the server worked.
5. Add local and Daytona acceptance tests against a deterministic no-auth MCP fixture.

Exit: Claude local and Claude Daytona both reach the fixture, list at least one tool, call it, and
show a concrete error for an invalid endpoint.

## Slice 4: Connect, discover, and enforce tool policy

1. Add a service-owned test-connection endpoint using the same MCP client behavior as execution.
2. Return safe status, server identity, negotiated protocol version, and discovered tool schemas.
3. Populate the tool selector from discovery, not user-entered tags.
4. Enforce `all` or `include` in the execution adapter for `tools/list` and `tools/call`.
5. Handle tool-list changes by showing missing selections and requiring an explicit save decision.

Exit: the UI can prove connectivity before a chat run, and excluded tools cannot be called.

## Slice 5: Gateway seam and Pi projection

1. Define an internal gateway registration from the unchanged version 2 author config.
2. Let the gateway own upstream initialization, discovery, filtering, calls, and errors.
3. Project gateway MCP tools onto the existing common Agenta tool plane.
4. Feed that plane to Claude and Pi using their existing harness-specific delivery mechanisms.
5. Run the full harness and backend matrix.

Exit: moving a server from direct Claude delivery to gateway delivery does not change its saved
config, and Pi can execute the same allowed tools.

## Slice 6: Credentials

1. Enable static header secret references only after the no-secret path is accepted.
2. Keep values in the gateway for the long-run path.
3. For an explicitly interim direct Daytona path, evaluate the opaque placeholder work against the
   version 2 credential model and host restriction requirements.
4. Do not claim equivalent safety for local direct Claude while plaintext enters the process.
5. Add `oauth_connection` only with a platform connection resource that owns token refresh,
   scopes, revocation, and callback state.

Exit: no saved config or inspect response contains a raw credential, and the supported runtime
boundary is documented per backend.

## Reviewable PR sequence

1. `docs(mcp): lock public config and capability contracts`
2. `refactor(sdk): add MCP v2 author model and pre-production migration`
3. `fix(frontend): gate and simplify the MCP editor`
4. `fix(agent): trace and repair Claude remote MCP delivery`
5. `feat(mcp): add connection discovery and tool policy enforcement`
6. `feat(mcp): route external MCP through the gateway`
7. `feat(mcp): add connection-backed credentials`

Each PR should preserve the full build while keeping future-only gateway behavior behind the
capability contract.

