# Plugin POC validation

The plugin backend, MCP adapter, browser bridge, and demo are implemented. Real Linear page reads and MCP reads and writes are verified. Real chat through OpenRouter and the approval flow are verified in the demo project.

## Checked

- SDK plugin flags, handler, template, and MCP connection tests: 54 passed.
- API gateway suite: 2,223 passed and 12 skipped.
- Services unit suite: 226 passed.
- Shared workflow frontend tests: 26 passed. Mobile list and plugin error tests: 13 passed.
- Linear demo unit tests: six passed. These check scoring, preserving labels, partial completion, and batch limits.
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

## Real Linear verification

- Inspected the connected server's tool schemas. The current server uses `save_issue` and object-valued priorities. The demo now uses `addLabels` to preserve existing labels without replacing them.
- The page loaded 14 real open issues in 3.17 seconds. Warm direct calls took 2.95–3.01 seconds. Desktop and mobile rendering were inspected.
- Both plugin MCP tools succeeded against real Linear. The write re-added a label already on the selected issue; a read-back confirmed that its label set did not change.
- Gateway audit records show the same caller for the plugin and downstream Linear calls.
- The agent is visible and linked to the plugin, with `bulk_label` requiring approval. It uses OpenRouter with the user-selected model.
- Six demo tests pass. The three review fixes passed 38 API regression tests and nine focused SDK tests.

## Real chat and approval verification

- Fixed two demo deployment faults: the model gateway was disabled, and the runner watcher had no server process. Enabled the gateway and restarted only the demo runner.
- Corrected the seed policy to explicitly allow `my_open_issues`. A per-tool table otherwise defaults unnamed tools to ask. `bulk_label` remains ask.
- A fresh chat returned 14 real Linear issues without an approval prompt. The browser displayed 22 seconds for the turn.
- The label operation paused with issue `MAR-168` and label `marketing` shown. Gateway write counts did not increase before approval.
- After approval, the operation completed. A separate Linear read confirmed that the issue still had exactly its original `marketing` label. Plugin and downstream calls retained the same caller.
- The final responses survived reload. Desktop and 390-pixel mobile layouts were inspected without horizontal overflow.
- The browser recording includes setup and the QA scenarios: https://www.browserbase.com/sessions/27cf6b06-0493-4abc-be85-c2c236fdd5c8 .

## Remaining checks

Cold real-server plugin timings remain unmeasured. The previous Railway run's three personal-account requirement failures reproduce on the demo (three failed, three passed). Personal accounts are disabled on this deployment. The relevant account reader, feature gate, and requirements service are unchanged against the release base, but a separate base deployment has not been tested. Latest PR CI still needs to finish; do not treat the whole PR as green.
