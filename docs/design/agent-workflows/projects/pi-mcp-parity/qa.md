# QA plan

## Unit and packaging tests

- Render one and multiple resolved HTTP servers.
- Preserve empty headers and deliver secrets only through the runtime artifact.
- Reject unsupported connection and policy modes.
- Validate URLs and reserved names before materialization.
- Keep headers out of errors and logs.
- Preserve the existing MCP fingerprint behavior.
- Route Pi MCP requests to the adapter and leave non-Pi requests unchanged.
- Reuse the existing Pi approval path for remote tool execution and honor denial.
- Start the packaged extension with pinned Pi, list a fixture server, and call one tool.

## Acceptance matrix

| Environment | Credentials | Expected result |
| --- | --- | --- |
| Local | None | List server, discover tool, call tool |
| Local | Secret header | Call succeeds; secret absent from output and logs |
| Daytona | None | Same behavior as local |
| Daytona | Secret header | Same behavior; no durable secret file |

Use the same revision and fixtures across environments.

## Configuration change

1. Start Pi with endpoint A and confirm A.
2. Edit the endpoint to B and send a normal turn.
3. Assert the session goes cold and reports B only.
4. Repeat with a header-secret reference change.

Approval resume continues the exact parked process and must not rebuild configuration.

## Failure cases

- DNS failure identifies the server without headers.
- SSRF-blocked URLs fail before Pi starts.
- Missing project secrets fail in the service, as for Claude.
- Invalid adapter config fails the run instead of omitting MCP.
- Adapter startup failure does not fall back to an MCP-less run.

## Completion evidence

Include focused unit results, runner typecheck, package smoke output, and four live traces. Capture
one replay test after the first stable live run.
