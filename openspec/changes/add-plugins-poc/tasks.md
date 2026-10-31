> Implementation status: the code and mock checks are complete. Real Linear and a user model connection are still required for 0.1, 4.2, and 6.1. The mock spike, agent approval pause, caller identity, page reads/writes, and viewer refusal passed. See `validation.md`.

## 0. Spike: last hop (run first)

- [ ] 0.1 On a throwaway stack on the development host (under `<isolated-workspace>/`, own Compose project name, never a shared or production stack), with the Daytona runner on: check the snapshot's Node version, then call `/gateways/mcps/custom/linear` (`initialize`, `tools/list`) with `X-AG-Credentials` set to a sandbox-style credential. Record status codes, the session header, the protocol version, and the content type.
- [ ] 0.2 Stop and report if the call is refused (risks R1, R3, R5).

## 1. Plugin definition (SDK and API)

- [x] 1.1 SDK: `("custom", "plugin"): (True, False, False)` in `_AGENTA_ROLE_TABLE`; derive `is_plugin`; add `is_plugin` to `WorkflowFlags` and `WorkflowQueryFlags`.
- [x] 1.2 API: add `is_plugin` to `WorkflowRevisionFlags` and `WorkflowRevisionQueryFlags`, and wherever `is_skill` is enumerated.

## 2. Plugin execution (SDK and services; parallel with 3 after 1)

- [x] 2.1 `PLUGIN_TEMPLATES["javascript"]`: async wrapper, `ctx.mcp` over POST with session id, protocol version, id matching, JSON or SSE bodies, error and `isError` handling; prints `{"result": {"value": ...}}`.
- [x] 2.2 `plugin_v0`: check the operation against the manifest, resolve declared connections to gateway URLs with the SDK route builder, run with version `"3"`, unwrap `value`.
- [x] 2.3 Register `plugin_v0` (handler, interface, catalog) under `custom`.
- [x] 2.4 Services: `custom_plugin_app`, mounted at `/plugin/v0`.
- [x] 2.5 Unit tests: unknown operation refused before any run; `null` result passes; template renders.

## 3. Plugin MCP exposure (API and SDK; parallel with 2 after 1)

- [x] 3.1 SDK: allow `slug` on built-in connections when `provider == "plugin"`; route to `/builtin/plugin/{slug}`.
- [x] 3.2 API: `PLUGIN_PROVIDER`; synthetic built-in target; dispatch in `relay` after authorization, inside the same usage recording as the Agenta branch.
- [x] 3.3 `PluginMCPAdapter`: one resolver for list and call (latest revision, `is_plugin`, operations, version); `tools/call` through `ToolsRouter.call_tool` with `workflow.variant.{slug}.{version}`; failed results become `isError`; the relay records failures when the adapter raises.
- [x] 3.4 Unit tests for the adapter and the SDK route.

## 4. Backend chain check (after 2 and 3, before any UI)

- [x] 4.1 Seed script with the creator check (declared servers must open with the creator's credential), demo plugin files, and the agent `mcps` entry.
- [ ] 4.2 One real agent turn calls `my_open_issues`; confirm the Linear relay record carries the agent run's principal; confirm `ask` on `bulk_label` pauses the turn. Stop and report if the principal differs.

## 5. Web (`web/mobile`; after 4)

- [x] 5.1 `is_plugin` in the shared workflow flag schema and generated client types.
- [x] 5.2 Plugins list: two-step query (workflows, then latest revisions by `workflow_refs`, keep `is_plugin`), `features/plugins/` list screen in the shared `ListTable` frame, route shell `plugins/index.tsx`, navigation item after Agents, empty, loading and error states.
- [x] 5.3 Plugin screen: route shell `plugins/[plugin_id]/index.tsx`, frame from `buildRunFrame` plus a one-method plugin stub, bridge to the services `/invoke` with the documented batch contract.

## 6. End-to-end check (short)

- [ ] 6.1 Page as annotator and as viewer; agent with `ask` on `bulk_label`. Record timings, warm and cold, from the page and from the agent.

## 7. Follow-ups (not in this change)

- [ ] 7.1 Give plugin runs the gateway-only token from `POST /gateways/credentials`.
- [ ] 7.2 A `gateway_endpoints` claim that limits the token to declared servers.
- [ ] 7.3 A workerd runner that implements the same template contract.
- [ ] 7.4 Build-kit tools to create plugins and link them to agents.
