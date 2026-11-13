# PRD: Gateway Tools UI Improvements

**Date:** 2026-02-23  
**Status:** Ready for implementation  
**Scope:** Frontend only — no API changes required

---

## Context

The gateway-tools feature (Composio-backed third-party tool integrations) is live on `feat/add-gateway-tools`. This PRD captures a set of UX improvements identified during manual testing of the deployed branch.

The relevant files are:

| Area | File |
|---|---|
| Catalog drawer (tool list) | `web/oss/src/features/gateway-tools/drawers/CatalogDrawer.tsx` |
| Connect modal (feature module) | `web/oss/src/features/gateway-tools/drawers/ConnectDrawer.tsx` |
| Settings connections table | `web/oss/src/components/pages/settings/Tools/components/GatewayToolsSection.tsx` |
| Playground tool dropdown | `web/oss/src/components/Playground/Components/PlaygroundVariantConfigPrompt/assets/ActionsOutputRenderer.tsx` |

---

## Improvements

---

### 1. Catalog Drawer — Card Height Should Flex to Show Full Description

**Current behaviour:**  
Integration cards in the `CatalogDrawer` (`IntegrationsView`) have a fixed or constrained height. Descriptions longer than ~2 lines are clipped/truncated, so users cannot read them without opening the integration detail.

**Desired behaviour:**  
Card height should be fully content-driven — no clamping, no max-height. The description renders in full regardless of length, and the card grows vertically to accommodate it.

**Acceptance criteria:**
- Remove any `line-clamp`, `max-h`, `overflow-hidden`, or fixed-height class from the description/card in `IntegrationsView`.
- Card height is determined by its content (logo row + name + full description).
- Scrolling the list still works correctly (the scroll container's own overflow handles it, not the card).
- Action count badge and other card elements remain correctly positioned after the change.

---

### 2. Connect Modal — Field Order, Labels, Defaults, and Slug Generation

**Current behaviour:**  
`ConnectDrawer.tsx` shows fields in this order:
1. `slug` (required) — label `"slug (used in tools)"`, placeholder `"e.g. my-{integrationKey}"`
2. `name` (optional) — label `"name (used as display)"`

There are no default values pre-filled. Users must type both before connecting.

**Desired behaviour:**

#### 2.1 Field order
Show **Name** before **Slug** — Name is the user-facing friendly field and should come first.

```
[Name]   ← first
[Slug]   ← second
```

#### 2.2 Label casing
Capitalise both labels:
- `"Name"` (was `"name (used as display)"`)
- `"Slug"` (was `"slug (used in tools)"`)

Optionally keep a short helper/tooltip to explain each:
- Name tooltip: "Display name for this connection"
- Slug tooltip: "Unique identifier used in tool call slugs — lowercase letters, numbers, and hyphens only"

#### 2.3 Default Name
Pre-fill **Name** with the integration's display name (the `name` field from `ToolCatalogIntegration`).  
Example: if the user clicks "Connect" on the Gmail integration, the Name field should default to `"Gmail"`.

#### 2.4 Default Slug — Slugification + Random Suffix

Pre-fill **Slug** with a deterministic-but-unique slug derived from the Name default:

```
slug = slugify(defaultName) + "-" + randomAlphanumeric(3)
```

**Slugification rules:**
- Lowercase
- Replace spaces and underscores with hyphens
- Strip any character that is not `[a-z0-9-]`
- Collapse consecutive hyphens to one
- Trim leading/trailing hyphens

**Random suffix:**
- 3 characters, alphanumeric (`[a-z0-9]`), generated once on modal open (not re-generated on re-render)
- Appended with a hyphen separator: e.g. `"gmail-4k2"`

**Example:**  
Integration name = `"Google Calendar"` → default slug = `"google-calendar-7mx"`

**Implementation note — shared utility:**  
Add a `slugify(text: string): string` utility function in `web/oss/src/features/gateway-tools/utils/slugify.ts` and a `randomAlphanumeric(n: number): string` helper (or inline it). Re-use these wherever slug generation is needed (e.g. `ConnectModal.tsx` in the settings components uses the same pattern).

The slug field should remain fully editable. The default is just a starting point so the user can click "Connect" without any required typing.

#### 2.5 Behaviour summary

| Field | Label | Default value | Required |
|---|---|---|---|
| Name | `"Name"` | Integration display name (e.g. `"Gmail"`) | No |
| Slug | `"Slug"` | `slugify(name) + "-" + randomAlphanumeric(3)` | Yes |

**Acceptance criteria:**
- Name field appears before Slug field.
- Labels are `"Name"` and `"Slug"` (capitalised).
- Both fields are pre-filled on modal open.
- Slug default updates reactively if the user edits the Name field *before touching the Slug field* (standard "auto-slug" UX: once the user manually edits Slug, it stops tracking Name).
- `slugify` is extracted as a reusable utility in `utils/slugify.ts`.
- Existing validation (slug uniqueness, character set) is preserved.

---

### 3. Settings Page — Remove "Composio" Brand Name from Table Header

**Current behaviour:**  
`GatewayToolsSection.tsx` (line ~257) renders:

```tsx
<Typography.Text className="text-sm font-medium">
    Composio integrations
</Typography.Text>
```

**Desired behaviour:**  
Replace with provider-agnostic copy:

```tsx
<Typography.Text className="text-sm font-medium">
    Third-party tool integrations
</Typography.Text>
```

**Rationale:** The UI should not expose the underlying provider (Composio) to end users. Composio is an implementation detail — the user-facing concept is "third-party tool integrations".

**Acceptance criteria:**
- The string `"Composio integrations"` no longer appears in the rendered UI.
- Replacement text is `"Third-party tool integrations"`.
- No other changes to the table layout or columns.
- Audit the rest of `GatewayToolsSection.tsx` and the sibling components (`IntegrationGrid.tsx`, `ConnectModal.tsx`, `AgentaToolsPlaceholder.tsx`) for any other user-visible "Composio" strings and replace them with equivalent provider-agnostic copy.

---

### 4. Playground Tool Dropdown — Show "Third-party integrations" Button When No Connections Exist

**Current behaviour:**  
`ActionsOutputRenderer.tsx` renders the Composio section inside the tool dropdown. When `connections.length === 0`, the section header (and the `+` "Add integration" button) is hidden entirely — the Composio section does not appear.

The `+` add button for inline tools is always visible. There is a visual/UX inconsistency: users can always add Inline tools, but cannot discover third-party integrations until they have at least one connection.

**Desired behaviour:**  
The "Third-party integrations" section header and its `+` button should **always be visible** in the dropdown, regardless of whether `connections.length === 0`.

When there are no connections:
- Show the section header `"Third-party integrations"` with the `+` button (identical layout to the Inline section header).
- Below the header, show a short hint: `"No integrations connected yet"` (muted text, small).
- Clicking `+` opens the `CatalogDrawer` (same as today).

When there are connections:
- Existing behaviour is preserved (show grouped connections with hover → action list).

**Label change:**  
Rename the section label from `"Composio"` to `"Third-party integrations"`. This is the user-facing label in the dropdown left panel.

**Acceptance criteria:**
- Section header `"Third-party integrations"` + `+` button is always rendered in the dropdown.
- When `connections.length === 0`: section header is visible, body shows `"No integrations connected yet"` hint, `+` opens `CatalogDrawer`.
- When `connections.length > 0`: existing connection rows appear below the header as before.
- The string `"Composio"` no longer appears as a user-visible label anywhere in the dropdown.
- The `+` button tooltip should read `"Add third-party integration"` (was `"Add integration"`).
- The button's visual treatment matches the existing `+` on the Inline section (same icon, same size, same hover state).

---

## Out of Scope

- Backend / API changes
- Changes to the tool slug format (`tools__{provider}__{integration}__{action}__{connection}`)
- The `ConnectModal.tsx` in `components/pages/settings/Tools/components/` — this is a secondary/legacy path; apply the same defaults/order there as a follow-up if it remains in use
- Authentication method selection UI (OAuth vs API key) — untouched

---

## File Change Summary

| File | Change |
|---|---|
| `features/gateway-tools/utils/slugify.ts` | **New file** — `slugify()` and `randomAlphanumeric()` utilities |
| `features/gateway-tools/drawers/ConnectDrawer.tsx` | Field order (Name before Slug), labels, defaults, auto-slug behaviour |
| `features/gateway-tools/drawers/CatalogDrawer.tsx` | Remove description line-clamp / fixed height on integration cards |
| `components/pages/settings/Tools/components/GatewayToolsSection.tsx` | Replace `"Composio integrations"` → `"Third-party tool integrations"` |
| `components/Playground/.../ActionsOutputRenderer.tsx` | Always render "Third-party integrations" section; rename label; empty state hint |
