# QA

## Matrix

For Claude and Pi on local and Daytona:

- no-auth connect, list, and call;
- invalid URL and failed initialization;
- `all` and `include` tool policy;
- excluded-tool direct call;
- stale selected tool after upstream rename;
- static header secret reference;
- missing or revoked credential;
- OAuth connect, refresh, and revoke;
- reconnect after upstream interruption;
- no credential values in logs, traces, responses, or saved revisions.

## Release gates

- The connection-test path and run path use the same MCP client behavior.
- Status never claims connected before initialization completes.
- Policy is enforced outside the model prompt.
- Unsupported harness and environment cells omit the capability.
- Internal `agenta-tools` never appears in external discovery or status.
- A deterministic fixture or replay test covers every adapter.
