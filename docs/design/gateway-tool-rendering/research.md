# Research

All citations verified against the working tree on 2026-07-07. Paths are relative to the
repo root.

## The two encodings

### Canonical (persisted / SDK-authored)

`sdks/python/agenta/sdk/agents/tools/models.py:105`

```python
class GatewayToolConfig(ToolConfigBase):
    type: Literal["gateway"] = "gateway"
    provider: str = Field(default="composio", min_length=1)
    integration: str = Field(min_length=1)
    action: str = Field(min_length=1)
    connection: str = Field(min_length=1)
    name: Optional[str] = Field(default=None, min_length=1)
```

No `function` key. `permission` is inherited from `ToolConfigBase`.

### Legacy (UI-authored)

`web/…/agentTemplate/AgentIntegrationDrawer.tsx:181` writes an OpenAI-style function tool
whose `function.name` is the gateway slug and stashes routing hints in `agenta_metadata`:

```ts
onAddTool(
  { type: "function", function: { name: slug, description, parameters } },
  { source: "gateway", provider, toolCode, integrationKey, connectionSlug, needsConfig },
)
```

where `slug = tools__{provider}__{integration}__{action}__{connection}` (built by
`buildToolSlug`, mirrors `parseGatewayFunctionName`).

### They are equivalent server-side

- `sdks/python/agenta/sdk/agents/tools/compat.py:36` `_parse_gateway_slug` converts a
  legacy `tools__…` (or dotted) slug into the canonical dict; `coerce_tool_config`
  (`compat.py:62`) short-circuits a `type:"gateway"` object straight to
  `parse_tool_config`. Both arrive at the same `GatewayToolConfig`.
- `api/oss/src/core/tools/service.py:432` `_resolve_composio_tool` enriches
  **description + input schema** from the live catalog action at run time (`get_action`
  → `action.schemas.inputs`). So the FE never needs to persist the schema; the catalog
  is authoritative.

**Conclusion:** the config is correct and runs. The gap is entirely the FE read path.

## The single legacy parser everything keys off

`web/packages/agenta-entity-ui/src/DrillInView/SchemaControls/toolUtils.ts:34`

```ts
export function parseGatewayFunctionName(name: string | undefined): GatewayToolParsed | null {
    const parts = (name ?? "").split("__")
    if (parts.length !== 5 || parts[0] !== "tools") return null
    const [, provider, integration, action, connection] = parts
    return { provider, integration, action, connection }
}
```

It takes a **string function name**. Every consumer below calls it with
`tool.function.name`, so the canonical object (no `function`) produces `null` everywhere.

## Where the canonical shape falls through — per consumer

### 1. Row descriptor — `itemDescriptors.tsx`

`describeTool()` (`itemDescriptors.tsx:143`):

- Line 175: `const gateway = fnName ? parseGatewayFunctionName(fnName) : null` — `fnName`
  is `tool.function?.name`, undefined for canonical → `gateway = null`.
- Lines 196–210 (builtin fallback): with no `function`, it names the row from
  `t.type` → **"gateway"**, tags **["built-in"]**, `typeLabel:"built-in"`, subtitle
  "Provider built-in tool". **This is the misrender.**
- The `type:"reference"` branch (line 152) is checked first and shows the pattern to
  copy: a discriminator branch **before** the builtin fallback.

### 2. List grouping — `ToolManagementList.tsx`

Partition logic (`ToolManagementList.tsx:237`):

```ts
const gw = parseGatewayFunctionName(toolName(item))   // toolName = item.function.name
if (gw) { /* group under gw.integration */ return }
…
if (!isFunctionTool(item)) { builtins.push(...); return }   // canonical lands here
```

`toolName(item)` returns `item.function?.name` (`itemDescriptors.tsx:35`) → undefined →
`gw = null`. `isFunctionTool` requires a `function` object (`itemDescriptors.tsx:72`) →
false → canonical is pushed to **`builtins`**, rendered under the flat **"Built-in"**
sub-section (`ToolManagementList.tsx:306`). Confirmed.

The gateway grouping target already exists: **Connected apps** → `CollapsibleProviderGroup`
keyed by `gw.integration` (`ToolManagementList.tsx:175`, `:243`).

### 3. Drill-in editor view — `itemKinds.tsx` + `ToolItemControl.tsx` / `ToolFormView.tsx`

- `itemKinds.tsx:85`
  `editView: (item) => (isFunctionTool(item) || isReferenceTool(item) ? "form" : "json")`
  — canonical is neither → opens **JSON-only** (`jsonOnly` also true, `itemKinds.tsx:86`).
- `ToolItemControl.tsx:619` `parseGatewayFunctionName(functionName)` → null;
  `isGatewayTool` (`:620`) also checks `agenta_metadata.source === "gateway"`, absent on
  canonical → **false** → no gateway header, raw JSON body. `inferIsBuiltinTool`
  (`ToolItemControl.tsx:92`) returns true for the bare `type:"gateway"` object, so the
  header label becomes "Gateway".
- `ToolFormView.tsx:33,153` also keys gateway rendering off
  `parseGatewayFunctionName(fn.name)` — canonical never reaches the Form anyway (it's
  JSON-only), but the Form's gateway-awareness is legacy-slug-only too.

### 4. Add / remove / dedupe — `useAgentTools.ts` + `AgentIntegrationDrawer.tsx`

- `selectedToolNames` (`useAgentTools.ts:130`) = `new Set(tools.map(toolName)…)` — the set
  of legacy `function.name` slugs. Canonical tools contribute **nothing** to this set.
- The drawer decides add-vs-remove and the "selected" checkmark from that set:
  `AgentIntegrationDrawer.tsx:155` `selectedToolNames.has(slug)`, `:250` `itemState`,
  `:285` `addedCount`. A canonical Slack `OPEN_DM` tool therefore reads as **not added** →
  the user can add a duplicate, and cannot toggle it off.
- Removal: `onRemoveTool(slug)` → `handleRemoveToolByName` (`useAgentTools.ts:111`) filters
  by `toolName(tool) !== name`. Canonical has no `function.name` → never matches → **cannot
  be removed** through the drawer toggle. (`handleRemoveBuiltinTool` matches canonical by
  `isBuiltinPayloadMatch`, which is how the row's own remove button still works — but the
  drawer's action toggle uses the name path.)

## Catalog action-detail endpoint (available for drill-in enrichment)

- API: `GET /tools/catalog/providers/{provider}/integrations/{integration}/actions/{action}`.
- FE plumbing already exists:
  - `fetchToolActionDetail(provider, integration, action)` —
    `web/packages/agenta-entities/src/gatewayTool/api/api.ts:137`.
  - `useToolActionDetail(integrationKey, actionKey)` hook (cached, `staleTime` 5 min,
    returns `{ action, isLoading, error }`) —
    `web/packages/agenta-entities/src/gatewayTool/hooks/useToolActionDetail.ts:29`.
  - `action.schemas.inputs` carries the model-facing input schema; `action.description`
    the friendly text.
- Integration logo for the header: `gatewayTools.useIntegrationInfo(integrationKey)` is
  already wired through `useDrillInUI()` and consumed by `ToolItemControl`'s gateway
  header (`ToolItemControl.tsx:330`).

## Files in scope (read path only)

All under `web/packages/agenta-entity-ui/src/DrillInView/SchemaControls/`:

- `toolUtils.ts` — home of the shared parser (add `parseGatewayTool` + identity helper).
- `agentTemplate/itemDescriptors.tsx` — `describeTool` gateway branch.
- `agentTemplate/ToolManagementList.tsx` — partition/grouping.
- `agentTemplate/itemKinds.tsx` — `editView` / `jsonOnly` for gateway.
- `agentTemplate/useAgentTools.ts` — `selectedToolNames`, removal by identity.
- `agentTemplate/AgentIntegrationDrawer.tsx` — compare against normalized identity.
- `ToolItemControl.tsx` and/or a new gateway detail view — the drill-in.
- `ToolFormView.tsx` — only if we route gateway drill-in through it.

**None** of these are the sibling files carrying uncommitted secret-isolation edits
(`connectionUtils.ts`, `ProviderCredentialsSection.tsx`, `useModelHarness.tsx`,
`CustomProviderForm.tsx`, `ModelNameInput.tsx`). The two change sets are disjoint.
