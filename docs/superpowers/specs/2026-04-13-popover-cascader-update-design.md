# PopoverCascaderVariant Update — Design Spec

**Date:** 2026-04-13
**Scope:** Extend `PopoverCascaderVariant` in `@agenta/entity-ui` with multi-select, adapter-driven tabs, grouped items, and layout improvements.
**Constraint:** All changes must be generic — usable by evaluators, testsets, app revisions, and any future entity type. No evaluator-specific logic in the component.

---

## Decisions

| Decision | Choice | Rationale |
|----------|--------|-----------|
| Multi-select | Generic component supports optional `multiSelect` mode | Any entity type may need multi-select |
| Tabs | Adapter-driven via `HierarchyLevel.tabs` | Evaluators define category tabs, testsets provide none — component is agnostic |
| Tabs & groups relationship | Tabs = group filters. "All" shows grouped items; specific tab filters to that group | Matches Figma design, one concept with two presentations |
| Action button position | Moves to top-right header row next to search | Consistent, higher visibility |
| Child panel header | Always shows parent name; multi-select adds count + "Select all" | Provides context in both modes |
| Select all callback | Separate `onSelectAll` for bulk; `onSelect` for individual toggle | Clean atomic `onSelect`, efficient batch path for "select all" |

---

## 1. New & Modified Props on `PopoverCascaderVariantProps`

All new props are optional. Existing usages work unchanged.

```typescript
interface PopoverCascaderVariantProps<TSelection> {
    // ── EXISTING (unchanged) ──
    adapter, onSelect, instanceId, className, disabled,
    size, placeholder, icon, showDropdownIcon, placement,
    panelMinWidth, maxHeight, popupFooter,
    selectedParentId, selectedChildId,
    disabledChildIds, disabledChildTooltip, openChildOnHover,

    // ── EXISTING (kept, repositioned in UI) ──
    onCreateNew        // button moves from bottom to header row
    createNewLabel     // still works

    // ── NEW: Multi-select ──
    multiSelect?: boolean              // enables checkbox UI in child panel
    selectedChildIds?: Set<string>     // controlled: which children are checked
    onSelectAll?: (selections: TSelection[]) => void  // bulk select/deselect

    // ── NEW: Selection summary ──
    selectionSummary?: string          // e.g., "No versions selected" — shown above root list
}
```

- `onSelect` remains the callback for both single-select clicks and multi-select checkbox toggles.
- In multi-select mode, `selectedChildId` is ignored in favor of `selectedChildIds`.
- `selectionSummary` is a simple string prop. Consumer owns the text.

---

## 2. Adapter-Driven Tabs via `HierarchyLevel` Extension

One new optional field on `HierarchyLevel`:

```typescript
interface HierarchyLevel<T> {
    // ── EXISTING (all unchanged) ──
    type, label, getId, getLabel, getLabelNode, getIcon,
    getGroupKey, getGroupLabel,
    listAtom, listAtomFamily, filterItems, ...

    // ── NEW ──
    tabs?: TabDefinition[]
}

interface TabDefinition {
    key: string     // matches getGroupKey() values, or "all" for the everything tab
    label: string   // display text, e.g., "AI/LLM", "Classifiers"
}
```

**How tabs interact with `getGroupKey` / `getGroupLabel`:**

1. Adapter defines `tabs` on the root level (e.g., `[{key: "all", label: "All"}, {key: "ai_llm", label: "AI/LLM"}, ...]`).
2. Adapter defines `getGroupKey(entity)` returning the group key (e.g., `"ai_llm"`, `"classifiers"`).
3. Component renders:
   - **"All" tab active**: Shows all items, grouped by `getGroupKey`, headers via `getGroupLabel`.
   - **Specific tab active**: Filters to items where `getGroupKey(item) === tab.key`, no group headers.

**When adapter provides no `tabs`:** No tabs render. Flat list (current behavior).

---

## 3. Component Layout

```
┌─────────────────────────────────────────────────────────────┐
│ HEADER ROW                                                  │
│ ┌─────────────────────────┐  ┌────────────────────────┐    │
│ │ Search ...              │  │ + New evaluator         │    │
│ └─────────────────────────┘  └────────────────────────┘    │
├─────────────────────────────────────────────────────────────┤
│ TABS (optional, only when adapter provides tabs)            │
│ All | AI/LLM | Classifiers | Similarity | Custom            │
├──────────────────────────────┬──────────────────────────────┤
│ SELECTION SUMMARY (optional) │ CHILD PANEL HEADER           │
│ "No versions selected"       │ <parent_name>                │
│                              │ 0 of 4 selected   Select all │
├──────────────────────────────┼──────────────────────────────┤
│ ROOT PANEL                   │ CHILD PANEL                  │
│                              │                              │
│ ── Group Header ──────       │  [ ] v4                      │
│ item_name  [Tag]             │  [ ] v3                      │
│ 12 versions · Jan 6, 2026   │  [ ] v2                      │
│                              │  [ ] v1                      │
│ item_name  [Tag]             │                              │
│ 12 versions · Jan 6, 2026   │                              │
│                              │                              │
│ ── Group Header ─────        │                              │
│ item_name  [Tag]             │                              │
│                              │                              │
├──────────────────────────────┤                              │
│ POPUP FOOTER (optional)      │                              │
└──────────────────────────────┴──────────────────────────────┘
```

**Changes from current layout:**

1. **Header row**: Search + action button side-by-side at top. `onCreateNew` button moves from bottom to here. `popupFooter` stays at the bottom for other uses (e.g., "Disconnect all").
2. **Tabs row**: Renders below header when `rootLevel.tabs` is present. Active tab state is component-internal.
3. **Selection summary**: Optional text above root list when `selectionSummary` is provided.
4. **Group headers**: When "All" tab is active and `getGroupKey` is defined, items grouped with divider-style headers. When a specific tab is active, no group headers.
5. **Root item rendering**: No change to `EntityListItem`. Rich metadata (tags, counts, dates) handled by adapter's `getLabelNode`.
6. **Child panel header**: New. Always shows parent name. In multi-select mode, adds "X of Y selected" + "Select all" link.
7. **Child panel items**: Single-select: click to select (current). Multi-select: checkboxes.

---

## 4. Behavioral Changes & Edge Cases

**Popover close behavior:**
- Single-select (current): Clicking a child fires `onSelect` and closes the popover. No change.
- Multi-select: Toggling a checkbox fires `onSelect` but the popover stays open. User closes by clicking outside or pressing Escape.

**Tab state:**
- Internal component state, defaults to the first tab (typically "All").
- Resets to first tab when popover reopens (same as search resetting today).
- Search applies within the active tab's filtered items.

**Select all / Deselect all:**
- Appears in child panel header when `multiSelect` is true.
- Some children selected: label shows "Select all", clicking calls `onSelectAll` with all unselected children.
- All children selected: label shows "Deselect all", clicking calls `onSelectAll` with an empty array (consumer interprets as "clear all for this parent").

**Disabled children in multi-select:**
- `disabledChildIds` still works. Disabled items show a checked-but-greyed-out checkbox and are excluded from "Select all".

**Backward compatibility:**
- No `multiSelect` prop: single-select, no checkboxes, no count in child header. Same as today.
- No `tabs` on adapter: no tabs row. Same as today.
- No `selectionSummary`: no summary text. Same as today.
- `onCreateNew` still works: renders in new position (header row instead of bottom).
- `popupFooter` still works: stays at bottom of root panel.
- All existing consumers (playground header, evaluator config, workflow drawer) keep working with zero changes.

---

## 5. Files to Modify

| File | Change |
|------|--------|
| `web/packages/agenta-entity-ui/src/selection/types.ts` | Add `TabDefinition` type, add optional `tabs` field to `HierarchyLevel` |
| `web/packages/agenta-entity-ui/src/selection/components/UnifiedEntityPicker/types.ts` | Add `multiSelect`, `selectedChildIds`, `onSelectAll`, `selectionSummary` to `PopoverCascaderVariantProps` |
| `web/packages/agenta-entity-ui/src/selection/components/UnifiedEntityPicker/variants/PopoverCascaderVariant.tsx` | Implement header row layout, tabs, groups, multi-select child panel, child panel header |
| Evaluator adapter (when consumed) | Add `tabs` and `getGroupKey`/`getGroupLabel` to root level config |

No new files needed. All changes extend existing files.
