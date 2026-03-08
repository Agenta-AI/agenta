# Fix: Evaluation Workflow Revision Lookup

Bug fix for [#3661](https://github.com/Agenta-AI/agenta/issues/3661) - Chat app evaluations return empty runs and never start.

## Files

- **context.md** - Problem statement, root cause analysis
- **research.md** - Code analysis, adapter pattern findings  
- **plan.md** - Implementation approach
- **status.md** - Current progress
- **missed-migration-paths.md** - Comprehensive list of all code paths missed during v0.84.0 migration (for future work and QA)

## Summary

The v0.84.0 migration moved application storage from legacy tables to workflow tables but missed updating the evaluation code paths. This fix updates `_resolve_app_info()` in `legacy.py` to use `LegacyApplicationsAdapter` (the same pattern as migrated routers).
