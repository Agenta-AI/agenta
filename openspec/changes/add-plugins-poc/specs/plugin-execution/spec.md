## ADDED Requirements

### Requirement: Run one operation
The services handler mounted at `/plugin/v0` SHALL take inputs `{operation, args}`, refuse an operation that the manifest does not list, run the plugin code in the Daytona runner, and return the operation's JSON result as the output.

#### Scenario: Known operation
- **WHEN** the handler is invoked with `{"operation": "my_open_issues", "args": {}}`
- **THEN** it runs the `my_open_issues` function from the plugin code and returns its result

#### Scenario: Operation returns null
- **WHEN** an operation finishes and returns `null`
- **THEN** the handler returns `null` as a successful output, not an error

#### Scenario: Unknown operation
- **WHEN** the handler is invoked with an operation that is not in `parameters.plugin.operations`
- **THEN** it returns an error that names the operation and does not start a sandbox

#### Scenario: Operation listed but missing in code
- **WHEN** the manifest lists an operation that the code does not define
- **THEN** the run fails with an error that names the missing function

### Requirement: Isolated runner only
Plugin code SHALL run only in a runner that can run JavaScript in isolation, which today is Daytona; the handler relies on the other runners' own refusal of non-Python code.

#### Scenario: Local runner configured
- **WHEN** `AGENTA_SERVICES_CODE_SANDBOX_RUNNER` is `local` or `restricted`
- **THEN** the run fails with the runner's error that it supports Python only, and no plugin code runs

### Requirement: MCP helper for declared servers
The plugin template SHALL give the code `ctx.mcp(name).call(tool, args)`, which works only for names in `parameters.plugin.mcps`, posts MCP requests to that server's gateway route (resolved in Python) with the run credential in `X-AG-Credentials`, and throws on a JSON-RPC error or an `isError` result.

#### Scenario: Declared server
- **WHEN** plugin code calls `ctx.mcp("linear").call("list_issues", {...})`
- **THEN** the request goes to `/gateways/mcps/custom/linear` and the tool result is returned to the code

#### Scenario: Undeclared server
- **WHEN** plugin code calls `ctx.mcp("sentry")` and `sentry` is not declared
- **THEN** the helper throws an error naming `sentry`

#### Scenario: Server that needs a session
- **WHEN** the gateway answers `initialize` with an `mcp-session-id` header or with an event stream
- **THEN** the helper sends that session id on later calls and reads the JSON-RPC result from the stream

### Requirement: Runs as the principal
Plugin code SHALL hold the credential of the principal who triggered the run, so the gateway checks that principal on every MCP call.

#### Scenario: Principal without MCP access
- **WHEN** a viewer, who lacks `USE_MCP_ENDPOINTS`, runs an operation that calls Linear
- **THEN** the gateway refuses the Linear call and the operation returns an error that says access was denied
