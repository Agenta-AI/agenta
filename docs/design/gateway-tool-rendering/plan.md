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

Add to `web/packages/agenta-entity-ui/src/DrillInView/SchemaControls/toolUtils.ts`. The
legacy branch composes the **shared** string parser `parseGatewayToolSlug` from
`@agenta/shared/utils` (the canonical one; `toolUtils.ts`'s own `parseGatewayFunctionName`
is a duplicate of it — codex finding, folded).

```ts
export interface ParsedGatewayTool {
    provider: string
    integration: string
    action: string
    connection: string
    /** Which encoding it was read from — protocol context only; never displayed or
     *  persisted. */
    encoding: "canonical" | "legacy"
    /** Per-tool permission when present (top-level on both shapes). */
    permission?: string
}

/** Normalize either encoding of a connected-app tool into one view; null if it is not one. */
export function parseGatewayTool(tool: unknown): ParsedGatewayTool | null

/** Stable identity for the drawer's added-state (double-add prevention + toggle-off),
 *  independent of encoding. The four segments joined by a NUL — a connection slug may
 *  contain a dot, so a dotted key is not collision-safe (codex finding). */
export function gatewayToolIdentity(view: ParsedGatewayTool): string
```

`parseGatewayTool` logic:

1. If `tool` is an object with `type === "gateway"` → read
   `provider` (default `"composio"`), `integration`, `action`, `connection`,
   `permission`; `encoding: "canonical"`.
2. Else if `tool.function?.name` parses via the shared `parseGatewayToolSlug` → return that
   with `encoding: "legacy"` and `permission` from the top-level `permission` key.
3. Else `null`.

### Interface-role check (design-interfaces lens)

- `provider / integration / action / connection` — **routing identity** (data). They name
  *which* catalog action on *which* connection. The stable identity key is derived from
  exactly these four, matching the server's `provider.integration.action.connection`
  reference (`GatewayToolConfig.reference`, `models.py:113`).
- `permission` — **policy**, not identity. It is deliberately excluded from
  `gatewayToolIdentity` so two entries for the same action with different permissions
  still count as the same tool (you don't add it twice).
- `encoding` — **protocol/encoding context**, not domain data. It exists only so the read
  path knows how to match a drawer action back to an existing entry for the added-state.
  It must never leak into a persisted value or a display label.

`parseGatewayTool` is the object-level parser; the shared `parseGatewayToolSlug`
(`@agenta/shared/utils`) stays the string-level primitive it composes for the legacy
branch.

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

**Decision (Mahmoud, 2026-07-07): reuse the existing view; no new product surface.** A
canonical entry must open the **same drill-in** a legacy entry gets. The agent-template
drill-in is the shared `ConfigItemDrawer` whose Form slot is `ToolFormView` and whose JSON
slot is `JsonObjectEditor` (**not** `ToolItemControl` — that is the prompt surface; codex
correction). So the gateway-aware branch lands in **`ToolFormView`**, mirroring its
existing `type:"reference"` → `ReferenceToolFormView` branch — an established extension
point, not new chrome.

**The layering fix (codex, folded).** Resolvability depends on an async catalog fetch, so it
**cannot** be decided in `itemKinds.editView`, which is a synchronous
`(item) => "form" | "json"`. `editView` therefore only says: **a syntactic gateway tool
opens the Form** (`parseGatewayTool(item)` non-null → `"form"`; `jsonOnly` stays false so
the JSON toggle remains the lossless escape hatch). The mounted gateway body owns the fetch,
the loading state, and the fail-safe.

**`ToolFormView` gateway branch (pixel-identical, legacy untouched — Mahmoud's constraint
round).** Legacy gateway tools are function tools; they must render byte-for-byte as they do
today. So the existing `ToolFormView` body is extracted verbatim into an inner
`FunctionToolForm` (a code-only move, zero render change), and only a **canonical**
`type:"gateway"` object is routed to a wrapper:

- `editView` routes a canonical gateway object to the Form (legacy already opens the Form).
- The wrapper `CanonicalGatewayToolForm` runs `useToolActionDetail(integration, action)`
  (`useToolActionDetail.ts:29`, cached, `staleTime` 5 min; composio-only today — see note);
- **while pending** → a spinner (never a flash of raw JSON or an empty form);
- **on resolve** → it builds the **exact legacy function shape the add drawer would have
  written** — `{type:"function", function:{name: buildGatewayToolSlug(...), description:
  catalog.description, parameters: normalize(catalog.schemas.inputs)}}` with `permission`
  preserved — and renders `FunctionToolForm` with it. So a canonical tool's drill-in is the
  same component, same fields, same layout as a legacy tool's. The synthesized shape is
  **display-only**; the on-disk draft stays canonical and nothing is persisted unless the
  user edits (read-path only).
- **on terminal failure / action not confirmed** → the fail-safe (below).

Legacy gateway tools do **not** go through the wrapper; their existing editable param tree
is unchanged. This satisfies the invariant (canonical == legacy in the drill-in) without
altering anything a user sees for legacy tools.

**Where the description + schema come from: Option B (decided).** The catalog is
authoritative; the fetch supplies the description and the parameters. One cached request,
only while the drawer is open.

**Note — provider.** `useToolActionDetail` fetches under `provider = "composio"`. Every real
gateway tool is composio today. A non-composio canonical tool would resolve through the
composio fetch and, if absent there, land on the fail-safe. `provider` stays in the parsed
identity for correctness; threading it through the fetch is a documented follow-up.

### The fail-safe — the one allowed divergence (new design item)

An agent writes tool configs programmatically. It can write a `type:"gateway"` object that
names an integration / action / connection that does not resolve: a typo, a renamed action,
a connection that no longer exists. When the catalog fetch fails or the action cannot be
confirmed, there is nothing to populate the detail view with.

**Fail-safe behavior:** `CanonicalGatewayToolForm` shows a **warning banner** ("Couldn't
resolve this tool …") above a **read-only raw-JSON view** of the object (today's raw-JSON
behavior), and the drawer's **JSON toggle** stays the editable escape hatch. This is the
**only** place a gateway tool looks different, and only because the tool itself is broken.
It is a terminal `!isLoading && !action` from the hook (loading shows a spinner first), so
there is no flash of the wrong view while the fetch is in flight.

Slices and tests: Cases resolve / pending / fail each get a test (see Phasing and Testing).

## Question 3 — Add (the drawer's only identity responsibility)

**Decision (Mahmoud, 2026-07-07): the frontend does not deduplicate.** Showing what exists,
including duplicates, is correct. The list renders every tool the config holds. Removal
removes exactly the entry the user selected, nothing more. The frontend's only use of tool
identity is the **add path**: show a tool as already added so the user cannot add it twice.

So `gatewayToolIdentity` serves exactly three drawer behaviors, all on the add side:

- **Added-state.** In the drawer, an action + connection that already exists in the config
  (in either encoding) shows as selected. Derive `selectedGatewayIds: Set<string>` in
  `useAgentTools.ts:130` from the **same** `tools` memo `selectedToolNames` comes from
  (`parseGatewayTool(tool)` → `gatewayToolIdentity(view)`), so the two sets never drift —
  both are pure derivations of `tools`, neither is independent state (codex finding). The
  drawer's `slugFor`/`itemState` (`AgentIntegrationDrawer.tsx:140,155,250`) compare the
  chosen action's identity against that set.
- **Double-add prevention.** Because the matched action reads as selected, the drawer blocks
  adding it again for the same action + connection.
- **Toggle-off of the matched entry.** Toggling a selected action off removes **exactly one**
  identity-matched entry via a new `removeGatewayToolByIdentity(identity)` in `useAgentTools`
  (derived from the same snapshot). It removes one deterministic match, **never all**
  duplicates (codex finding). If a duplicate remains the action stays selected — which is
  correct: showing what exists beats silently sweeping. `handleRemoveToolByName` (which
  filters *all* same-name entries and can't match canonical) is left for the row remove
  button's existing legacy path.

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

**Phase 2 — Drill-in through the existing view.** `editView` routes a canonical gateway
object to the Form (legacy already does). The existing `ToolFormView` body becomes
`FunctionToolForm` (verbatim, legacy untouched); `CanonicalGatewayToolForm` runs the Option-B
`useToolActionDetail` fetch, synthesizes the legacy function shape, and renders
`FunctionToolForm` with it — a spinner while pending, the **fail-safe** (warning + read-only
JSON) on terminal failure. The async lives in the mounted body, never in the synchronous
`editView`.

**Phase 3 — Add-path identity.** `selectedGatewayIds` and `removeGatewayToolByIdentity`, both
derived from the same `tools` snapshot, so canonical entries show as already-added, block a
double-add, and toggle off exactly one identity match. No display or removal dedupe.

**Convergence (Question 4) is deferred** — no write-path change in this work.

## Out of scope / follow-ups (from the codex review)

- **Prompt surface** (`ToolSelectorPopover`, `PromptSchemaControl`, `ToolItemControl`) still
  keys gateway selection/removal and drill-in off the legacy slug; a canonical tool in a
  completion/chat prompt would still misrender there. This PR is the agent Tools section
  only.
- **`commitDiff` identity** (`workflow/commitDiff/identity.ts` `agentItemIdentity`) keys
  tools by `function.name`, so a canonical gateway tool gets positional identity in the
  change-diff / commit-summary layer. Separate surface, pre-existing, deferred.
- **`provider` threading** into `useToolActionDetail` (composio-only today).

## Testing

Unit tests belong in `web/packages/agenta-entity-ui/tests/unit/` (package convention).

- `parseGatewayTool`: canonical object, legacy function-name, dotted/`__` slug variants,
  non-gateway function tool, builtin, reference, junk → correct view or `null`; `provider`
  defaults to `composio` when absent; `encoding` is set correctly.
- `gatewayToolIdentity`: legacy and canonical for the same action + connection produce the
  **same** identity (this is what makes the drawer's added-state match across encodings);
  different connection/action differ; `permission` and `encoding` do not affect it; a
  connection slug containing a dot does not collide with a different split.
- `describeTool`: canonical `type:"gateway"` → name = humanized action, tag = integration,
  subtitle "Connected app tool · …", **not** built-in.
- `ToolManagementList` partition: a canonical entry lands in the provider group, not
  `builtins`; and a canonical + a legacy entry for the same integration land in the **same**
  provider group.
- `editView`: a syntactic gateway tool (either encoding) → `"form"`, `jsonOnly` false.
- Drill-in body (component test of `GatewayToolFormView`): pending → spinner (no raw-JSON
  flash); resolved → identity + description + schema preview + permission; terminal failure
  → warning banner (fail-safe), JSON toggle still present.
- Add-path: `selectedGatewayIds` derived from a config holding a canonical tool marks the
  matching drawer action selected; `removeGatewayToolByIdentity` removes exactly one match,
  leaving a duplicate in place.
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
