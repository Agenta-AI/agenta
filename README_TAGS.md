# Tags Feature Implementation - Complete Documentation

## 📋 Overview

This folder contains complete planning and specification documents for implementing the **tags** feature in `/claude/api` based on the design in `/sandbox/architecture/tags.initial.specs.md`.

## 📚 Documentation Files

### 1. **TAGS_WORK_SUMMARY.txt** ⭐ START HERE
   - **What**: Executive summary of the entire implementation
   - **Best for**: Quick overview, seeing the big picture, understanding scope
   - **Contains**: Entity mappings, work breakdown, schema design, trigger logic, effort estimates
   - **Read time**: 5 minutes

### 2. **TAGS_STARTER_GUIDE.md** ⭐ FOR IMPLEMENTATION
   - **What**: Step-by-step guide to implement workflows first, then expand
   - **Best for**: Actually building the feature, follows best practice of "start small, validate, scale"
   - **Contains**: 5 implementation steps for workflows, testing scenarios, expansion strategy
   - **Read time**: 10 minutes

### 3. **TAGS_SQL_EXAMPLES.md** 🔧 FOR DEVELOPERS
   - **What**: Actual SQL and Alembic code examples ready to use
   - **Best for**: Copy-paste reference, creating migration files
   - **Contains**: Complete SQL examples, test scenarios, full migration template, all 9 entity kinds
   - **Read time**: 8 minutes (or reference as needed)

### 4. **TAGS_IMPLEMENTATION_PLAN.md** 📖 FOR COMPLETENESS
   - **What**: Detailed technical plan covering all 7 tasks + phases
   - **Best for**: Understanding all aspects, checking nothing is missed
   - **Contains**: Full phase breakdown, entity kinds, file structure, EE considerations
   - **Read time**: 15 minutes

---

## 🎯 Quick Start (5-minute summary)

### Goal
Implement database-level tag synchronization for entity tagging. Entities already have `tags` column (JSONB with dot-notation keys). Build a shared `tags` registry for autocomplete.

### Key Components

| Component | Purpose | Where |
|-----------|---------|-------|
| **tags table** | Registry of tag keys per project/kind | PostgreSQL |
| **Trigger function** | Auto-sync entity tags to registry | PostgreSQL function |
| **15 triggers** | Attach function to entity tables | One per table |
| **Backfill SQL** | Populate registry from existing data | Migration script |
| **API endpoint** | Query tag keys for autocomplete | GET /projects/{id}/tags |
| **Utilities** | Flatten/unflatten JSON | Python helpers |

### Entity Kinds (9 total)
- `testset`, `workflow`, `query` (3 tables each = 9 total)
- `evaluation_run`, `evaluation_scenario`, `evaluation_result`, `evaluation_metrics`, `evaluation_queue` (5 single tables)
- `blob` (1 table)

### Implementation Strategy
1. **Phase 1**: Database (migrations)
   - Create tags table
   - Create trigger function
   - Attach triggers (15 total)
   - Backfill from existing data

2. **Phase 2**: API
   - Create tags module
   - Add GET /projects/{id}/tags endpoint

3. **Phase 3**: Utilities
   - Flatten/unflatten helpers

4. **Optional**: Integration
   - Update DTOs if needed

### Recommended Order
**Start with workflows only** (3 tables):
1. Create all 4 migration files (table, function, triggers, backfill)
2. Test workflows in isolation
3. Expand to testsets (3 more tables)
4. Expand to queries (3 more tables)
5. Expand to evaluations & blobs (6 more tables)
6. Build API endpoints once all DB tables done
7. Add utilities anytime

---

## 🗂️ File Organization

```
/claude/
├── README_TAGS.md                      ← You are here
├── TAGS_WORK_SUMMARY.txt              ← Big picture overview
├── TAGS_STARTER_GUIDE.md              ← How to get started
├── TAGS_SQL_EXAMPLES.md               ← Ready-to-use code
├── TAGS_IMPLEMENTATION_PLAN.md        ← Full technical plan
│
└── api/oss/
    ├── databases/postgres/migrations/core/versions/
    │   ├── <timestamp>_add_tags_table.py
    │   ├── <timestamp>_add_tags_trigger_and_workflow_triggers.py
    │   ├── <timestamp>_backfill_tags_from_workflows.py
    │   └── (future: additional entity migrations)
    │
    └── src/
        ├── apis/fastapi/tags/              ← To be created
        │   ├── __init__.py
        │   ├── models.py
        │   └── router.py
        │
        └── core/tags/                      ← To be created
            ├── __init__.py
            └── utils.py
```

---

## 🔑 Key Design Decisions (from specs)

1. **Flat dot-notation**: Tags stored as flat JSON with dot-notation keys
   - ✅ `{"env": "prod", "owner.name": "Juan"}`
   - ❌ Not `{"owner": {"name": "Juan"}}`

2. **Registry pattern**: Separate `tags` table with (project_id, kind, key)
   - Purpose: Enable efficient autocomplete queries
   - Not for per-entity values (those stay in entity.tags)

3. **Trigger-based sync**: PostgreSQL triggers auto-populate the registry
   - On INSERT/UPDATE of entity: extract tag keys and insert into registry
   - Uses `ON CONFLICT DO NOTHING` to preserve manual edits

4. **Manual edit safety**: Users can edit/delete keys in tags table
   - Deleted keys are re-created if entity still uses them
   - Edits are preserved (trigger never overwrites)

5. **No validation**: Assume tags already in dot-notation
   - Skip input validation for now
   - Flatten/unflatten helpers available but not required

---

## 🚀 Implementation Checklist

- [ ] Review TAGS_WORK_SUMMARY.txt (understand scope)
- [ ] Review TAGS_STARTER_GUIDE.md (understand approach)
- [ ] Create migration files for workflows (TAGS_SQL_EXAMPLES.md has templates)
  - [ ] Create tags table
  - [ ] Create trigger function
  - [ ] Attach 3 workflow triggers
  - [ ] Backfill from workflows
- [ ] Test workflows in isolation
- [ ] Create tags API module
- [ ] Create tags utilities module
- [ ] Expand to remaining entities (testsets, queries, evaluations, blobs)
- [ ] Add integration tests

---

## 🔍 Where to Find Each Thing

### To understand the overall design:
→ Read **TAGS_WORK_SUMMARY.txt** (sections: Overview, Entity Kinds, Work Breakdown)

### To understand how to implement:
→ Read **TAGS_STARTER_GUIDE.md** (sections: Implementation Steps, Testing)

### To get SQL code ready to use:
→ Read **TAGS_SQL_EXAMPLES.md** (sections: 1-3 for database, 6 for migration template)

### To understand technical details:
→ Read **TAGS_IMPLEMENTATION_PLAN.md** (sections: Phase 1-4, Database Schema)

### To understand the current code structure:
→ See **TAGS_WORK_SUMMARY.txt** (section: File Locations Summary)

---

## 📞 Quick Reference

### Entity kinds and their tables:
```
testset: testset_artifacts, testset_variants, testset_revisions
workflow: workflow_artifacts, workflow_variants, workflow_revisions
query: query_artifacts, query_variants, query_revisions
evaluation_run: evaluation_runs
evaluation_scenario: evaluation_scenarios
evaluation_result: evaluation_results
evaluation_metrics: evaluation_metrics
evaluation_queue: evaluation_queues
blob: blobs
```

### Trigger naming convention:
```
trg_{table}_{suffix}_sync_tags
Example: trg_workflow_artifacts_sync_tags
```

### Entity kind for registry:
Use singular form in lowercase:
```
testset, workflow, query
evaluation_run, evaluation_scenario, evaluation_result, evaluation_metrics, evaluation_queue
blob
```

### Tags table query:
```sql
SELECT key FROM tags
WHERE project_id = $1 AND kind = $2
ORDER BY key;
```

---

## 🤔 Frequently Asked Questions

**Q: Why start with workflows?**
A: Workflows have 3 tables which is a good sample size. Same pattern applies to testsets, queries, then evaluations & blobs.

**Q: Do entities already have tags column?**
A: Yes! All tables inherit `TagsDBA` mixin which provides `tags JSONB NOT NULL`. No schema changes needed to entities.

**Q: Will triggers affect existing code?**
A: No. Triggers only read and populate the new `tags` table. Entity tables and columns unchanged.

**Q: What if entity tags are not in dot-notation?**
A: Specs assume they are. Flatten/unflatten utilities are available but not required for this phase.

**Q: Can users edit the tags table?**
A: Yes! They can insert, edit, or delete keys. If deleted, keys are re-added when entity updates (trigger will recreate them).

**Q: What about EE?**
A: EE inherits from OSS. Same migrations apply, possibly separate if EE has own migration chain. Check `/claude/api/ee/databases/`.

---

## 📝 Next Steps

1. **Review**: Read TAGS_WORK_SUMMARY.txt (5 min)
2. **Plan**: Read TAGS_STARTER_GUIDE.md (10 min)
3. **Code**: Use TAGS_SQL_EXAMPLES.md as template
4. **Build**: Create migration files
5. **Test**: Verify with workflows first
6. **Scale**: Expand to remaining entities

---

## 📄 Related Files

- **Design spec**: `/sandbox/architecture/tags.initial.specs.md`
- **OSS migrations**: `/claude/api/oss/databases/postgres/migrations/core/versions/`
- **Workflow models**: `/claude/api/oss/src/dbs/postgres/workflows/dbes.py`
- **Shared DBAs**: `/claude/api/oss/src/dbs/postgres/shared/dbas.py` (TagsDBA definition)

---

**Created**: 2025-11-27
**For**: Implementation of tags feature in /claude/api
**Status**: 📋 Planning complete, ready for implementation

