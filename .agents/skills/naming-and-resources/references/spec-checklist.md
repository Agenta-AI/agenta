# Spec naming checklist

Every spec or design that adds a concept, a table, a column, a route, a DTO field, an enum
value or a UI label fills the "Naming" section below. A design review treats a missing
section as a finding.

Run the checks on the proposed tables, routes and fields before approval, not after code
exists. Mark each result about today's code as checked in code (with the path), and each
result about the proposal as a design risk.

## Steps

1. **Conventions read.** List the `AGENTS.md` files and convention rows you used
   (`project-conventions.md`).
2. **Glossary.** Add or change entries in the format of `glossary-format.md`. Every term the
   spec uses for a project concept is in it, with an Avoid list.
3. **Analogs.** For each new table, route, DTO, enum and label, name the closest existing one
   (path) and say whether you copied its shape and names. Search the repo; do not rely on
   memory.
4. **Per-layer names.** Fill the table in `layer-name-table.md` for every new or changed
   term. Every "Differs because" cell has a reason.
5. **Resource template.** For each item kind, compare with `resource-template.md`: fields,
   siblings, owner and parent, actions, custom actions, field ownership, enums and states.
   Record each difference.
6. **Owner levels.** For every rule that depends on the owner (slug uniqueness, defaults,
   who may read, deletion), say how it applies to each owner kind the item allows.
7. **Item kinds.** For every rule that applies to one item kind, say how it applies to the
   others, or why it does not.
8. **Naming rules.** Go through `naming-rules.md`. Fix or record each hit.
9. **Caller examples.** Write three, marked as proposed: the simplest common call, a
   realistic composition, and a plausible mistake with its recovery.
10. **Doubtful surface.** List every field, route and option that no current caller needs.
    Keep them internal or drop them. Exported names become compatibility promises.
11. **Costly choices.** For each name that will be hard to change (a table, a route prefix,
    a stored JSON key), give two real options with a caller example and the migration cost.
    Keeping the current name is one option.
12. **Exceptions.** List every place the spec breaks a convention or keeps a shipped
    mismatch, with the reason and the plan (migration or permanent exception).

## Section to paste into the spec

```md
## Naming

Conventions read: <files and rows>

### Terms
<glossary entries, Avoid lists, open terms marked>

### Names in each layer
| Term | Table | Column or index | ORM model | DTO field | Route | JSON or config field | UI label | Differs because |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |

### Item kinds against the template
| Kind | Missing or extra fields | Actions | Owner kinds and owner rules | Differs because |
| --- | --- | --- | --- | --- |

### Caller examples (proposed)
1. <common call>
2. <composition>
3. <mistake and recovery>

### Deferred surface
<fields, routes, options left out until a caller needs them>

### Exceptions
| Name | Rule it breaks | Reason | Plan |
| --- | --- | --- | --- |
```

## Pass criteria

- Every project term in the spec is in the glossary, once.
- No word names two concepts in the per-layer table.
- No new surface has an unexplained "Differs because" cell.
- Every owner-dependent rule is stated for every owner kind; every kind-dependent rule for
  every kind.
- Every enum's values follow one scheme and have labels.
- Every exception has a reason and a plan.
