# QA plan

## Capability and UI

- Disabled deployment: MCP section absent.
- Enabled deployment plus unsupported harness: MCP section absent.
- Enabled Claude capability: MCP section visible.
- Missing or old capability metadata: section absent.
- Internal `agenta-tools`: never rendered, counted, saved, or editable.
- New server form: no transport, command, arguments, or environment controls.
- Credentials defaults to `None` in the initial slice.
- Tool policy defaults explicitly to all tools.

## Contract

- Version 2 remote HTTP config round-trips without defaults changing meaning.
- Unknown fields fail validation.
- `agenta-tools` name fails validation.
- Non-HTTPS and private or metadata URLs fail before credentials are attached.
- `include` requires at least one discovered tool name.
- `all` rejects a `names` field.
- Version 1 HTTP maps deterministically to version 2.
- Version 1 stdio fails with a specific unsupported error.
- Resolved secret-bearing objects never appear in repr, logs, inspect, or persistence snapshots.

## Live no-secret matrix

| Harness | Local | Daytona |
| --- | --- | --- |
| Claude | connect, list, call, bad-URL error | connect, list, call, bad-URL error |
| Pi before gateway | clear unsupported response | clear unsupported response |
| Pi after gateway | connect, list, call, filtered-tool denial | connect, list, call, filtered-tool denial |

Use a deterministic HTTPS fixture with one read-only tool and one tool that returns its input. The
fixture must record initialization, `tools/list`, and `tools/call` without recording authorization
headers.

## Enabled-live failure evidence

For the user's exact deployment, retain a redacted evidence bundle containing:

- deployment identity and effective capability;
- saved agent revision and external MCP name;
- service run correlation identifier;
- whether `/run.mcpServers` contained the external server;
- whether ACP session initialization contained it;
- Claude MCP status and safe error text;
- whether `tools/list` reached the fixture.

This becomes a replayable regression test at the first failed seam.

## Tool policy

- Discovery shows actual server tool names and schemas.
- `all` exposes every discovered tool.
- `include` exposes and calls only selected tools.
- A direct call to an excluded tool fails at the execution boundary.
- Removed or renamed upstream tools are visible as stale selections.
- Empty arrays and empty strings never widen access.

## Credentials, later slice

- Secret refs are stored, values are not.
- Missing refs fail closed with the server and ref name, never the value.
- Redaction covers service, runner, ACP, and sandbox logs.
- Daytona placeholders are restricted to the exact upstream HTTPS host.
- Local direct-Claude credentials are not marked production-safe while plaintext is delivered.
- Gateway runs keep upstream values outside every harness sandbox.

## Release gate

Do not enable this in production until the Claude local and Daytona no-secret cells pass, status is
visible in the UI, excluded tools are enforced, and the failure path is covered by an integration
or replay test.

