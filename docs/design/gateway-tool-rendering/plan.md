# Plan — canonical gateway tool rendering

Frontend read-path only. **Product invariant first:** nothing about the tool UI changes for
the user. The playground Tools section looks exactly the same before and after this work,
and an agent-created tool looks exactly like a UI-created one — same row, same grouping,
same drill-in. The only place the two can ever look different is the fail-safe for a tool
that cannot be resolved (Question 2).

The mechanism is a **simplification**, not a product change. Today two code paths handle the
same concept: one keys off the legacy `function.name` slug, the other never recognizes the
canonical `type:"gateway"` object at all, so it falls through to the built-in fallback. We
collapse the detection into **one shared shape-detection helper** that both encodings resolve
through, so the descriptor, the list grouping, the drill-in, and the drawer all read one
normalized view. Less branching, same output.

## The shared helper (the keystone)

Add to `web/packages/agenta-entity-ui/src/DrillInView/SchemaControls/toolUtils.ts`,
beside the existing `parseGatewayFunctionName` (which it reuses for the legacy branch).

```ts
export interface GatewayToolView {
    provider: string
    integration: string
    action: string
    connection: string
    /** Which encoding it was read from — protocol context only; never displayed or
     *  persisted. */
    shape: "canonical" | "legacy"
    /** Per-tool permission when present (top-level on both shapes). */
    permission?: string
}

/** Normalize either encoding of a connected-app tool into one view; null if it is not one. */
export function parseGatewayTool(tool: unknown): GatewayToolView | null

/** Stable identity for the drawer's added-state (double-add prevention + toggle-off),
 *  independent of encoding: `${provider}.${integration}.${action}.${connection}`. */
export function gatewayToolIdentity(view: GatewayToolView): string
```

`parseGatewayTool` logic:

1. If `tool` is an object with `type === "gateway"` → read
   `provider` (default `"composio"`), `integration`, `action`, `connection`,
   `permission`; `shape: "canonical"`.
2. Else if `tool.function?.name` parses via `parseGatewayFunctionName` → return that with
   `shape: "legacy"` and `permission` from the top-level `permission` key.
3. Else `null`.

### Interface-role check (design-interfaces lens)

- `provider / integration / action / connection` — **routing identity** (data). They name
  *which* catalog action on *which* connection. The stable identity key is derived from
  exactly these four, matching the server's `provider.integration.action.connection`
  reference (`GatewayToolConfig.reference`, `models.py:113`).
- `permission` — **policy**, not identity. It is deliberately excluded from
  `gatewayToolIdentity` so two entries for the same action with different permissions
  still count as the same tool (you don't add it twice).
- `shape` — **protocol/encoding context**, not domain data. It exists only so the read
  path knows how to match a drawer action back to an existing entry for the added-state.
  It must never leak into a persisted value or a display label.

This mirrors the existing `GatewayToolParsed` (`toolUtils.ts:24`) — `parseGatewayTool` is
its object-level superset, and `parseGatewayFunctionName` stays as the string-level
primitive it composes.

## Question 1 — Rendering (row descriptor + grouping)

**The product invariant.** A connected-app tool must render identically no matter which
encoding authored it: same humanized name, same integration logo, same tag, same "Connected
app tool" subtitle, same provider-card grouping. The legacy encoding already renders that
way. This section only widens the detection so the canonical object reaches the **same
branch** and stops falling through to the built-in fallback. The row's appearance does not
change; we change which shapes reach the existing rendering.

**`describeTool()` (`itemDescriptors.tsx:143`):** replace the gateway detection line
`const gateway = fnName ? parseGatewayFunctionName(fnName) : null` with
`const gateway = parseGatewayTool(t)`. The existing gateway branch (lines 176–192) then
runs unchanged for both shapes: `humanizeActionKey(actionKey)`, `monogram(integration)`,
tag `[integration]`, `typeLabel:"third-party"`, subtitle `Connected app tool · {integration}`.

- Ordering is already safe: the `type:"reference"` branch is checked first; a
  `type:"gateway"` object flows into the gateway branch before the builtin fallback.
- The row's structure is identical for both encodings. The canonical object carries no
  `function.description`, so the row's optional secondary description line has no local
  text; the humanized action name is the label, exactly as legacy shows it. Question 2's
  Option-B catalog fetch supplies the real description in the drill-in, so the two converge
  where the description is actually shown.

**Grouping (`ToolManagementList.tsx:243`):** replace
`parseGatewayFunctionName(toolName(item))` with `parseGatewayTool(item)`. Canonical
entries then group under the **Connected apps** provider card keyed by `gw.integration`,
exactly like legacy. No change to `CollapsibleProviderGroup` / `GatewayGroups`.

## Question 2 — The drill-in

**Decision (Mahmoud, 2026-07-07): reuse the existing view. No new component as a product
surface.** We already have a view for opening a gateway tool in the drawer. A canonical
entry must open that **same** existing view a legacy entry gets. We do not build a new
`GatewayToolDetailView`, and we do not change how the current view looks.

Today canonical opens the **raw JSON editor** (`itemKinds.tsx:85` → `"json"`) because the
gateway detection (`ToolItemControl.tsx:619`, `ToolFormView.tsx:33,153`) only recognizes
the legacy slug. The fix widens that detection with `parseGatewayTool` so a resolvable
canonical object routes to the **existing gateway drill-in** the legacy encoding already
uses (the `ToolItemControl` / `ToolFormView` gateway header + `GatewayToolHeaderIdentity` +
`gatewayTools.useIntegrationInfo`, `ToolItemControl.tsx:303,330`), not to JSON. Canonical is
no longer `jsonOnly` when it resolves.

**Where the description + schema come from: Option B (decided).** The canonical object
persists no description and no input schema; the catalog is authoritative and the resolve
path re-enriches both server-side at run time (`service.py:432`). So on drill-in we **fetch
the catalog detail** with the existing `useToolActionDetail(integration, action)` hook
(`useToolActionDetail.ts:29`) and populate the existing gateway view with the real
description and a read-only input-schema preview. One cached request, only while the drawer
is open. This is what makes a canonical tool look identical to a legacy one in the drill-in:
the legacy tool carries these fields locally, the canonical tool fetches them; same view,
same content. The bar Mahmoud set — tools show EXACTLY the same for UI-created and
agent-created, in the outside list and in the drill-in — is met by this fetch.

### The fail-safe — the one allowed divergence (new design item)

An agent writes tool configs programmatically. It can write a `type:"gateway"` object that
names an integration / action / connection that does not resolve: a typo, a renamed action,
a connection that no longer exists. When that happens the catalog fetch fails or the action
cannot be confirmed to exist, and there is no real tool to populate the gateway view with.

**Fail-safe behavior:** fall back to the raw JSON view (today's behavior for an unrecognized
tool) **plus a warning that the tool could not be resolved.** This is the **only** place a
canonical tool is allowed to look different from a legacy one, and only because the tool
itself is broken. A resolvable canonical tool always gets the normal gateway view.

Routing rule for `itemKinds.tsx` `editView`:

1. `parseGatewayTool(item)` is null → not a gateway tool → today's behavior (unchanged).
2. non-null AND the catalog detail resolves → the **existing gateway drill-in** (both
   encodings; canonical populated via the Option-B fetch).
3. non-null BUT the catalog fetch fails or the action cannot be confirmed → **raw JSON view
   + "could not resolve this tool" warning** (the fail-safe).

Case 3 gets its own plan slice and its own test (see Phasing and Testing). Cases 1–2 are
pure read-path widening with no visual change.

## Question 3 — Add (the drawer's only identity responsibility)

**Decision (Mahmoud, 2026-07-07): the frontend does not deduplicate.** Showing what exists,
including duplicates, is correct. The list renders every tool the config holds. Removal
removes exactly the entry the user selected, nothing more. The frontend's only use of tool
identity is the **add path**: show a tool as already added so the user cannot add it twice.

So `gatewayToolIdentity` serves exactly three drawer behaviors, all on the add side:

- **Added-state.** In the drawer, an action + connection that already exists in the config
  (in either encoding) shows as selected. Build a dedicated `selectedGatewayIds: Set<string>`
  in `useAgentTools.ts:130` from `parseGatewayTool(tool)` → `gatewayToolIdentity(view)` over
  the current tools, and leave `selectedToolNames` for other uses. The drawer's
  `slugFor`/`itemState` (`AgentIntegrationDrawer.tsx:140,155,250`) compare the chosen
  action's identity against that set.
- **Double-add prevention.** Because the matched action reads as selected, the drawer blocks
  adding it again for the same action + connection.
- **Toggle-off of the matched entry.** Toggling a selected action off removes the entry the
  toggle refers to (the one the identity matched), via `gatewayToolIdentity`. It does not
  sweep other entries.

`addedCount` (`AgentIntegrationDrawer.tsx:283`) counts these identities so canonical tools
are counted in the drawer's added total.

**Out of scope:** no display-dedupe — the list shows duplicates as they are. No
removal-dedupe — the row's own remove button removes exactly that row and keeps its current
behavior. Reading canonical is independent of writing it.

## Question 4 — Convergence (DEFERRED — Mahmoud, 2026-07-07)

**Decision: do not change the write logic for now.** The drawer keeps writing the legacy
`function.name` shape on add. We do not switch it to write the canonical
`{type:"gateway",…}` object in this work.

Read-side canonical support is **unaffected**: the read path renders and drills into both
shapes regardless of what the drawer writes, and `parseGatewayFunctionName` stays in both
the read and the write path. Convergence — making the FE-authored shape identical to the
SDK-authored shape by writing canonical on add — stays available as a future cleanup, out
of scope here. When revisited, it would drop the add-time `fetchToolActionDetail` round-trip
and the `agenta_metadata` bookkeeping (the resolver re-enriches anyway), at the cost of its
own QA pass on what the drawer persists.

## Question 5 — Where the shared helper lives

`toolUtils.ts` — it already holds `parseGatewayFunctionName`, `GatewayToolParsed`, and the
provider/builtin metadata, and it is already imported by `describeTool`,
`ToolManagementList`, `ToolItemControl`, `ToolFormView`, and `AgentIntegrationDrawer`.
Adding `parseGatewayTool` + `gatewayToolIdentity` there means every consumer imports one
parser from one place. No new module.

## Phasing

**Phase 1 — Read-path rendering (the fix Mahmoud hit).**
`parseGatewayTool` + `gatewayToolIdentity` in `toolUtils.ts`; `describeTool` and
`ToolManagementList` switched to it. After this, canonical Slack tools render as "Connected
app tool" rows under a Slack card, identical to legacy. Smallest shippable slice.

**Phase 2 — Drill-in through the existing view.** Widen `itemKinds` routing so a resolvable
canonical tool opens the **existing gateway drill-in** (not a new component, not raw JSON),
populated by the Option-B `useToolActionDetail` fetch. Add the **fail-safe**: an unresolvable
canonical tool falls back to raw JSON plus a "could not resolve this tool" warning. Canonical
entries stop opening the raw JSON editor except in the fail-safe case.

**Phase 3 — Add-path identity.** Identity-based `selectedGatewayIds` so canonical entries
show as already-added, block a double-add, and toggle off. No display or removal dedupe.

**Convergence (Question 4) is deferred** — no write-path change in this work.

## Testing

Unit tests belong in `web/packages/agenta-entity-ui/tests/unit/` (package convention).

- `parseGatewayTool`: canonical object, legacy function-name, dotted/`__` slug variants,
  non-gateway function tool, builtin, reference, junk → correct view or `null`; `provider`
  defaults to `composio` when absent.
- `gatewayToolIdentity`: legacy and canonical for the same action + connection produce the
  **same** identity (this is what makes the drawer's added-state match across encodings);
  different connection/action differ; `permission` does not affect it.
- `describeTool`: canonical `type:"gateway"` → name = humanized action, tag = integration,
  subtitle "Connected app tool · …", **not** built-in.
- `ToolManagementList` partition: a canonical entry lands in the provider group, not
  `builtins`.
- Drill-in routing: a **resolvable** canonical tool opens the **existing gateway view**
  (populated by the Option-B fetch), not the raw JSON editor.
- **Fail-safe:** an **unresolvable** canonical tool (bad integration/action/connection so
  the catalog fetch fails or the action cannot be confirmed) falls back to the raw JSON view
  **and** shows the "could not resolve this tool" warning.
- Live check on the `:8280` repro (app `019f3d51-1f93-7452-8133-dff2f0d91385`, revision
  `019f3d56-90f3-7870-b1c4-bd67f4313e18`): the three Slack tools render under a Slack card
  with humanized names.

## Decisions (resolved 2026-07-07, Mahmoud)

Both former open questions are closed.

1. **Drill-in richness (Q2): Option B.** Fetch the catalog action detail and populate the
   **existing** gateway view. Canonical and legacy tools show exactly the same, in the
   outside list and in the drill-in. No new component.
2. **Convergence (Q4): deferred.** The drawer keeps writing the legacy shape on add. No
   write-path change now; read-side canonical support is unaffected.

The product invariant governs the whole design: a connected-app tool looks the same
regardless of who authored it. The single exception is the fail-safe for a canonical tool
that cannot be resolved (raw JSON + warning).
