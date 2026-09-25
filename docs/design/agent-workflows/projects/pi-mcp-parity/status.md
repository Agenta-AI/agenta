# Status

Last updated: 2026-07-14

## Stage

Design ready for review. No implementation has started.

## Confirmed

- PRs #5296 and #5297 established secret resolution and the MCP UI.
- The runner fingerprint includes MCP servers.
- `pi-acp@0.0.29` does not forward ACP MCP entries.
- Latest checked `pi-acp@0.0.31` still documents that limitation.
- `pi-mcp-adapter@2.11.0` supports remote HTTP and headers.
- The runner has local and Daytona Pi extension-asset machinery.

## Decisions

- Reuse `pi-mcp-adapter`; do not build an MCP client.
- Keep service resolution and public config identical to Claude.
- Add only a Pi-private rendering at the harness boundary.
- Use the adapter proxy first.
- Keep secret-bearing config ephemeral.
- Add no gateway, OAuth, stdio, probing, flag, compatibility, or migration.
- Publish Pi capability only after local and Daytona acceptance.

## Review focus

1. Is the proxy acceptable for the first slice, with direct tools deferred?
2. Does the temporary config lifecycle match the secret boundary?
3. Is anything beyond HTTP plus current secret headers required?

## Next action

Approve the design, then implement slices 0 and 1 together.
