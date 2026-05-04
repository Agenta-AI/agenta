# Gap 04 — Union-projected fields aren't visually distinct from authored fields

**Scope:** Frontend only. **Backend is correct.** State stays clean unless the user explicitly edits via the JSON view.

**Anchor fixtures:** `02-nested-native.json`, `08-dot-key-collision.json`

## Backend is fine (verified)

Per `backend-response data/02-response.json` and `08-response.json`:

- The BE returns each testcase's `data` exactly as uploaded. No injected keys.
- For fixture 08, Kiribati's `data` is just `{country, geo: {...}, correct_answer, outputs, testcase_dedup_id}` — none of the `"geo.region": ""`, `"user.profile.*": ""` we see rendered in the FE.

## What the FE does (and why it's a feature)

The column union is **a convenience feature**, not a bug. Confirmed by reading the code:

1. [`currentColumnsAtom` in `molecule.ts:210-244`](../../../web/packages/agenta-entities/src/testcase/state/molecule.ts) walks every testcase's `data` and unions the keys into one column set. Necessary for the table grid (every cell needs a position).
2. **Intent:** if testcase A has columns `X, Z` and testcase B has only `X`, the user can author `Z` in testcase B without manually adding the column. Removes friction.
3. **Opening a testcase creates no draft.** The state has no draft change. Only when the user *edits* something does a draft get written.

Where the empties come from at render time — [`EntityDualViewEditor.tsx:144-155`](../../../web/oss/src/components/DrillInView/EntityDualViewEditor.tsx):

```typescript
columns.forEach((col) => {
    values[col.key] = entityData[col.key] ?? ""    // empty fallback for union columns
})
return JSON.stringify(values, null, 2)
```

The JSON view materializes `union × per-cell-value × empty-fallback` for display. The underlying `entityData` (testcase's actual `data`) is unchanged. The empties live only in the rendered string.

Same pattern in the Fields view: union columns render as empty inputs even when the testcase didn't author that key.

**So storage stays clean on read.** The screenshots that look like pollution are render-time projections layered on top of clean data.

## What's actually risky

The render-time projection alone is fine — it's the convenience feature working. Three downstream risks emerge from the projection's identity ambiguity:

### Risk 1 — User confusion (unauthored vs. authored-empty)

A cell rendering `""` could mean two different things:

1. The user authored an empty string in this row (intentional)
2. The column exists in the testset (because *another* row authored it) but this row didn't

Both render identically. The user can't distinguish them. This matters when reviewing testcase coverage, debugging "why is this template returning empty?", or auditing data quality.

### Risk 2 — JSON-view edits replay the union shape into the draft

[`handleJsonChange` in `EntityDualViewEditor.tsx:163-173`](../../../web/oss/src/components/DrillInView/EntityDualViewEditor.tsx) parses what the user types in the JSON editor and dispatches `{type: "update", changes: parsed}`. The parsed object includes ALL the empty literals materialized by the projection — those land in the draft, persist on save, and pollute BE storage.

**Per-field edits in the Fields view are safe** (single-key dispatches). The risk is specific to the JSON-view edit path: any keystroke in the JSON editor replays the full union shape into the draft.

### Risk 3 — Template-runtime shadowing (downstream of FE)

Under the RFC's literal-key-first rule for `curly` templates, `{{geo.region}}` resolves to a literal `"geo.region"` key before falling back to nested traversal. **If** the template resolver receives the union projection (with injected empties) instead of the testcase's actual `data`, the empty literal silently shadows the real nested value: `{{geo.region}}` returns `""` instead of `"Micronesia"`.

This depends on what shape the playground / evaluation runner passes to the resolver. The clean BE response suggests the runtime path is fine, but worth verifying that the template context comes from `entityData`, not from the rendered JSON-view string.

### Note on column expansion

The testset table's column-grouping / expansion is a **separate mechanism** and isn't involved here. Expansion creates parent-child column relationships in the table view; the empty-projection problem is specifically about literal top-level keys + the `?? ""` fallback in the drill-in's JSON serialization (`EntityDualViewEditor.tsx:144–155`).

## Three approaches to the fix

All three **keep the convenience feature.** Differences are in how the projection is visually marked and how the JSON-edit path is bounded.

### Variant A — Visually distinct projected fields + scoped save (recommended)

Best-of-both: the union stays available, the user can tell what's authored vs. projected, the JSON-edit path can't accidentally persist the projection.

- **Drill-in Fields view:** render union-projected fields with a dashed border + dimmed background + `[not in this row]` chip. Authored fields look as today.
- **Drill-in JSON view:** serialize from the testcase's actual `data` object by default. A toggle ("show all columns" / "as authored") reveals the projection. Default = as authored.
- **JSON edit handler:** when the user edits the JSON view, diff the parsed object against the testcase's actual `data` (not the projection). Only persist keys the user added or changed. Drop empty-string fallbacks for keys that weren't in the original `data`.
- **On user-initiated edit of a projected field** (typing into the dashed-border input), the key transitions to authored — added to the draft, dashed border drops.
- **Table cells:** unchanged (missing keys already render as `—`).

**Pros:** keeps the convenience feature. User can distinguish authored vs. projected. JSON-edit path is bounded. Aligns with the existing render model.
**Cons:** new UI vocabulary (dashed-border + chip). JSON view toggle adds one control.

### Variant B — Render only authored keys

Simpler but loses the convenience feature.

- Drill-in Fields view: render an input for a column only if that key exists in the testcase's `data`. Missing keys render as a faded "+ add `geo.region`" affordance.
- Drill-in JSON view: serialize from `data` directly.
- Save flow: write only authored keys.

**Pros:** smallest diff. Storage and display are 1:1 with BE.
**Cons:** **loses the original convenience intent.** Users who want to author a missing column now have to click "+ add" each time. The union-as-default feature was useful.

### Variant C — Status quo, fix only Risk 2

Smallest possible scope: leave rendering as-is, only fix the JSON-edit path.

- `handleJsonChange` diffs parsed input against the testcase's actual `data`. Empty literals from union projections that weren't already on `data` are filtered before dispatching.
- Display behavior (Fields view + JSON view) unchanged.

**Pros:** minimal change. Eliminates the storage-pollution risk.
**Cons:** doesn't address Risk 1 (user confusion). Doesn't help template-runtime if the resolver gets the projected shape (Risk 3 stays open).

## Recommendation

**Variant A.** Preserves the convenience feature (which is the point of the union model) while adding a visible distinction between authored and projected fields, and bounding the JSON-edit path so it can't accidentally persist the projection.

The dashed-border + `[not in this row]` chip is also useful for **template-authoring** — when a user runs the playground on a single testcase, they can immediately see which referenced variables aren't authored on that row.

## Save-flow verification (must do before fixing)

Before any UI change lands, check the save path:

1. Open a testcase in the drawer.
2. Edit one field.
3. Hit save.
4. Inspect the `PUT/PATCH` request payload to the BE.
5. If the payload contains keys the user didn't author (e.g. `"geo.region": ""` for Kiribati), the bug has already polluted storage on at least one prior save — flag this and remediate by either:
   - server-side: drop empty-string literal-dotted keys on PATCH (BE-side cleanup, opt-in)
   - client-side: filter the save payload to keys with non-default values before sending

If the payload is clean (no injected keys), the bug is render-only and the fix is purely in the drill-in's JSON view layer (`EntityDualViewEditor`).

## Competitive validation (added 2026-05-04)

This gap is **the one neither competitor exposes**. See [`../competitive-analysis.md`](../competitive-analysis.md) §8 + §13.

- **Braintrust** — sidesteps the union projection problem by editing per field with per-field PATCH saves (their schema-aware form, gap-07's reference point). They never project a union shape into a JSON blob, so the replay-on-save risk doesn't exist. **This is structural avoidance, not a UX solution** — they don't have the table-column-union model in the same way we do.
- **Langfuse** — every save is a JSON-blob PATCH. They almost certainly have this exact bug on the edit side; we just can't see it from the outside. No marker, no warning, no projection toggle.
- **Stringified-JSON fault line** — Braintrust's variable validator (gap-08 territory) **false-warns** on `04 Stringfied Nested` because their schema treats `metadata` as a string, not a parsed object. Same fault line as the union projection: once a column is a stringified JSON, every downstream tool that depends on the schema silently degrades. Our gap-02 "parse stringified JSON on detect" affordance feeds this gap's fix — without parsing, even Braintrust gets it wrong.

**Net:** our proposal stays distinct. Neither tool has a render-only marker for union-projected fields; gap-07's per-field PATCH save subsumes the *cause* if we adopt it, but the marker is still useful for clarity. Both fixes (render-only + per-field save) compose; pick based on Round 0 outcome.

## Cross-references

- `gap-01` — type chip vocabulary ("not in this row" stacks on top)
- `gap-03` — drill-in root view bailout shares the chip system at the editing surface
- `gap-05` — dot-key-vs-nested disambiguation depends on the shape-preservation principle here
