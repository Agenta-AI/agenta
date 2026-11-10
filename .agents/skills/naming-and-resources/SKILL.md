---
name: naming-and-resources
description: Pick and record the names of a new concept in every layer (database table and column, ORM model, DTO, route, JSON field, UI label), and give every stored item kind the same resource shape and the same actions. Holds the glossary format with an Avoid list, the per-layer name table, the resource template, standard and custom actions, field, enum, state and owner rules, the Agenta convention table, the folder naming rule, and the spec naming checklist. Use when writing or changing a spec, design or plan that adds or renames a table, column, index, route, DTO field, enum value, config field or UI label, when asked "what should this be called", "is this name consistent", "fill the naming section", or when another skill asks for the per-layer names. It applies even when the word "naming" never appears. Do not use it for field grouping by role (use design-interfaces), for migration errors, or for a rated review (use review-naming).
---

# Name a concept once, in every layer

You help a spec author choose one name per concept, write it down in every layer, and give
each new item kind the same shape and actions as its siblings. You write into the spec or
design. You do not change code.

## When it applies

- A spec, design or plan adds or renames a table, column, index, route, DTO field, enum
  value, config field or UI label.
- Someone asks what a thing should be called, or whether two names mean the same thing.
- review-naming or a review loop points here for the rules.

For how to group fields by role (data, config, policy, credentials, routing, metadata), use
the `design-interfaces` skill. This skill decides the names and the shared shape; that skill
decides where a field sits.

## Procedure

1. **Read the conventions first.** Read `references/project-conventions.md`, the `AGENTS.md`
   of each area the spec touches, and any glossary the spec folder already has. Project
   conventions win over generic standards.
2. **Find the existing analog.** For each new table, route, DTO, enum and label, search the
   repo (not memory) for the closest existing one. Copy its shape and names, or write down
   why the new one differs. Read origin's release branch, not a stale checkout.
3. **Write the glossary entries.** One entry per project concept, in the format in
   `references/glossary-format.md`. Pick one word and list the rejected words under Avoid.
   When the spec or the person uses a word that conflicts with the glossary or with the
   code, say so at once and ask which meaning is right.
4. **Fill the per-layer name table.** For each term, write the name it takes in each layer,
   with `references/layer-name-table.md`. A cell that differs from the term needs a reason.
5. **Apply the resource template.** For each item kind, compare its fields, owner columns,
   actions, enums and states with `references/resource-template.md`. Record each
   difference and its reason.
6. **Check the names.** Apply `references/naming-rules.md`: one term per concept, one verb
   set, no vague names, unit suffixes, one folder rule, the same pattern for every kind.
7. **Write three caller examples.** The common call, a realistic composition, and a likely
   mistake with its recovery. Check that a reader can predict arguments, result, effects and
   errors from the names alone.
8. **Run the checklist.** Go through `references/spec-checklist.md` and paste its "Naming"
   section into the spec, filled in. A spec that adds a concept without this section is not
   ready for design review.

For a decision that is costly to reverse (a shipped name, a table name, a route prefix),
sketch two real options with a caller example and the migration cost before you pick one.
Keeping the current name is one option.

## References

Always:

- `references/project-conventions.md`: the Agenta convention table, with file paths.
- `references/glossary-format.md`: glossary entry format and the Avoid list.
- `references/layer-name-table.md`: one concept, one name, every layer.
- `references/resource-template.md`: fields, owner and parent, actions, enums, states,
  field ownership, shipped-name changes.
- `references/naming-rules.md`: the naming and consistency rules.
- `references/spec-checklist.md`: the section every spec fills in.

Only when needed:

- `references/optional/signature-checks.md`: when the spec defines a function or method
  signature with several parameters of one type, booleans or defaults.
- `references/optional/contract-semantics.md`: when a name or status could claim more than
  the operation does (queued against done, query against command).
- `references/optional/edge-values.md`: when a field can be absent, null, empty or zero.
- `references/optional/design-vocabulary.md`: when a design discussion mixes words such as
  module, layer, boundary and service.

## Rules

- Do not invent a project convention. If the code has none, say so and let the spec decide.
- A shipped name changes only with a migration plan or a recorded exception.
- Do not spread a known bad pattern to stay consistent. Record it and stop it at the new
  surface.
- Plain English in the spec text. Code names stay exact.
