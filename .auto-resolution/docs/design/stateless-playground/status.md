# Status: Stateless Playground

## Current Phase: Planning Complete

**Last Updated**: 2026-02-11

---

## Progress Summary

| Phase | Status | Notes |
|-------|--------|-------|
| Research | Done | Architecture analyzed, adapter approach identified |
| Planning | Done | Plan documented with bindings seam strategy |
| Phase 0: Bindings Seam | Not Started | |
| Phase 1: Project Route | Not Started | |
| Phase 2: Wire UI | Not Started | |
| Phase 3: Execution | Not Started | |
| Phase 4: Polish | Not Started | |

---

## Key Findings

### Good News

1. Completion `/test` endpoint already supports inline config. No backend changes needed.
2. Loadable bridge supports local mode. Testcase management is ready to go.
3. Service schema atoms exist (`completionServiceSchemaAtom`). No need to hardcode schemas.
4. Most UI components are presentation only. They can be reused with different bindings.
5. Existing DI patterns in the repo (context providers, adapters) provide a template.

### Challenges

1. Deep coupling to app context in some atoms and components.
2. Web worker always appends `application_id`. Need to skip it for stateless mode.
3. URL sync (`playgroundSyncAtom`) must not mount for stateless mode.

---

## Decisions Made

| Decision | Choice | Rationale |
|----------|--------|-----------|
| Schema source | Fetch from service | Atoms already exist; avoids hardcoding and drift |
| App ID for tracing | Omit entirely | Backend handles missing app id; avoids UUID validation failures |
| Sidebar location | Project section (after Prompts) | Matches user request for project level page |

## Decisions Pending

| Decision | Options | Blocker For |
|----------|---------|-------------|
| Initial mode | a) Completion only, b) Both modes | Phase 1 |
| URL state | a) No persistence, b) Hash-based | Phase 4 |

Recommendation: Start with completion only, no URL persistence. Add chat and URL hash in later iterations.

---

## Blockers

None currently.

---

## Recent Updates

### 2026-02-11

- Completed architecture research.
- Identified adapter/bindings seam approach.
- Updated plan to include Phase 0 (bindings seam).
- Confirmed service schema atoms can be reused.
- Confirmed worker `application_id` handling needs a small change.
- Created rfc.md and qa.md.

---

## Next Steps

1. Review plan and rfc with stakeholders.
2. Finalize decision on initial mode (completion only recommended).
3. Begin Phase 0: introduce bindings provider without changing app playground behavior.
