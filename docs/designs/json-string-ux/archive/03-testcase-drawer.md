# Testcase Drawer — Fields View, JSON View, Per-Property Editors

**Today:** drawer has Fields ↔ JSON toggle (top-right). Fields view renders properties with widget per type — driven by `detectDataType` (`fieldUtils.ts:185`), which works whether the storage is a real object or a stringified-JSON string. The JSON view faithfully shows the user's stored format (so a stringified-JSON cell shows escaped quotes, by design — preserving the user's data).

What's missing for the RFC: visible type chips, and an opt-in conversion affordance. Detection and round-trip are already in place.

## Wireframe — Fields view (proposed)

```
┌─────────────────────────────────────────────────────────────────────┐
│  ≫   ⌃ ⌄   testcase 1                              [Add to queue]   │
│                                              [Fields ●] [JSON ○]    │
├─────────────────────────────────────────────────────────────────────┤
│ Root                                                                 │
│                                                                      │
│ ⌄ inputs  [obj]  [2 properties]              [⎘] [</>] [drill-in ▸] │
│   ┌────────────────────────────────────────────────────────────────┐│
│   │ ⌄ country  [str]              [→ obj] [→ arr]                  ││
│   │   ┌──────────────────────────┐                                 ││
│   │   │ Tuvalu                   │  ← inline text edit             ││
│   │   └──────────────────────────┘                                 ││
│   │                                                                ││
│   │ ⌄ correct_answer  [str]       [→ obj] [→ arr]                  ││
│   │   ┌──────────────────────────┐                                 ││
│   │   │ The capital of Tuvalu…   │                                 ││
│   │   └──────────────────────────┘                                 ││
│   └────────────────────────────────────────────────────────────────┘│
│                                                                      │
│ ⌄ outputs  [obj]  [2 properties]             [⎘] [</>] [drill-in ▸] │
│   ┌────────────────────────────────────────────────────────────────┐│
│   │ ⌄ countryName  [str]                                           ││
│   │   "Tuvalu"                                                     ││
│   │                                                                ││
│   │ ⌄ capital  [str]                                               ││
│   │   "Funafuti"                                                   ││
│   └────────────────────────────────────────────────────────────────┘│
└─────────────────────────────────────────────────────────────────────┘
```

### Property header anatomy

```
⌄ propertyName  [type-chip]              [actions →]
```

Actions vary by type:

| Type | Available actions |
|---|---|
| string | `[→ obj]`, `[→ arr]`, `[→ num]`, `delete` |
| object | `[</>]` raw JSON edit, `[drill-in]`, `[→ str]`, `delete` |
| array | `[</>]` raw JSON edit, `[drill-in]`, `[→ str]`, `delete` |
| number | `[→ str]`, `delete` |
| boolean | `[→ str]`, `delete` |
| null | `[→ str]`, `delete` |

### Editor per type

| Type | Inline editor |
|---|---|
| string | single-line text input; multi-line collapsible if long |
| number | numeric input |
| boolean | switch / toggle |
| null | read-only "null" badge with `[clear]` action |
| object | code-block widget (Monaco/Lexical) with JSON syntax highlighting + per-key drill-in |
| array | code-block widget with element-by-element drill-in |
| messages | dedicated chat-message renderer (existing `ChatMessageEditor`) |

## Wireframe — JSON view

```
┌─────────────────────────────────────────────────────────────────────┐
│  ≫   ⌃ ⌄   testcase 1                              [Add to queue]   │
│                                              [Fields ○] [JSON ●]    │
├─────────────────────────────────────────────────────────────────────┤
│ ┌─────────────────────────────────────────────────────────────────┐ │
│ │ 1   {                                                            │ │
│ │ 2     "inputs": {                                                │ │
│ │ 3       "country": "Tuvalu",                                     │ │
│ │ 4       "correct_answer": "The capital of Tuvalu is Funafuti."   │ │
│ │ 5     },                                                         │ │
│ │ 6     "outputs": {                                               │ │
│ │ 7       "countryName": "Tuvalu",                                 │ │
│ │ 8       "capital": "Funafuti"                                    │ │
│ │ 9     }                                                          │ │
│ │ 10  }                                                            │ │
│ └─────────────────────────────────────────────────────────────────┘ │
└─────────────────────────────────────────────────────────────────────┘
```

JSON view:
- Full document editor (existing — Monaco/Lexical with JSON mode)
- Type info implicit in tree structure
- No per-property chips needed
- Save validates JSON before persisting; invalid JSON blocks save with inline error

## On screenshot 7: faithful storage display, not a bug

```
JSON view (faithful to storage):
{
  "country": "Kiribati",
  "correct_answer": "The capital of Kiribati is Tarawa.",
  "outputs": "{\"countryName\":\"Kiribati\",\"capital\":\"South Tarawa\"}"
}
```

`outputs` is stored as a JSON-encoded string (likely because the testcase came from a trace import or a JSON upload with nested stringified values). The JSON view honors the user's storage exactly. The Fields view detects the inner JSON via `detectDataType` and presents an object editor — the user can drill into `countryName` / `capital` as if it were native JSON, even though storage stays a string.

The RFC's principle (*native JSON stays native until template rendering*) does NOT mean we should auto-convert these cells. It means: at runtime / playground transport, send what the user stored — string stays string, object stays object. See `06-edge-cases.md` § "User-uploaded stringified JSON" for what conversion (if any) we offer.

## State sync between Fields and JSON view

- Toggling between views must preserve unsaved edits
- Each view re-renders from the same in-memory document
- Invalid JSON in JSON view: cannot toggle to Fields view until fixed (or warn-and-discard)
- Invalid input in Fields view: per-field error, can still toggle to JSON view

## Open questions for team

1. **Convert action placement:** inline next to property header (recommended), or in a per-property menu? See `04-conversion-toggle.md`.
2. **Drill-in for nested objects:** drawer-in-drawer, expand-in-place, or modal? Affects `02-testset-table.md` cell click behavior.
3. **JSON view validation block:** hard block on toggle, or soft warn-and-discard? Recommend hard block.
