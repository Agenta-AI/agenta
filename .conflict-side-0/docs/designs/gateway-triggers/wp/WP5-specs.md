# WP5 — Web: catalog + connections UI

**Lane** WL5 (anchor WL1) · **Stream** WS5 (web) · **Area** web

Parent docs: [`../plan.md`](../plan.md) §4, [`../gap.md`](../gap.md) §2.6 (F1 browse, F2).

## Goal

The browse half of the FE: providers / integrations / events and the connection list, on a
"Triggers" surface of a connected integration.

## Closes (gap items)

F1 (catalog/connect part), F2.

## Scope

- "Triggers" entry on a connected integration — browse events and their `trigger_config`
  schema (WP1 catalog API).
- Show connections via `/triggers/connections`.
- Handle the **overlapping connection reads** across `/tools/connections` and
  `/triggers/connections` (same shared rows, F2) — the FE must tolerate the same connection
  appearing in both lists.
- Reuse the existing tools UI surfaces: `web/packages/agenta-entities/src/gatewayTool`,
  `web/packages/agenta-entity-ui/src/gatewayTool`, `web/oss/src/components/pages/settings/Tools`.

## Functional deps (fan-in)

- **WP1** — the catalog API.
- **WP0** — the `/…/connections` view over `gateway_connections`.

## Stubs needed (until deps merge)

- Mock the catalog (WP1) and `/…/connections` (WP0) HTTP against their frozen shapes.

## Decisions to lock first

None hard (consumes frozen API shapes).

## Acceptance criteria

- Browse a connected integration's events.
- The same connection appears under **both** tools and triggers without a second connect.
