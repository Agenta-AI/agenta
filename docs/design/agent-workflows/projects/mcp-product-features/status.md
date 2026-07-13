# Status

Last updated: 2026-07-13

## Stage

Planning draft. No implementation started.

## Locked

- The saved role-based MCP object stays stable.
- Public stdio remains absent.
- Protocol status and discovered tools are ephemeral.
- OAuth references a platform connection.
- Tool policy must be enforced on list and call.
- Pi 2.2 precedes this feature work.

## Open decisions

1. Direct per-harness MCP clients or platform gateway?
2. Who owns upstream MCP session lifetime and reconnect state?
3. Does a failed required MCP connection abort the run by default?
4. What is the cache lifetime for discovery results?
5. Which platform connection domain owns OAuth?

## Next

Complete the Pi 2.2 design, then resolve the Phase 0 execution-owner decision before defining
endpoints or implementation PRs.
