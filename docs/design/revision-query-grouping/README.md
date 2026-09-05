# Per-parent grouping on revision queries

This folder plans one change to the Agenta API. The change lets a caller ask for the
newest revisions of each parent, instead of every revision of every parent.

## Reading order

| File | Question it answers |
| --- | --- |
| `context.md` | What breaks today, and why we want to change it. |
| `research.md` | What the code does now, with measurements. |
| `api-design.md` | The interface we propose, and the shapes we rejected. |
| `plan.md` | What to build, in what order. |
| `status.md` | Where the work stands, and what is still open. |

## Words used in this folder

- **artifact**: the parent entity that owns a line of history. A workflow, a testset, an
  evaluator, an environment, an application, or a query.
- **variant**: a branch of an artifact.
- **revision**: one committed version of a variant. An artifact has many revisions.
- **git DAO**: the shared database layer at `api/oss/src/dbs/postgres/git/dao.py`. Six
  entity families store their artifacts, variants, and revisions through it.
- **windowing**: the shared request object that says which slice of an ordered result to
  return. It carries a time range, a cursor, a limit, and a sort order.
- **event loop**: the single thread inside each API worker that serves every request on
  that worker. Work that does not yield blocks every other request on the same worker.
