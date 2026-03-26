# Testset Schema Design

This folder documents the recommended design for adding optional JSON Schema support to testsets.

## Recommended direction

- Attach schema to the **testset revision**, not only to the top-level testset.
- Validate on **revision-producing writes**:
  - simple create/edit
  - revision commit
  - file upload
  - delta commit after expansion
- Start with **`is_strict`** as the initial enforcement control and use the design docs to clarify what mismatch handling should mean at ingestion and commit time.
- Keep **Jinja2 / JSONPath / editor hints** in the design discussion because they influence how schema should be authored and consumed, even if they land after the core persistence work.

## Documents

- [context.md](context.md): Current architecture, goals, and constraints
- [research.md](research.md): Codebase findings and implementation implications
- [gap.md](gap.md): Review findings on the original draft
- [proposal.md](proposal.md): Recommended design and API/data model
- [plan.md](plan.md): Phased implementation plan and testing strategy

## One-line summary

The safest first implementation is: `optional revision-scoped schema + initial is_strict enforcement + write-time validation + backward-compatible API exposure`.
