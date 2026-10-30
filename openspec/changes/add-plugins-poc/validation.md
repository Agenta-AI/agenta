# Plugin POC validation

The plugin backend, MCP adapter, browser bridge, and demo are implemented. The real Linear demo is not yet verified because it needs the user's Linear and model connections.

## Checked

- SDK plugin flags, handler, template, and MCP connection tests: 54 passed.
- API gateway suite: 2,223 passed and 12 skipped.
- Services unit suite: 226 passed.
- Shared workflow frontend tests: 26 passed. Mobile list and plugin error tests: 13 passed.
- Linear demo unit tests: four passed. These check scoring, preserving labels, partial completion, and batch limits.
- Mobile TypeScript and scoped ESLint checks passed. The generated API client was refreshed from the running API.
- A Daytona sandbox initialized an MCP connection and listed tools through the gateway with the caller's credential. Node was version 22.22.1.
- The agent called a plugin through the gateway, and the plugin called the mock MCP server. Audit records had the same caller on both calls. With ask enabled, the agent paused before executing the plugin.
- The browser loaded and labeled mock issues through the sandbox. Desktop and mobile screenshots were inspected. A viewer received a visible access-denied message from a downstream gateway refusal.

## Measurements

The initial direct sandbox call took 23.76 seconds. Later calls took 2.64 to 3.09 seconds. A page read took 3.55 seconds. The mock agent chain took 15.69 seconds, and the approval pause took 7.77 seconds. These are individual observations, not performance guarantees or Linear measurements.

## Changes from the plan

- The current release branch is newer than the spec's source snapshot. The implementation uses its existing workflow, gateway, and mobile conventions.
- Plugin role flags must be set on the artifact before revision creation. Deriving only revision flags left the application role false.
- The page uses the fixed plugin service route and a checked revision reference. It never accepts an invocation URL from the embedded page.
- Viewer permission errors can arrive inside a service failure. The page translates those into a clear access-denied message.
- Label updates preserve existing labels, limit batches to five issues, and report partial completion without retries.

## Remaining acceptance checks

Connect Linear and a model in the demo project, seed the Linear triage plugin and agent link, confirm the real server's argument schemas, and exercise page reads and selected label writes. Repeat the agent read and approval flow with that connection. Measure cold and warm calls and confirm the caller in the Linear relay audit record. Do not mark the POC complete until these checks pass.
