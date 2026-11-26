# Checks

Use the checks that matter for the target. They are prompts to investigate, not a list of
defects to fill. Each check names its rule source, the evidence to collect, and when to keep
the design. Rules marked "must" can raise the rating to Medium or High; "should" findings
are suggestions unless they cause a wrong result.

The naming rules are defined in `.agents/skills/naming-and-resources/references/`. This
page says how to check them.

## A. Names

| Check | Rule source | Evidence to collect | Keep when |
| --- | --- | --- | --- |
| One concept, several names (must) | `naming-rules.md` 1; `layer-name-table.md` | The per-layer inventory row with the differing cells, and where each is used. | The cell has a recorded reason: a shipped name with a plan, an external standard at a boundary, a convention row. |
| One word, several meanings (must) | `naming-rules.md` 1 and 2 | Each meaning, where it is used, and a reader who would guess wrong. Decide whether the meanings sit in one context or in two contexts with a mapping. | Two contexts with an explicit mapping and no shared state. |
| Enum values from mixed schemes (must on new enums) | `naming-rules.md` 5; `resource-template.md` 7 | The values side by side, the question each one answers, and the glossary words they should reuse. | The values are shipped and stored; then record and stop the spread. |
| Misleading name (must when a caller acts on it) | `naming-rules.md` 4 | Two plausible meanings, the one the code uses, and the wrong action the other reading causes. | Short local names; a name the glossary defines with that exact meaning. |
| Name that needs a warning (must) | `naming-rules.md` 4 | The target's own rule that stops a misreading ("never show it as", "keep them apart", "does not mean"). Whether the target spreads the name to new surface. | none; a shipped name may be recorded, but not spread |
| Join key vocabulary (must) | `naming-rules.md` 1 | For each key that joins two things: its values on each side, the source of each value (catalog, enum, user input, backfill), and the example values in the target against the stored values in the code. | One vocabulary, one mapping place. |
| Vague or hard name (should) | `naming-rules.md` 4 | The concept the name hides, and whether it mixes two concepts. | The name is scoped by a clear parent. |
| Verb set and pairs (should; must on public routes) | `naming-rules.md` 3; `project-conventions.md` Operation ids | The verbs used across sibling kinds and layers, and the missing half of a pair. | The domain's established verb set, even if it differs from another domain. |
| Field names (should) | `naming-rules.md` 6; `project-conventions.md` | Missing unit suffixes, singular lists, timestamps without `_at`, booleans without `is_`, catalog ids without `_key`. | A convention row says otherwise. |
| Labels (must when two labels can be confused) | `naming-rules.md` 9 | The label, the concept, and the confusable neighbor. | none |
| Generic standard pushed over ours (never a finding) | `project-conventions.md` | If you are about to ask for `create_time`, `display_name`, `page_token` or an AIP resource name, stop. | always keep ours |

## B. Patterns and structure

| Check | Rule source | Evidence to collect | Keep when |
| --- | --- | --- | --- |
| Same pattern for every kind (must) | `naming-rules.md` 8; `resource-template.md` 2 | For each sibling kind: columns, index shapes, DTO fields, routes, labels. Mark the one that differs. | The spec gives a reason; or following the pattern would spread a known fault. |
| Every owner level (must) | `resource-template.md` 3 | For each owner-dependent rule (slug uniqueness, default, read access, deletion): which owner kinds it covers, and the index or constraint for each. A rule stated for one owner kind only is a gap. Also each column added to every owner's rows: its meaning for each owner kind. | The spec says why an owner kind is excluded, and the column does not exist on its rows. |
| Exception spread to new surface (must) | `layer-name-table.md` | A shipped name kept as an exception, and the new indexes, fields, references or code in the target that reuse it instead of the term. The one place where the mapping happens. | The new surface uses the term, and the mapping has one owner. |
| Template fields and actions (should; must on new kinds) | `resource-template.md` 1, 4, 5 | Fields missing or added against the template; actions missing, renamed or reshaped; custom actions that a field edit could replace; route pattern. | Recorded reason. |
| Field ownership (must when both sides write) | `resource-template.md` 6 | Who sets the field, who may change it, which value wins, what happens when its source changes. | none |
| Folder and module names (must when a pair differs only by number) | `naming-rules.md` 7; `project-conventions.md` Folders | The folder pair, what each owns, where a reader would look, and the matching route and table prefixes. | The names say what each owns. |
| Name follows the layer map | `project-conventions.md` Folders | A folder, route prefix and table prefix for one concept that use three words. | Recorded mismatch with a plan. |
| Shipped name changes | `resource-template.md` 8 | Stored rows and JSON, old clients, mixed-version deploys. Migration plan or exception. | Additive change. |
| Doubtful surface (should) | `spec-checklist.md` 10 | A new field, route or option with no current caller. | A named current caller. |

## C. Layering

| Check | Evidence to collect | Keep when |
| --- | --- | --- |
| Responsibility layers | Input and output handling, business rules, storage access, and where each sits. `api/AGENTS.md` layering is the authority. | One module may hold several responsibilities if they stay separable. |
| Structural problems | One row of the table below, with its signal. | The signal is absent. |
| Pass-through layer | Take one call from the top layer to the bottom, and state the work each layer does. Then imagine the layer removed: if callers would each have to take on that work, keep the layer. | It adds authorization, dispatch, compatibility, instrumentation or translation. |
| One decision, one owner | Name the decision (a format, a key derivation, a selection rule) and each place that holds it. Give a realistic change that would have to edit each place. | Similar code with different policies. An intentional shared protocol with one canonical spec. |
| Rule on every entry point | List each path that writes the state: routes, workers, imports, admin scripts, SDK. A worker or a script can skip a check that lives in one route. | The rule sits in a shared function every path calls. |
| Transactions and races (naming side only) | For each invariant: state, every writer, the atomic mechanism. Report a missing or unnamed mechanism; send the race itself to review-correctness. | Storage enforces it (a unique index, a conditional update). |
| Deep modules | Compare what callers must learn with what the module keeps inside. One call beats a series of steps that each caller must manage. | A narrow operation that states exactly what the domain does. |
| Defaults and overexposure | Write the common call. List rare options every caller must know. | The party with the facts decides on policy, cost and security. |
| Define errors out | What the caller wants to be true afterwards, and whether that is already true in the case that now raises an error. | Permission failures, damaged data and unfinished work must always reach the caller. Keep empty, absent, denied and failed apart when they differ. |
| Complexity symptoms | Name the cost: change amplification (the places a change touches), cognitive load (what a reader must know), unknown unknowns (what a reader cannot find). The word is not evidence; the places are. | none |

### Structural problems

| Problem | Signal | Evidence to show |
| --- | --- | --- |
| Import cycle | A module ends up importing itself through others. | The chain of imports. |
| Upward import | Core uses an API router or model, or a DAO calls a service. | The import and the layer map row. |
| Catch-all module | One file makes decisions that have nothing to do with each other. | The decisions, and recent edits made for unrelated reasons. |
| Separate in name only | The folders are apart, but a change to one needs a change to the others. | One change that edited them together. |
| Exposed internals | Callers rely on how the code works inside. | The caller line that relies on it. |
| Wide edit | Changing one concept means editing many files. | The count of files. |
| One coordinator for all flows | Every flow goes through one `*Manager` or `*Service` for reasons with no link. | The unrelated callers. |
| Two modules on one table | Both modules read or write the same table directly. | Both modules, and the one that owns the table. |

## Guardrails

- A pattern name, a folder layout, a line count or a missing class is not evidence.
- A table or a primitive does not need its own repository, interface or value object.
- Code that only looks alike can stay apart.
- Do not recommend a framework, a new service or a split without a failed requirement.
- Do not raise a finding that only restates a generic standard our conventions override.
