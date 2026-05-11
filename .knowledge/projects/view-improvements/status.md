# Status: View Improvements

**Last Updated:** Feb 13, 2026

## Current Phase

**Phase:** Research & Planning  
**Status:** Complete

## Progress

### Completed

- [x] Extract discussion from sprint planning transcript
- [x] Research codebase: identify all viewing/rendering components
- [x] Map component landscape across surfaces
- [x] Identify key gaps (observability table, span view, playground output)
- [x] Document existing solutions (`SmartCellContent`, `DrillInView`)
- [x] Create competitive analysis (Langfuse, competitor B)
- [x] Create execution plan with phases
- [x] Create design documentation workspace

### In Progress

- [ ] Review plan with team
- [ ] Decide on Phase 5 (JSON table view) priority
- [ ] Get design input for playground output toggle UX

### Blocked

None currently.

### Decisions Made

| Decision | Rationale | Date |
|----------|-----------|------|
| Start with observability table | Highest impact, lowest effort; already have `SmartCellContent` | Feb 13 |
| Use `SmartCellContent` not custom component | Already exists, tested in eval/testset tables | Feb 13 |
| Playground toggle: simple tabs initially | Lower complexity than `SimpleSharedEditor`; can upgrade later | Feb 13 |
| Defer global view preferences | Nice-to-have; can add after core improvements | Feb 13 |

### Open Questions

1. **JSON table view timing** — Is Braintrust-style table view a must-have this sprint?
   - *Pending team discussion*

2. **SDK parameters issue** — Backend/SDK fix or frontend workaround?
   - *Out of scope for this project*

3. **Design review** — Need Figma mockups for:
   - Playground output toggle placement
   - Rendered view styling in trace drawer

---

## Notes

### Feb 13, 2026 — Initial Research

**Key finding:** The observability table is using `TruncatedTooltipTag` which serializes everything to strings, while the eval table and testset table use `SmartCellContent` with proper chat detection. This is a simple swap that immediately brings observability up to parity.

**Competitive insight:** Langfuse has a sophisticated JSON table view (`PrettyJsonView`) that we should consider building. Key features:
- Two-column layout (Path | Value)
- Type-colored values
- Smart auto-expansion (~20 visible rows)
- Lazy child generation
- Copy on hover

**Component duplication:** Found several instances of duplicate implementations:
- Chat message detection in 3+ places
- Copy to clipboard in 2 places
- Chat message editor in package and OSS

Consolidation should happen after core improvements, not before.

---

## Upcoming Milestones

| Milestone | Target Date | Status |
|-----------|-------------|--------|
| PRD/Scope approved | TBD | Pending review |
| Phase 1 complete (observability table) | TBD | Not started |
| Phase 2 complete (span view) | TBD | Not started |
| Phase 3 complete (playground toggle) | TBD | Not started |

---

## Blockers Log

| Date | Blocker | Resolution | Resolved Date |
|------|---------|------------|---------------|
| — | — | — | — |

---

## Change Log

| Date | Change | Author |
|------|--------|--------|
| Feb 13, 2026 | Created initial research and planning documents | — |
