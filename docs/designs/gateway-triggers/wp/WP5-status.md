# WP5 — Status

**Lane** WL5 · **Stream** WS5 · **Branch** `wp5-web-catalog` (not yet created)

| Field | Value |
|-------|-------|
| State | IMPLEMENTED (awaiting branch/PR) |
| Consumes frozen | ☑ catalog API (WP1) ☑ /…/connections (WP0) |
| Branch created | ☐ (anchor `wp1-events-catalog`) |
| Subagent | WS5 |
| PR | — |

## Checklist

- [x] "Triggers" surface on a connected integration (settings tab + section)
- [x] Events browse + `trigger_config` schema view (WP1 API)
- [x] Connections list via `/triggers/connections`
- [x] F2: tolerate overlapping connection reads (tools ∩ triggers)
- [x] Mock WP1/WP0 HTTP until merged (unit tests stub axios at the boundary)
- [x] AC: browse events; connection shows under both
- [ ] PR opened `--base wp1-events-catalog`

## What was built

New `@agenta/entities/gatewayTrigger` (state + queries) and
`@agenta/entity-ui/gatewayTrigger` (events drawer), mirroring `gatewayTool`. New OSS
`settings/Triggers` surface wired as a `triggers` settings tab (gated by `isToolsEnabled()`,
the shared Composio gate). The Triggers section lists the shared connections and opens an
events drawer per connection; selecting an event shows its `trigger_config` schema
(read-only, via the reused `SchemaForm`).

### Files

Entities (`web/packages/agenta-entities/`):

- `src/gatewayTrigger/core/types.ts` (+ `core/index.ts`)
- `src/gatewayTrigger/api/{client,api,index}.ts`
- `src/gatewayTrigger/state/{atoms,index}.ts`
- `src/gatewayTrigger/hooks/{useCatalogEvents,useTriggerEvent,useTriggerConnections,index}.ts`
- `src/gatewayTrigger/index.ts`
- `tests/unit/gatewayTriggerApi.test.ts`
- `package.json` (added `./gatewayTrigger` export)

Entity-UI (`web/packages/agenta-entity-ui/`):

- `src/gatewayTrigger/drawers/TriggerEventsDrawer.tsx`
- `src/gatewayTrigger/index.ts`
- `package.json` (added `./gatewayTrigger` export)

OSS (`web/oss/`):

- `src/components/pages/settings/Triggers/Triggers.tsx`
- `src/components/pages/settings/Triggers/components/GatewayTriggersSection.tsx`
- `src/pages/w/[workspace_id]/p/[project_id]/settings/index.tsx` (triggers tab)
- `src/components/Sidebar/SettingsSidebar.tsx` (triggers menu item)

## Notes / blockers

- **Fern client gap (follow-up, not a blocker):** the shipped WP1 catalog API is NOT yet
  in the Fern-generated `@agentaai/api-client` (no `triggers` resource). Per the WS5 stub
  strategy this layer uses the shared axios instance with zod boundary validation (the
  local schemas mirror `core/triggers/dtos.py` + `triggers/models.py` verbatim). When the
  client is regenerated with a `triggers` resource, `gatewayTrigger/api/*` collapses onto
  `getAgentaSdkClient().triggers` the same way `gatewayTool` does — a mechanical swap.
- **`/triggers/connections` consumed against the frozen WP0 shape, not yet shipped.** The
  triggers router (`api/oss/src/apis/fastapi/triggers/router.py`) currently exposes only
  the catalog routes; the `/triggers/connections` view over `gateway_connections` (WP0) is
  not mounted there yet. The FE calls `POST /triggers/connections/query` mirroring
  `POST /tools/connections/query` (same `{count, connections: Connection[]}` shape, same
  shared rows). This is exactly the WP0 dep WS5 stubs until it merges; unit tests cover the
  request/response shape. No backend change is in WP5 scope.
- **F2 handled explicitly:** trigger connections use their own React-Query keys
  (`["triggers", "connections", …]`), distinct from tools (`["tools", …]`), so the same
  shared row in both lists causes no cache or rowKey collision. The connection TS type is
  aliased to the gatewayTool type so the two lists are byte-compatible; no duplicate-connect
  path exists on the triggers surface (it only reads + browses events).
