# Plan — canonical gateway tool rendering

Frontend read-path only. The spine of the fix is **one shared shape-detection helper**
that both encodings resolve through, so the descriptor, the list grouping, the drill-in,
and the drawer all read one normalized view.

## The shared helper (the keystone)

Add to `web/packages/agenta-entity-ui/src/DrillInView/SchemaControls/toolUtils.ts`,
beside the existing `parseGatewayFunctionName` (which it reuses for the legacy branch).

```ts
export interface GatewayToolView {
    provider: string
    integration: string
    action: string
    connection: string
    /** Which encoding it was read from — drives whether removal/dedupe matches by
     *  function name (legacy) or by the type:"gateway" object (canonical). */
    shape: "canonical" | "legacy"
    /** Per-tool permission when present (top-level on both shapes). */
    permission?: string
}

/** Normalize either encoding of a connected-app tool into one view; null if it is not one. */
export function parseGatewayTool(tool: unknown): GatewayToolView | null

/** Stable identity for dedupe/removal, independent of encoding:
 *  `${provider}.${integration}.${action}.${connection}`. */
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
  path knows how to match back to the raw object for removal. It must never leak into a
  persisted value or a display label.

This mirrors the existing `GatewayToolParsed` (`toolUtils.ts:24`) — `parseGatewayTool` is
its object-level superset, and `parseGatewayFunctionName` stays as the string-level
primitive it composes.

## Question 1 — Rendering (row descriptor + grouping)

**`describeTool()` (`itemDescriptors.tsx:143`):** replace the gateway detection line
`const gateway = fnName ? parseGatewayFunctionName(fnName) : null` with
`const gateway = parseGatewayTool(t)`. The existing gateway branch (lines 176–192) then
runs unchanged for both shapes: `humanizeActionKey(actionKey)`, `monogram(integration)`,
tag `[integration]`, `typeLabel:"third-party"`, subtitle `Connected app tool · {integration}`.

- Ordering is already safe: the `type:"reference"` branch is checked first; a
  `type:"gateway"` object flows into the gateway branch before the builtin fallback.
- The one visible difference for canonical: no `function.description`, so the row's
  secondary description line is empty. That is acceptable — the humanized action name is
  the label. (Question 2 covers fetching a description for the drill-in.)

**Grouping (`ToolManagementList.tsx:243`):** replace
`parseGatewayFunctionName(toolName(item))` with `parseGatewayTool(item)`. Canonical
entries then group under the **Connected apps** provider card keyed by `gw.integration`,
exactly like legacy. No change to `CollapsibleProviderGroup` / `GatewayGroups`.

## Question 2 — The drill-in

Today canonical opens the **raw JSON editor** (`itemKinds.tsx:85` → `"json"`). A gateway
tool is the *wrong* thing to edit as JSON-schema anyway: its input schema is
catalog-derived and re-enriched server-side at run time (`service.py:432`), so a local
schema editor is misleading for **both** encodings (the legacy Form already papers over
this with a "couldn't load the schema" warning banner, `ToolFormView.tsx:149`).

Proposed: route gateway tools (both shapes, detected by `parseGatewayTool`) to a small
**`GatewayToolDetailView`** instead of the JSON/Form editor. It shows:

- The integration logo + humanized action + connection identity (reuse the existing
  `GatewayToolHeaderIdentity` and `gatewayTools.useIntegrationInfo`, already wired in
  `ToolItemControl.tsx:303,330`).
- A read-only **input-schema preview**.
- The **one editable control that matters — `permission`** (allow / ask / deny /
  inherit), reusing the permission selector already in `ToolFormView`'s `ToolBasics`
  (`ToolFormView.tsx:123`).

Wire it via `itemKinds.tsx`: `editView` returns a `"form"` that `ToolFormView` delegates
to `GatewayToolDetailView` when `parseGatewayTool(item)` is non-null (the same delegation
pattern `ToolFormView` already uses for `type:"reference"` → `ReferenceToolFormView`,
`ToolFormView.tsx:189`). Canonical is no longer `jsonOnly`.

Where does the **description + schema** come from for the preview?

- **Option A — humanize-only (minimal).** Show the humanized action, the identity, and
  the local schema if the tool happens to carry one (legacy does; canonical shows "schema
  resolved at run time"). No network call. Simplest, ships the rendering fix cleanly.
- **Option B — fetch catalog detail on drill-in.** On open, call the existing
  `useToolActionDetail(integration, action)` hook
  (`useToolActionDetail.ts:29`) to show the real catalog **description** and a read-only
  **input-schema preview** for canonical entries (which persist neither). One cached
  request, only when the drawer is open.

This is **Open question #1** for Mahmoud — B is richer and uses an endpoint that already
exists; A is the smaller change. The rendering + grouping + dedupe fixes (Questions 1, 3,
5) do not depend on which we pick.

## Question 3 — Add / remove / dedupe

The drawer must treat canonical and legacy entries as the same tool for the same
action + connection.

- **`selectedToolNames` → identity set.** In `useAgentTools.ts:130`, build the set from
  `parseGatewayTool(tool)` → `gatewayToolIdentity(view)` for every tool of either shape
  (keep the legacy `toolName` fallback for non-gateway function tools that the drawer does
  not manage — actually the drawer only cares about gateway identities, so expose a
  dedicated `selectedGatewayIds: Set<string>` and leave `selectedToolNames` for other
  uses). The drawer's `slugFor`/`itemState`/`toggle`
  (`AgentIntegrationDrawer.tsx:140,155,250`) compare `gatewayToolIdentity({provider,
  integration, action, connection})` for the chosen connection+action against that set.
  Then a canonical tool reads as **selected**, blocks a duplicate add, and toggles off.
- **`addedCount`** (`AgentIntegrationDrawer.tsx:283`) counts identities, not
  `parseGatewayFunctionName` matches — so canonical tools are counted.
- **Removal.** Add `handleRemoveGatewayTool(identity)` in `useAgentTools.ts` that filters
  out whichever tool (legacy or canonical) has the matching `gatewayToolIdentity`. Wire
  the drawer's `onRemoveTool` to it. The row's own remove button already works for
  canonical via `handleRemoveBuiltinTool` / `isBuiltinPayloadMatch`; unifying it on the
  identity path is a cleanup, optional in the first slice.

Note: what the drawer newly **adds** stays in today's legacy shape unless we adopt
Question 4. Reading canonical is independent of writing it.

## Question 4 — Convergence (OPEN — do not decide unilaterally)

Should the drawer **start writing** the canonical `{type:"gateway",…}` shape on add,
retiring the legacy `function.name` encoding over time? The compat layer already accepts
both, and the resolve path enriches the schema regardless, so writing canonical would:

- drop the add-time `fetchToolActionDetail` round-trip and the `function.parameters` /
  `agenta_metadata` bookkeeping (the resolver re-enriches anyway),
- make the FE-authored shape identical to the SDK-authored shape (one source of truth),
- retire `parseGatewayFunctionName` from the write path (it stays in the read path for
  back-compat with already-persisted legacy tools).

Against: it changes what the drawer persists, which needs its own QA pass, and the
`needsConfig` fallback (open the editor when the schema can't be fetched) loses its
current meaning. This is **Open question #2** for Mahmoud. The read-path fix in this
design stands on its own and does not require this decision.

## Question 5 — Where the shared helper lives

`toolUtils.ts` — it already holds `parseGatewayFunctionName`, `GatewayToolParsed`, and the
provider/builtin metadata, and it is already imported by `describeTool`,
`ToolManagementList`, `ToolItemControl`, `ToolFormView`, and `AgentIntegrationDrawer`.
Adding `parseGatewayTool` + `gatewayToolIdentity` there means every consumer imports one
parser from one place. No new module.

## Phasing

**Phase 1 — Read-path rendering (the fix Mahmoud hit).**
`parseGatewayTool` + `gatewayToolIdentity` in `toolUtils.ts`; `describeTool` and
`ToolManagementList` switched to it. After this, canonical Slack tools render as
"Connected app tool" rows under a Slack card. Smallest shippable slice.

**Phase 2 — Drill-in.** `GatewayToolDetailView` + `itemKinds` routing (Option A or B per
Mahmoud). Canonical entries stop opening the raw JSON editor.

**Phase 3 — Add/remove/dedupe.** Identity-based `selectedGatewayIds` + removal so
canonical entries participate in the drawer.

**Phase 4 (conditional on Question 4).** Switch the drawer to write canonical on add.

## Testing

Unit tests belong in `web/packages/agenta-entity-ui/tests/unit/` (package convention).

- `parseGatewayTool`: canonical object, legacy function-name, dotted/`__` slug variants,
  non-gateway function tool, builtin, reference, junk → correct view or `null`; `provider`
  defaults to `composio` when absent.
- `gatewayToolIdentity`: legacy and canonical for the same action + connection produce the
  **same** identity; different connection/action differ; `permission` does not affect it.
- `describeTool`: canonical `type:"gateway"` → name = humanized action, tag = integration,
  subtitle "Connected app tool · …", **not** built-in.
- `ToolManagementList` partition: a canonical entry lands in the provider group, not
  `builtins`.
- Live check on the `:8280` repro (app `019f3d51-1f93-7452-8133-dff2f0d91385`, revision
  `019f3d56-90f3-7870-b1c4-bd67f4313e18`): the three Slack tools render under a Slack card
  with humanized names.

## Open questions for Mahmoud

1. **Drill-in richness (Q2):** humanize-only (Option A, no network) or fetch the catalog
   action detail for a real description + read-only schema preview (Option B, uses the
   existing `useToolActionDetail` hook)?
2. **Convergence (Q4):** should the drawer start **writing** the canonical
   `{type:"gateway",…}` shape on add and retire the legacy `function.name` encoding over
   time (read-side back-compat stays either way)?

Both are independent of Phase 1, which fixes the reported symptom on its own.
