# Conversion: String ↔ JSON Toggle

## Important framing

The system already does the right thing for **most** users **without** any conversion:

- Stringified-JSON cells (uploaded as such, or from trace imports) are auto-detected via `detectDataType` and presented in the drawer Fields view with an object editor. Users can drill in and edit nested keys as if it were native JSON.
- Edits round-trip back to the original storage format (string stays string, object stays object) via `textModeToStorageValue`.
- The JSON view shows the user's storage faithfully (escaped quotes for stringified-JSON, native nesting for native JSON).

**Conversion exists for the edge case** where a user wants to *change the storage format itself* — e.g., they have a stringified JSON in storage and want it stored as native JSON going forward (or vice versa). This should be opt-in, not automatic.

**Default behavior must remain preservation.** Auto-converting on read would silently mutate the user's data — the existing design rejects this.

## Where the toggle lives

Per-property, anchored to the property header in the drawer. **Not on table cells** — force drawer-only edit (see `02-testset-table.md`).

## Wireframe — toggle affordance (recommended: inline buttons)

```
⌄ profile  [str]              [→ obj] [→ arr]
  ┌────────────────────────────────────────┐
  │ {"name": "Ada"}                        │  ← current value as string
  └────────────────────────────────────────┘
```

After clicking `[→ obj]`:

```
⌄ profile  [obj]              [→ str]
  ┌────────────────────────────────────────┐
  │ {                                      │
  │   "name": "Ada"                        │  ← now an object editor
  │ }                                      │
  └────────────────────────────────────────┘
```

### Alternatives considered

| Affordance | Pros | Cons |
|---|---|---|
| **Inline buttons (recommended)** | Discoverable, one click | Adds chrome to property header |
| Type chip dropdown | Compact | Less obvious, requires hover |
| Right-click menu | Power-user friendly | Hidden, not discoverable |
| Convert dialog | Explicit confirmation | Too many clicks |

Recommendation: inline buttons. Optional layered shortcut: chip-click dropdown for power users.

## State transitions

### String → Object

```
Input: "{\"name\":\"Ada\"}"
↓ click [→ obj]
Parse via JSON.parse
├─ success → value becomes { name: "Ada" }
│           type chip flips to [obj]
│           editor swaps to JSON object widget
│           focus moves to first property key
└─ failure → inline error: "Not valid JSON. Expected an object."
            offer: [Edit string first] [Cancel]
            value unchanged
```

### String → Array

```
Input: "[1, 2, 3]"
↓ click [→ arr]
Parse via JSON.parse
├─ success AND result is array → becomes [1, 2, 3], chip flips to [arr]
├─ success but result NOT array → error: "Parsed value is an object, not an array. Convert to object instead?"
│                                  offer: [→ obj] [Cancel]
└─ parse failure → error: "Not valid JSON."
```

### Object → String

```
Input: { name: "Ada" }
↓ click [→ str]
Stringify via:
  • JSON.stringify(value, null, 2) [pretty]    ← recommended default
  • JSON.stringify(value)          [compact]
↓
Value becomes "{\n  \"name\": \"Ada\"\n}"
type chip flips to [str]
editor swaps to text input
```

Decision needed: pretty or compact default? See `07-decisions.md` § 4.

### Array → String

Same as object → string.

### String → Number / Boolean / Null

Lower priority. Same parse-validate-convert pattern. Ship in v2.

## Round-trip preservation

**Question:** if the user converts string → object → string, do they get back their original string, or the canonical form?

**Recommendation: canonical form.** Converting normalizes formatting. Document in tooltip:

```
[→ obj] hover tooltip:
"Convert to JSON object. The string's original formatting will be normalized."
```

**Alternative:** keep an `originalText` shadow field. Round-trip preserves whitespace. More complex; only worth it if users complain.

## Bulk conversion (Sprint 2)

For testset columns where many cells should switch type at once:
- Column header click → "Convert all cells in column to JSON"
- Confirmation modal: "Will attempt to parse N cells. M will fail and stay as strings. Continue?"
- After: cells that parsed successfully become objects; failures stay as strings with `[parse-failed]` chip

## Failure UX

| Failure | UX |
|---|---|
| Invalid JSON on string→obj | Inline error below property, value unchanged, offer "edit string first" |
| Wrong shape (got obj, wanted arr) | Suggest correct conversion type with one-click switch |
| Empty string → object | Become `{}` (empty object) — see `07-decisions.md` § 9 |
| Empty string → array | Become `[]` |
| Non-empty string with invalid JSON | Hard error, value unchanged, persistent inline message |

Wireframe of failure state:

```
⌄ profile  [str]              [→ obj] [→ arr]
  ┌────────────────────────────────────────┐
  │ name: Ada                              │  ← not valid JSON
  └────────────────────────────────────────┘
  ⚠ Cannot convert: not valid JSON. Try wrapping in {}.   [Dismiss]
```

Error placement:
- Inline below the property, not in a toast
- Dismissible
- Persists until user resolves (no auto-clear after 5s)

## Open questions for team

1. Default stringification format: compact or pretty? `07-decisions.md` § 4.
2. Empty-string behavior on conversion: become empty container, or refuse? `07-decisions.md` § 9.
3. Round-trip preservation: canonical (simple) or shadow-original-text (complex)? `07-decisions.md` § 7.
