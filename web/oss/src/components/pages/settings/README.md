# Settings

Every Settings tab renders inside one shared frame. This document is the contract — read it
before adding a tab, adding a table, or changing a page's layout.

## Overview

Settings has its own page shell rather than the app-wide `PageLayout`. The two differ on
purpose: Settings uses a wider responsive gutter, caps its content, and requires a
description on every page. Keeping them separate lets Settings evolve without touching
Prompts, Agents, Evaluators, Observability or Testsets.

```text
┌─ rail 260 ─┬─ gutter ─────────────────────────────────────────────┐
│            │  HEADER    title · description · optional docs link  │
│            │  TOOLBAR   filters left · refresh + primary right    │
│            │  CONTENT   one table, or stacked sections            │
└────────────┴──────────────────────────────────────────────────────┘
```

Gutter is 16px below 768, 24px to 1024, 32px to 1280, 40px above. Content caps at 1120 (tables) or 640
(forms), left-anchored.

## Structure

```text
settings/
├── components/
│   ├── SettingsPageShell.tsx   # gutter, content cap, header
│   └── SettingsToolbar.tsx     # the toolbar band
├── hooks/
│   └── useStaticTable.ts       # tableScope + no-op pagination for a materialized list
├── assets/
│   ├── navigation.ts           # tab registry: label, scope, description, docs
│   └── navigation.test.ts      # asserts every tab has a description
├── APIKeys/                    # reference implementation — copy this one
└── <Tab>/                      # one folder per tab
```

The shell is rendered **once**, centrally, in
`web/oss/src/pages/w/[workspace_id]/p/[project_id]/settings/index.tsx`. Tab components render
only their toolbar and content — never their own page header.

## Quick Start

### Adding a tab

1. Add the key to `SettingsTabKey` and a row to `SETTINGS_TABS` in `assets/navigation.ts`.
   `description` is **required** — it is what renders under the page title.

```typescript
{
    key: "webhooks",
    scope: "project",
    description:
        "Send workflow events to your own HTTP endpoints, with signed payloads and delivery retries.",
    docs: {label: "Webhook docs", href: `${DOCS_BASE}/…`},   // optional
}
```

2. Add the label to `SETTINGS_LABELS`, an icon in `Sidebar/scopes/settingsScope.tsx`, and a
   `case` in the central switch. The shell picks up the title and description automatically.

### Adding a table page

`APIKeys/APIKeys.tsx` is the reference. The shape:

```tsx
// Settings lists are fully materialized: no fetching, no pagination.
const {tableScope, pagination} = useStaticTable<Row>("settings-<tab>", rows)

return (
    <div className="flex flex-col gap-4">
        <SettingsToolbar
            filters={<Input.Search placeholder="Search …" className="w-[260px]" />}
            actions={
                <>
                    <Button type="text" icon={<ArrowClockwise size={14} />} />
                    <Button type="primary" icon={<Plus size={14} />}>Create</Button>
                </>
            }
        />
        <InfiniteVirtualTableFeatureShell<Row>
            tableScope={tableScope}
            autoHeight={false}
            columns={columns}
            rowKey={(record) => record.key}
            pagination={pagination}
            tableProps={{size: "small", bordered: true, tableLayout: "fixed"}}
        />
    </div>
)
```

Pass rows through `useStaticTable` and read them from its `pagination` — do **not** also
pass `dataSource` (it overrides `pagination.rows`). The row identity comes from the shell's
`rowKey` prop; make sure whatever it returns is unique and non-empty for every row (fall
back to the row index, never to `""`), or React keys collide silently.

Row types need `key` and an index signature to satisfy `InfiniteTableRowBase`:

```typescript
interface Row extends MyEntity {
    key: string
    id: string
    [extra: string]: unknown
}
```

### Single-table page vs multi-section page

A tab with **one** table (API Keys, Members, Projects, Webhooks, Secrets, Organizations)
renders `SettingsToolbar` above the table. The page header already says what the page is,
so the table itself carries no title.

A tab with **several** sections (Triggers, LLMs) gives each section its own header instead,
via the table shell's own props — the toolbar would otherwise have to belong to one section
and float above all of them:

```tsx
<InfiniteVirtualTableFeatureShell
    title="Event triggers"
    description="Run a workflow whenever an event fires in a connected app."
    primaryActions={<><Button type="text" icon={<ArrowClockwise />} /><Button type="primary">Subscribe</Button></>}
    …
/>
```

Both put the primary action on the right. Never use both on one table.

### Columns

Use `createStandardColumns` from `@agenta/ui/table`. The cell vocabulary is closed:

| Type | Use for |
| --- | --- |
| `text` | plain values, dates you format yourself |
| `date` | timestamps (formats for you) |
| `mono` | API keys, masked secrets, hashes |
| `slug` | any identifier worth copying — ships its own copy button |
| `entity` | avatar + name, with optional trailing chips |
| `user` | a user id resolved through `UserReference` |
| `actions` | the `⋯` menu, pinned right |

```typescript
createStandardColumns<Row>([
    {type: "entity", key: "name", title: "Member", getChips: (r) => r.isYou ? [{label: "You"}] : []},
    {type: "slug", key: "id", title: "Project ID", width: 330},
    {type: "date", key: "created_at", title: "Created", width: 150},
    {type: "actions", showColumnVisibility: false, items: [...]},
])
```

## The four rules

These are what the shell exists to enforce. A change that breaks one is a review blocker.

1. **Description is mandatory and comes from the registry.** Never pass a description from a
   tab component — it lives in `navigation.ts` so no tab can ship without one, and so all
   fourteen read as one voice. `navigation.test.ts` fails the build if one is missing.

2. **Actions go in the toolbar, never the header.** The header holds title, description and
   at most one tertiary docs link. Primary actions belong in `SettingsToolbar`'s `actions`
   slot — right side, primary button last. Search and filters go left.

3. **Tables use the virtualized shell.** `InfiniteVirtualTableFeatureShell` with the
   static-array idiom above. Do not hand-configure a raw antd `<Table>`, and do not restyle
   table chrome — header height, row height, dividers and hover all come from the component.
   Pass `showColumnVisibility: false` on the actions column: settings columns are fixed per
   page, so the gear has nothing to toggle. Get `tableScope`/`pagination` from
   `useStaticTable` — never hand-roll the no-op pagination shape.

4. **Row actions go in `⋯`; copy is a cell button.** No loose inline icons, no bare glyphs
   with `onClick` (they are not focusable and have no accessible name). Any identifier worth copying gets a `slug` column, which carries its own copy affordance — copying is
   never a `⋯` menu item.

One more, inherited from the design: **nothing stacks onto a second line inside a cell.** If a
value needs its own place, give it its own column.

## API Reference

### `SettingsPageShell`

| Prop | Type | Notes |
| --- | --- | --- |
| `title` | `ReactNode` | Rendered at heading-3 size |
| `description` | `ReactNode` | Required |
| `docs` | `{label, href}` | Optional; opens in a new tab |
| `variant` | `"table" \| "form"` | Caps content at 1120 or 640. Default `table` |
| `fullHeight` | `boolean` | Bounds the page so an internally-scrolling table does not grow it |

### `SettingsToolbar`

| Prop | Type | Notes |
| --- | --- | --- |
| `filters` | `ReactNode` | Left cluster: search, filter selects |
| `actions` | `ReactNode` | Right cluster: refresh first, primary action last |

Both ends always render, so the primary action stays right-aligned on pages with no filters.
