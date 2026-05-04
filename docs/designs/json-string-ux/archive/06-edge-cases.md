# Edge Cases & Failure Modes

## Invalid JSON during conversion

Covered in `04-conversion-toggle.md`. Recap:

| Trigger | Behavior |
|---|---|
| string → obj, parse fails | Inline error, value unchanged, offer "Edit string first" |
| string → arr, parse succeeds but not array | Suggest correct type with one-click switch |
| obj → str | Always succeeds (canonical stringify) |
| empty string → obj | **Decision needed:** become `{}` or refuse? `07-decisions.md` § 9 |

## Round-trip preservation

| Pattern | What happens |
|---|---|
| `"{...}"` → obj → str | Returns canonical compact/pretty form, original whitespace lost |
| obj → str → obj | Identical (canonical idempotent) |
| user types raw `"text"` and converts → obj | `JSON.parse` strips quotes; becomes `text` value |

User-visible note: convert action shows tooltip *"Formatting will be normalized."*

## Empty / null

| Original | Display | Edit |
|---|---|---|
| `""` (empty string) | Renders as `""` literal | Inline text input, empty |
| `null` | Renders as dimmed `null` chip | Read-only badge, `[clear]` action removes the property |
| Missing key (key not present at all) | Renders as `—` | Add via "+ property" action in object editor |

**The trap:** is `""` the same as missing? RFC implies: no, they're different. `""` is an explicit empty string the user authored. Missing is structural absence. **Preserve the distinction.**

## User-uploaded stringified JSON (screenshot 7)

**Reframe:** this isn't legacy data needing migration. It's user-uploaded data — typically from trace imports or JSON files where nested values were already stringified. The team's existing design intentionally preserves the user's storage format. There's no broken migration to recover from.

**What already works** (no new code needed):

- `detectDataType` recognizes the inner JSON and the drawer Fields view presents an object editor
- Users can drill into nested keys and edit them as if it were native JSON
- Edits round-trip back to stringified storage via `textModeToStorageValue`

**What the JSON view shows:** raw storage with escaped quotes. Faithful, by design.

**Optional v2 nicety: opt-in conversion to native JSON storage.**

Some users might prefer the storage to be native JSON going forward (cleaner JSON view, simpler runtime semantics in some contexts). The recommendation is *not* to surface this aggressively — most users are fine with the existing transparent handling. If we offer it at all:

```
Column header (user can opt in):
┌─────────────────────────────────────────────────┐
│ outputs  [str]                  [convert column]│
└─────────────────────────────────────────────────┘

Modal on click [convert column]:
┌─────────────────────────────────────────────────┐
│ Convert "outputs" to native JSON storage?       │
│                                                 │
│ 12 cells contain stringified JSON that will be  │
│ converted to native objects.                    │
│ 3 cells are plain strings and will be skipped.  │
│                                                 │
│ This changes how data is stored, not how it's   │
│ displayed. Cells already render as objects in   │
│ the Fields view.                                │
│                                                 │
│              [Cancel] [Convert 12 cells]        │
└─────────────────────────────────────────────────┘
```

**Recommendation:** defer entirely from v1. The existing transparent handling is good enough. Revisit if users explicitly ask for storage-format conversion.

## Boolean / Number stored as strings

E.g. `"true"`, `"42"`. Same pattern as legacy JSON. Lower priority. Same `[looks-like-N]` chip approach if we extend it.

## Messages type

Special case. RFC explicitly carves it out. `messages` arrives as native list at runtime; legacy rows that store JSON-encoded strings are parsed at the evaluation service boundary. UI treats `messages` as its own type with a dedicated renderer (existing `ChatMessageEditor` component).

No conversion to/from string offered. If the user wants to edit raw, the JSON view of the drawer shows the underlying list.

## Ambiguous: object that's also valid JSON-encoded text

Example: a testcase has `"profile"` column with value `"{\"name\": \"Ada\"}"`. Is the user storing JSON-as-text on purpose, or is this a legacy-stringified cell that should be migrated?

**RFC contract:** strings stay strings. Type metadata determines this. If the cell is marked `string`, treat as string. Migration is opt-in (see § Legacy above).

## Failure visibility

Conversion errors should:
- Appear inline in the property header, not in a toast
- Be dismissible
- Persist until the user resolves them (no auto-clear after 5s)

```
⌄ profile  [str]              [→ obj] [→ arr]
  ┌────────────────────────────────────────┐
  │ name: Ada                              │  ← not valid JSON
  └────────────────────────────────────────┘
  ⚠ Cannot convert: not valid JSON. Try wrapping in {}.   [Dismiss]
```

## State sync edge cases

| Case | Behavior |
|---|---|
| User opens drawer, edits Fields, toggles to JSON view | JSON view re-renders from updated in-memory doc. No re-fetch. |
| User edits JSON view, JSON is invalid, tries to toggle back | Hard block: "Fix invalid JSON before switching to Fields view." |
| User edits both views before saving | Last write wins. The view they're on when they hit save is canonical. |
| Concurrent edit from another browser tab | Out of scope for this RFC. Existing optimistic-update behavior. |

## Open questions for team

1. **Migration aggressiveness:** detect and chip stringified-JSON cells, or leave silent? See `07-decisions.md` § 6.
2. **`""` vs missing semantics:** preserved (recommendation) or treated identically? Edge case, but worth noting.
3. **JSON view validation block:** hard block on toggle when invalid (recommended), or warn-and-discard?
