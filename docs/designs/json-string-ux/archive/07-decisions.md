# Decisions Needed Before Implementation

Six binary calls block implementation. Resolve them before WP-F1 / WP-F2 begin. Plus four secondary calls that can ship later.

## Primary decisions (block implementation)

### 1. Conversion model: do we ever change storage format, or only the display experience?

**Context:** the existing system already preserves the user's storage format and provides a JSON-like display/edit experience on top via `detectDataType` + `textModeToStorageValue`. Stringified-JSON cells render and edit identically to native-JSON cells in the drawer Fields view.

The RFC's *"native JSON stays native"* refers to **runtime transport** — playground requests should not stringify object values before sending. It does not require us to migrate stored data.

| Option | Behavior |
|---|---|
| A. Preserve always | System never converts storage format. User edits via the existing "feels-like-JSON" UX. WP-F2 sends native JSON in transport without changing storage. |
| B. Preserve + opt-in conversion | Same as A, plus a per-property convert action that lets the user explicitly change storage format (string ↔ native). |
| C. Auto-migrate to native on edit | Read stringified-JSON, edit produces native-JSON storage. Silent format change. |

**Recommendation: A for v1, defer B to v2.** Existing handling is already good. Conversion is a niche need; ship it only if users ask. C is rejected — it silently mutates user data.

**Affects:** the entire scope of WP-F1's UI work. If we go with A, the work shrinks dramatically — chips + table-cell renderer + WP-F2 transport. No conversion UI.

**Asks the team:** is there a real user workflow where the storage format itself needs to change?

### 2. Inline JSON edit in table cells, or drawer-only?

| Option | UX |
|---|---|
| A. Inline | Cells with object/array values become inline JSON editors on click |
| **B. Drawer-only** | Click → drawer opens, focus on that field. Strings/numbers/booleans stay inline. |

**Recommendation: B.** Cells too narrow for nested structure. Drawer is the editing surface for non-trivial types. See `02-testset-table.md`.

**Asks the team:** are there workflows where users edit objects in bulk in the table that drawer-only would slow down?

### 3. Failure UX for invalid string → JSON conversion

| Option | Behavior |
|---|---|
| A. Toast | Notification, value unchanged. Easy to miss. |
| **B. Inline error below property** | Persistent error message until resolved. Visible. |
| C. Modal blocking | Force user to fix or cancel. Heavy. |

**Recommendation: B.** Persistent inline error. Doesn't block other work, but stays until handled.

### 4. Default stringification format

When user converts object → string, do we emit:

| Option | Output |
|---|---|
| A. Compact | `{"name":"Ada"}` |
| **B. Pretty** | `{\n  "name": "Ada"\n}` |

**Recommendation: B.** Pretty is more readable in text editors. Compact only when bandwidth matters (request payloads), and that's a separate runtime concern.

**Asks the team:** any preference based on existing testset payloads?

### 5. Type indicator visibility default

| Option | When to show chip |
|---|---|
| A. Always | Every value, every row, every surface. Maximum signal, maximum clutter. |
| B. Hover-only | Reveals on row hover. Cleaner default. |
| **C. Ambiguous-only** | Show when rendering doesn't disambiguate. Strings get no chip in compact rows; objects/arrays/null/messages always show. |

**Recommendation: C.** See `01-display-and-indicators.md`.

**Asks the team:** Mahmoud's RFC requirement *"show the field type wherever testcase or trace values are edited or inspected"* could be read as A. Confirm: does C satisfy the RFC, or does Mahmoud want strict always-on?

### 6. Stringified-as-uploaded data: do we offer storage-format conversion?

**Reframe:** there is no legacy data to migrate. Users upload stringified JSON intentionally (from trace imports, JSON files, etc.) and the existing system handles it transparently — `detectDataType` recognizes it, the Fields view edits it as JSON, edits round-trip to stringified storage. The display/edit experience is already JSON-like.

| Option | Behavior |
| --- | --- |
| **A. Leave alone (default)** | System preserves the user's storage. Existing transparent handling is good enough. |
| B. Optional opt-in conversion (v2) | Per-cell or per-column "Convert to native JSON" action. Storage format changes. |

**Recommendation: A for v1.** The existing system already does the right thing without conversion. Defer B to v2 unless users explicitly request it.

This decision collapses if Decision 1 lands as A (preserve always). The two decisions are tightly coupled.

## Secondary decisions (lower priority)

### 7. Round-trip preservation

Canonical form (simple) vs `originalText` shadow field (complex)?

**Recommendation: canonical, document in tooltip.** `04-conversion-toggle.md`.

### 8. Column header type chip

Dominant-type / "mixed" warning / off?

**Recommendation: dominant + mixed warning.** `02-testset-table.md`.

### 9. Empty-string-on-convert

Become `{}` / `[]`, or refuse?

**Recommendation: become empty container, since intent is clear.** `06-edge-cases.md`.

### 10. Variables panel insert syntax

`{{name}}` flat by default, path on right-click?

**Recommendation: yes.** `05-playground-variables.md`.

## Sequencing

| Decision | Blocks |
|---|---|
| 1. Cell vs column type metadata | Backend schema, API contract — earliest in WP-F1 |
| 6. Migration story | Backend + UI cell rendering — early in WP-F1 |
| 5. Indicator visibility | UI design language — affects all surfaces |
| 4. Stringification default | Conversion UX behavior |
| 3. Failure UX | Conversion UX behavior |
| 2. Inline edit | Table cell click handlers, can ship later |

## Recommended team-conversation flow

1. Walk Mahmoud + JP through `00-overview.md` first (5 min)
2. Show wireframes from `01-display-and-indicators.md` and `02-testset-table.md` (10 min — most concrete, easiest to react to)
3. Resolve decisions 1, 5, 6 first (these block schema work)
4. Resolve decisions 2, 3, 4 second (these affect interaction details)
5. Defer secondary decisions 7-10 to async resolution if time runs out

Total expected meeting time: ~45 min if everyone has read the docs first, ~75 min cold.

## What to deliver after the call

1. Mark each decision as resolved in this file (turn `**Recommendation: X**` into `**Decision: X (set on YYYY-MM-DD)**`)
2. Update the RFC's WP-F1 section with the call outcomes
3. Open Linear tickets for the implementation slices
4. Brief write-up posted in the project channel summarizing what was decided
