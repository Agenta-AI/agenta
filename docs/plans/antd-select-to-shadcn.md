# antd Select → shadcn Select Migration Plan

> **Goal:** Replace all 55+ antd `Select` usage sites with the shadcn `Select` from `@agenta/primitive-ui/components/select` (built on `@base-ui/react/select`).
> **Hard rule: zero functional changes.** UI-layer swap only. Icon sizes, visual proportions, and interactions must match.

## Repo context

This plan is a focused sub-migration under the broader `docs/antd-to-shadcn-migration-plan.md`. The broad plan covers all 760 antd-importing files across Typography/Button/Form/Table/etc. This document drills into the **Select census only** (58 import sites across ~55 files).

## Why base-ui works for Select

base-ui's `Select` natively supports:

| Feature | base-ui support |
|---|---|
| Single select | `Select.Root` with `value`/`onValueChange` |
| Multi-select | `Select.Root multiple` with `values`/`onValuesChange` |
| Controlled open state | `open`/`onOpenChange` on `Root` |
| Object values | `itemToStringValue`/`itemToStringLabel` on `Root` |
| Grouped items | `Select.Group` + `Select.GroupLabel` |
| Placeholder | `<Select.Value placeholder="..." />` |
| Custom label render | `<Select.Value>{(value) => <Custom />}</Select.Value>` |
| Portal positioning | Built into `Select.Portal` |
| Keyboard navigation | Built-in |
| Form submission | Hidden `<input>` via `name` prop |

**Not supported (needs custom work):**
- Search/filter (`showSearch`, `filterOption`) → use base-ui `Combobox` or build a `SearchableSelect`
- Freeform tag input (`mode="tags"`) → new `TagInput` component
- `allowClear` → add clear button in trigger or `null` item in list
- Custom dropdown rendering (`popupRender`) → manual render with base-ui `Popover`

## Migration phases

### Phase 0: Prerequisite — build missing primitives

Create two new components in `web/packages/agenta-primitive-ui/src/components/`:

1. **`tags-input.tsx`** — Freeform tag entry with optional suggestion dropdown.
   - Replaces `mode="tags"` with `open={false}` + `suffixIcon={null}` (the no-dropdown pattern).
   - Built on `Input` + `Tag`/`Badge` + optional base-ui `Popover` for dropdown suggestions.
   - Supports `tokenSeparators` (comma, enter, etc.), number coercion, max tags.

2. **`combobox.tsx`** — Searchable single-select.
   - Replaces `showSearch` + `filterOption` + `optionFilterProp="label"`.
   - Built on base-ui `Combobox` or a controlled `Popover` + `Input` + `ScrollArea` + item list.
   - Single-select only; multi-searchable is covered by multi-select + search (if needed).

No changes needed to `select.tsx` — base-ui already exposes `multiple`, `open`/`onOpenChange`, `items`, object values, and group support through the existing API.

### Phase 1: Simple single-select (~30 files)

**Pattern:** Replace monolithic antd `<Select>` with the shadcn composition.

**Before:**
```tsx
import { Select } from "antd"
<Select value={val} onChange={setVal} options={opts} placeholder="Pick" className="w-40" />
```

**After:**
```tsx
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@agenta/primitive-ui/components/select"
<Select value={val} onValueChange={setVal}>
  <SelectTrigger className="w-40">
    <SelectValue placeholder="Pick" />
  </SelectTrigger>
  <SelectContent>
    {opts.map(o => <SelectItem key={o.value} value={o.value}>{o.label}</SelectItem>)}
  </SelectContent>
</Select>
```

**Key mappings:**
| antd | shadcn |
|---|---|
| `onChange={(v) => ...}` | `onValueChange={(v) => ...}` |
| `value={null}` | `value={null}` (same type) |
| `size="small"` | `<SelectTrigger size="sm">` |
| `placeholder="..."` | `<SelectValue placeholder="..." />` |
| `disabled={bool}` | `disabled={bool}` on `<Select>` |
| `className="w-40"` | `<SelectTrigger className="w-40">` |
| `style={{minWidth: 200}}` | `<SelectTrigger style={{minWidth: 200}}>` |
| `variant="borderless"` | Remove; use tailwind classes on `<SelectTrigger>` |
| `popupMatchSelectWidth={false}` | `<SelectContent>` accepts `className` for width override |
| `allowClear` | Add a `null` item in the options list, or a clear button next to trigger |
| `status="error"` | `data-invalid` attribute on `<SelectTrigger>` |
| `loading` | Show `<Spinner />` in the trigger or content |

**Number values:** coerce at the boundary:
```tsx
<Select value={String(num)} onValueChange={(v) => onChange(v ? Number(v) : undefined)}>
```

**Selection-only files (no search, no custom render):**
| File | Path |
|---|---|
| AddPropertyForm | `web/oss/src/components/AddPropertyForm.tsx` |
| WebhookFieldRenderer | `web/oss/src/components/Webhooks/WebhookFieldRenderer.tsx` |
| AdvanceConfigWidget | `web/oss/src/components/Webhooks/AdvanceConfigWidget.tsx` |
| ConnectModal | `web/oss/src/components/pages/settings/Tools/components/ConnectModal.tsx` |
| InviteUsersModal | `web/oss/src/components/pages/settings/WorkspaceManage/Modals/InviteUsersModal.tsx` |
| ConnectDrawer | `web/packages/agenta-entity-ui/src/gatewayTrigger/drawers/ConnectDrawer.tsx` |
| TriggerConnectDrawer | `web/packages/agenta-entity-ui/src/gatewayTrigger/drawers/TriggerConnectDrawer.tsx` |
| RunVersionField | `web/packages/agenta-entity-ui/src/gatewayTrigger/drawers/RunVersionField.tsx` |
| SandboxPermissionControl | `web/packages/agenta-entity-ui/src/DrillInView/SchemaControls/SandboxPermissionControl.tsx` |
| ToolFormView | `web/packages/agenta-entity-ui/src/DrillInView/SchemaControls/ToolFormView.tsx` |
| ClaudePermissionsControl | `web/packages/agenta-entity-ui/src/DrillInView/SchemaControls/ClaudePermissionsControl.tsx` |
| PromptSchemaControl | `web/packages/agenta-entity-ui/src/DrillInView/SchemaControls/PromptSchemaControl.tsx` |
| ResponseFormatControl | `web/packages/agenta-entity-ui/src/DrillInView/SchemaControls/ResponseFormatControl.tsx` |
| JsonArrayField | `web/packages/agenta-entity-ui/src/DrillInView/SchemaControls/JsonArrayField.tsx` |
| DrillInControls | `web/packages/agenta-entity-ui/src/DrillInView/DrillInControls.tsx` |
| ChatInputs | `web/packages/agenta-ui/src/components/chat/ChatInputs.tsx` |
| TemplateFormatPicker | `web/packages/agenta-ui/src/components/presentational/select/TemplateFormatPicker.tsx` |
| SchemaForm | `web/packages/agenta-entity-ui/src/gatewayTool/components/SchemaForm.tsx` |
| DrillInContent | `web/ee/src/pages/.../DrillInContent.tsx` (find exact path) |
| EntityDualViewEditor | `web/ee/src/pages/.../EntityDualViewEditor.tsx` (find exact path) |
| TraceSpanDrillInView | `web/ee/src/pages/.../TraceSpanDrillInView.tsx` (find exact path) |
| MetricField | `web/oss/src/components/MetricField.tsx` (non-tags paths) |
| AnnotationInputs | `web/oss/src/components/.../AnnotationInputs.tsx` (non-tags paths) |
| OnlineEvaluationDrawer | `web/oss/src/components/.../OnlineEvaluationDrawer.tsx` |
| MappingSection | `web/oss/src/components/.../MappingSection.tsx` |
| ListOfOrgs | `web/oss/src/components/.../ListOfOrgs.tsx` |
| AnnotationFormField | `web/packages/agenta-annotation-ui/src/.../AnnotationFormField.tsx` |
| AnnotationStatusFilterSelect | `web/packages/agenta-annotation-ui/src/.../AnnotationStatusFilterSelect.tsx` |
| SelectWorkflowSection | `web/oss/src/components/.../SelectWorkflowSection.tsx` |
| FallbackConfigTab | `web/packages/agenta-entity-ui/src/.../FallbackConfigTab.tsx` |
| RetryConfigTab | `web/packages/agenta-entity-ui/src/.../RetryConfigTab.tsx` |

### Phase 2: Grouped option selects

Files that use antd's grouped `options` pattern `{label: "Group", options: [...]}`.

**Pattern:**
```tsx
// antd
<Select options={[
  { label: "Group1", options: [{ value: "a", label: "A" }] },
  { label: "Group2", options: [{ value: "b", label: "B" }] },
]} />

// shadcn
<Select>
  <SelectTrigger><SelectValue placeholder="..." /></SelectTrigger>
  <SelectContent>
    <SelectGroup>
      <SelectLabel>Group1</SelectLabel>
      <SelectItem value="a">A</SelectItem>
    </SelectGroup>
    <SelectSeparator />
    <SelectGroup>
      <SelectLabel>Group2</SelectLabel>
      <SelectItem value="b">B</SelectItem>
    </SelectGroup>
  </SelectContent>
</Select>
```

**Files:** `SelectWorkflowSection.tsx`, `HierarchyLevelSelect.tsx`, `DrillInContent.tsx`, `Filters.tsx` (grouped sections)

### Phase 3: Custom option/label rendering

Files using `optionRender`, `labelRender`.

**`optionRender` pattern:**
```tsx
// antd
<Select
  options={opts.map(o => ({ value: o.id, label: o.name, description: o.desc }))}
  optionRender={(option) => (
    <div><div>{option.data.label}</div><div className="text-xs">{option.data.description}</div></div>
  )}
/>

// shadcn
<Select>
  <SelectTrigger><SelectValue placeholder="..." /></SelectTrigger>
  <SelectContent>
    {opts.map(o => (
      <SelectItem key={o.id} value={o.id}>
        <div><div>{o.name}</div><div className="text-xs">{o.desc}</div></div>
      </SelectItem>
    ))}
  </SelectContent>
</Select>
```

**`labelRender` pattern:**
```tsx
// antd  
<Select
  options={opts}
  labelRender={({value}) => friendlyName(String(value))}
/>

// shadcn
<Select value={val} onValueChange={setVal}>
  <SelectTrigger>
    <SelectValue>
      {() => <span>{friendlyName(val)}</span>}
    </SelectValue>
  </SelectTrigger>
  ...
</Select>
// Or use a custom trigger that reads the value directly
```

**Files:** `ScenarioNavigator.tsx`, `FocusDrawerHeader.tsx`, `HarnessSelectControl.tsx`, `CodeBlockLanguageMenu.tsx`, `Filters.tsx`, `FallbackConfigTab.tsx`, `RetryConfigTab.tsx`, `ListOfOrgs.tsx`

### Phase 4: Searchable selects (use combobox.tsx)

Files with `showSearch`, `filterOption`, `optionFilterProp="label"`.

**Pattern:**
```tsx
// antd
<Select showSearch optionFilterProp="label" options={opts} />

// shadcn (using combobox from Phase 0)
<Combobox value={val} onValueChange={setVal} items={opts}>
  <ComboboxInput placeholder="Search..." />
  <ComboboxList>
    {opts.map(o => <ComboboxItem key={o.value} value={o.value}>{o.label}</ComboboxItem>)}
  </ComboboxList>
</Combobox>
```

**Files:** `GroupedChoiceControl.tsx`, `PathSelectorDropdown.tsx`, `EnumSelectControl.tsx`, `HarnessSelectControl.tsx`, `ScenarioNavigator.tsx`, `FocusDrawerHeader.tsx`, `CodeBlockLanguageMenu.tsx`, `EvaluationRunsFiltersContent.tsx`, `HierarchyLevelSelect.tsx`, `Filters.tsx`

### Phase 5: Multi-select (`mode="multiple"`) — use base-ui `multiple`

base-ui `Select.Root` accepts `multiple` prop. Values become arrays.

**Pattern:**
```tsx
// antd
<Select mode="multiple" value={vals} onChange={setVals} options={opts} />

// shadcn
<Select multiple value={vals} onValueChange={setVals}>
  <SelectTrigger>
    <SelectValue>{/* render comma-separated or tag list */}</SelectValue>
  </SelectTrigger>
  <SelectContent>
    {opts.map(o => <SelectItem key={o.value} value={o.value}>{o.label}</SelectItem>)}
  </SelectContent>
</Select>
```

**Custom trigger rendering for multi-select** (tag-like display):
```tsx
<SelectTrigger>
  <SelectValue>
    {(values: string[]) => values.length === 0
      ? "Select..."
      : values.map(v => <Tag key={v}>{labels[v]}</Tag>)
    }
  </SelectValue>
</SelectTrigger>
```

**Files:** `WebhookDrawer.tsx`, `AnnotationInputs.tsx`, `EvaluationRunsFiltersContent.tsx`, `ScheduleBuilderField.tsx`, `SessionNavigation.tsx`, `Filters.tsx`, `AnnotationFormField.tsx`

### Phase 6: Tags mode — use `tags-input.tsx`

**Pattern (no-dropdown tags):**
```tsx
// antd
<Select mode="tags" open={false} suffixIcon={null}
  value={tags} onChange={setTags}
  tokenSeparators={[","]}
/>

// shadcn
<TagInput value={tags} onChange={setTags}
  separator=","
  placeholder="Type and press enter..."
/>
```

**Pattern (tags with suggestion dropdown):**
```tsx
<TagInput value={tags} onChange={setTags}
  options={availableOptions}
  separator=","
/>
```

**Files (no-dropdown):** `McpServerFormView.tsx`, `ScenarioFilterBar.tsx`, `ParameterNodeEditor.tsx`
**Files (with dropdown):** `Filters.tsx`, `EvaluationRunsFiltersContent.tsx`, `MetricField.tsx`

### Phase 7: Complex wrappers

| File | Challenge | Strategy |
|---|---|---|
| `SelectLLMProviderBase.tsx` | Custom `popupRender` with cascading provider menus, embedded search, `OptGroup`/`Option` children, controlled open state | Rewrite using base-ui `Popover` + controlled `Select` + manual item rendering. Keep `Option`/`OptGroup` structure; replace with `SelectGroup` + manual DOM. `open`/`onOpenChange` already on `Select.Root`. |
| `HierarchyLevelSelect.tsx` | Generic `<T>` wrapper with `filterOption`, `loading`, `notFoundContent`, grouped options | Refactor to use shadcn `Select` internally. `notFoundContent` → `SelectContent` `children` fallback. `loading` → `<Spinner />` in content. |
| `EnumSelectControl.tsx` | Schema-driven, `filterOption`, `showSearch`, falls back to `SimpleDropdownSelect` | Route to `Combobox` when searchable, shadcn `Select` when basic. |
| `GroupedChoiceControl.tsx` | Routes model fields to `SelectLLMProviderBase`, others to antd Select | Handled via `SelectLLMProvider` rewrite + direct shadcn `Select` for non-model groups. |
| `AnnotationInputs.tsx` / `AnnotationFormField.tsx` | Value normalization for `multiple`/`tags` modes | Handle in the migration wrapper; normalization moves to `onValueChange` handler. |

### Phase 8: Type-only imports cleanup

Files importing only `SelectProps` or `DefaultOptionType` from antd for type annotations.

**Files:** `Sort.tsx`, `useEvaluatorSelection.tsx`, `SelectLLMProviderBase/types.ts`

**Strategy:** Replace with locally-defined types or import from base-ui (`Select.Root.Props`).

### Phase 9: suffixIcon removal and icon alignment

Antd Select uses a default dropdown icon that some files override. shadcn Select uses `CaretDownIcon` (Phosphor, 16px via `size-4`).

**Files with custom `suffixIcon={<CaretDownIcon size={14} />}`:** `Filters.tsx` (9 selects)

These are **already** using the same icon family (Phosphor). The size difference (14 vs 16) is negligible — the shadcn default icon matches. **No custom icon slot needed** — just remove the `suffixIcon` prop.

**Files with `suffixIcon={null}`:** `ScenarioFilterBar.tsx`, `McpServerFormView.tsx`, `ParameterNodeEditor.tsx`

These are the tags-no-dropdown pattern. In the new `TagInput` component, there is no trigger icon at all — handled naturally.

## File-by-file migration checklist

For each file, the migration follows these steps:

1. **Add imports** from `@agenta/primitive-ui/components/select` (and `combobox`/`tags-input` if needed)
2. **Remove** `import { Select } from "antd"` (and `SelectProps` if no longer used)
3. **Replace** monolithic `<Select>` with composition (`<Select><SelectTrigger><SelectValue/><SelectContent><SelectItem/></SelectContent></Select>`)
4. **Map `onChange` → `onValueChange`** (string type)
5. **Coerce non-string values** at the boundary (`String()` / `Number()`)
6. **Replace `options` prop** with `<SelectItem>` mapping
7. **Replace `placeholder`** with `<SelectValue placeholder="">`
8. **Move `className`/`style`** to `<SelectTrigger>`
9. **Replace `allowClear`** with a `null` item in list or clear button
10. **Replace `size="small"`** with `<SelectTrigger size="sm">`
11. **Replace `suffixIcon`** — remove; shadcn default matches
12. **Replace `antd Form.Item` context** with `<FormField>` from `@agenta/primitive-ui/components/form`
13. **Remove `getPopupContainer`** — not needed (Portal is always used)
14. **Remove `variant="borderless"`** — replace with `className` tailwind overrides
15. **Remove `popupClassName`** — replace with `className` on `<SelectContent>`

## Testing

- After each file, run `pnpm lint-fix` within `web/`
- TypeScript check: `pnpm lint` from `web/`
- Visual check: render, open, select, close, dark mode
- Multi-select: tag add/remove, clear
- Tags input: freeform entry, comma-separated, enter key, number coercion
- Searchable: typing filters list, keyboard navigation through filtered results

## Effort estimate

| Phase | Components | Files | Est. effort |
|---|---|---|---|
| Phase 0: Build primitives | combobox, tags-input | 2 new | 2-3 days |
| Phase 1: Simple single-select | None | ~30 | 2-3 days |
| Phase 2: Grouped selects | None | ~4 | 0.5 day |
| Phase 3: Custom rendering | None | ~8 | 0.5-1 day |
| Phase 4: Searchable | combobox | ~10 | 1-2 days |
| Phase 5: Multi-select | None (base-ui `multiple`) | ~7 | 1 day |
| Phase 6: Tags mode | tags-input | ~6 | 1-2 days |
| Phase 7: Complex wrappers | None | ~4 | 2-3 days |
| Phase 8: Type cleanup | None | ~3 | 0.5 day |
| Phase 9: Icon alignment | None | ~12 | 0.5 day |
| **Total** | **2 new** | **~55+ files** | **~11-16 days** |

Within-file ordering: shared packages → oss → ee (shared first since oss/ee depend on them).

## Risk matrix

| Risk | Impact | Likelihood | Mitigation |
|---|---|---|---|
| Tags mode edge cases (number coercion, token separators) | Medium | High | Build TagInput with these specific cases as first-class features |
| Searchable select UX regressions | Medium | Medium | Prototype combobox early with keyboard nav, debounced search |
| `SelectLLMProviderBase` cascading popups | High | Low | Proof-of-concept with base-ui Popover before committing the rewrite |
| Form.Item → FormField migration mismatch | Medium | Medium | Per-file visual check; FormField accepts same control pattern |
| Dark mode rendering divergence | Low | Low | shadcn default dark tokens match existing `.dark` mechanism |
| value as number/object type mismatches | Low | High | Coerce at boundary; verify with type-check |
