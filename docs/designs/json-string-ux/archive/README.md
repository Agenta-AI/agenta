# Archive

Superseded docs from the earlier framing of the JSON ↔ String UX exploration. Kept for reference.

These were written before the fixture sweep (`test-fixtures/01-08`) and the BE-response review confirmed:

- The backend correctly preserves user-authored shape
- All gaps are frontend-only
- The column-union pollution visible in screenshots is FE-side, not BE
- Existing FE detection / round-trip / drill-in already covers most cases — gaps are about wiring detection results to specific surfaces

The active doc set lives one level up:

- [`../00-overview.md`](../00-overview.md) — current overview
- [`../variants/`](../variants/) — six per-gap docs + per-gap HTML mockups
- [`../test-fixtures/`](../test-fixtures/) — eight test JSON files
- [`../backend-response data/`](../backend-response%20data/) — BE response captures

## What's in here

| File | Why archived |
|---|---|
| `01-display-and-indicators.md` | Superseded by `gap-05-type-chips.md` |
| `02-testset-table.md` | Superseded by `gap-01-table-object-array-cells.md` |
| `03-testcase-drawer.md` | Superseded by `gap-04-drawer-root-fields-bailout.md` |
| `04-conversion-toggle.md` | Conversion deferred — existing system already preserves shape; explicit conversion is a v2 nicety |
| `05-playground-variables.md` | Reframed under `gap-03-dot-key-vs-nested-disambiguation.md` for the panel/autocomplete portions |
| `06-edge-cases.md` | Edge-case framing folded into individual gap docs |
| `07-decisions.md` | Reframed; new sequencing in `variants/README.md` |
| `old-comparison-board.html` | Single-file mockup superseded by per-gap HTML files in `variants/` |
