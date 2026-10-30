# One concept, one name, every layer

A concept has one glossary term. That term takes a name in every layer it reaches. The
per-layer name table records those names side by side, so a mismatch is visible before the
code exists.

## The table

One row per glossary term. Leave a cell empty when the concept does not reach that layer.

| Term | Table | Column or index | ORM model (DBE) | DTO class and field | Route segment or parameter | JSON or config field | UI label | Differs because |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |

- **Table** and **Column or index**: the Postgres names, including partial unique indexes and
  check constraints that carry the concept.
- **ORM model**: the SQLAlchemy class (`<Name>DBE`) and its DBA mixin.
- **DTO class and field**: the Pydantic class in `core/<domain>/dtos.py` and the field name.
  Add the SDK model when the SDK reads it.
- **Route segment or parameter**: the path prefix, the path parameter, the operation id
  verb.
- **JSON or config field**: wire fields and agent configuration keys, including enum values.
- **UI label**: the words a user sees. A label may be a plain phrase, but it names the same
  concept.
- **Differs because**: required when any cell does not follow the term. Valid reasons:
  a shipped name that cannot change yet (name the migration plan or the exception record),
  an external standard name kept at a boundary, or a project convention row. "Legacy" alone
  is not a reason.

## Rules

- Same concept, same name, in every layer, unless the last column gives a reason.
- Snake_case in code layers follows the term (`service`, `is_default`). The UI label may be
  a phrase ("Each person's own account").
- A word that names one concept in one cell must not name another concept in another cell.
  If one word appears in two rows with two meanings, one of them is wrong.
- Index and constraint names follow the table's naming pattern
  (`project-conventions.md`, Tables, constraints, enums), and indexes that do the same job
  on sibling tables have the same shape.
- The row for an enum lists every value, and each value has a label.
- When a row needs a "Differs because" entry on new surface (not shipped), that is a design
  finding: rename, or say why the difference is needed.
- A recorded exception covers the shipped name only. New indexes, new fields, new
  references and new code built next to it use the term, and the spec names the one place
  where the old name is mapped to the term. A sentence in the spec is not a mapping.

## How to fill it

1. List the glossary terms the spec adds or changes.
2. For each term, read the spec and today's code, layer by layer, and copy the exact name.
3. Mark each cell that differs. Decide: rename now, map in one place (for example a DTO
   field that reads a shipped column), or record a shipped exception.
4. Put the table in the spec's "Naming" section (`spec-checklist.md`).
