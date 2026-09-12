# Implementation plan

## Slice 0: Prove the adapter

1. Pin `pi-mcp-adapter@2.11.0`.
2. Package and load it beside the Agenta Pi extension.
3. Use an HTTPS fixture to list a server and call one tool.
4. Confirm no `pi-acp` upgrade is required.

Exit: the pinned upstream adapter works in headless Pi. If bundling fails, ship its package tree.
Do not implement an MCP client.

## Slice 1: Render shared resolved servers

1. Add a pure `ResolvedMCPServer[]` to `PiMcpAdapterConfig` renderer.
2. Reuse URL, reserved-name, and SSRF validation.
3. Accept only HTTP, `tools.mode = all`, and current credential outcomes.
4. Set proxy mode, lazy lifecycle, no resources, sampling, or elicitation.
5. Keep headers out of errors and logs.

Exit: the same resolved input used by Claude produces deterministic Pi config.

## Slice 2: Deliver locally

1. Isolate Pi assets when MCP servers exist.
2. Install both extensions and write temporary config with restrictive permissions.
3. Pass the path through the narrow launch option.
4. Remove the unsupported gate only after delivery is wired.
5. Route proxy tool execution through the existing Pi extension permission hook.
6. Preserve fingerprint and teardown behavior.

Exit: local Pi calls no-secret and secret-header fixtures.

## Slice 3: Deliver identically on Daytona

1. Upload the same pinned adapter asset.
2. Write the same config outside durable cwd.
3. Start Pi with the same option and clean up after exit.
4. Add no Daytona-specific protocol or gateway route.

Exit: the same fixtures pass with the same revision.

## Slice 4: Advertise and accept

1. Publish existing `mcp.user_servers` capability for Pi.
2. Verify the existing UI appears without Pi-specific code.
3. Run the local and Daytona matrix.
4. Capture a replay test from a successful no-secret run.

Exit: users configure the same MCP in the same UI and Pi can use it.

## Non-goals

No gateway, Agenta MCP client, OAuth, public stdio, flags, compatibility, migration, direct-tool
cache warm-up, or new saved and `/run` fields.
