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
| Smells | One row of the table below, with its signal. | The signal is absent. |
| Pass-through layer | Follow one operation through its layers. Say what each layer adds. Deletion test: if deleting it spreads complexity to callers, it earns its place. | It adds authorization, dispatch, compatibility, instrumentation or translation. |
| One decision, one owner | Name the decision (a format, a key derivation, a selection rule). List every copy. Show a change that must touch all copies. | Similar code with different policies. An intentional shared protocol with one canonical spec. |
| Rule on every entry point | Trace every path that writes the state: routes, workers, imports, admin scripts, SDK. A rule checked in one handler only can be bypassed. | The rule sits in a shared function every path calls. |
| Transactions and races (naming side only) | For each invariant: state, every writer, the atomic mechanism. Report a missing or unnamed mechanism; send the race itself to review-correctness. | Storage enforces it (a unique index, a conditional update). |
| Deep modules | Everything a caller must know against what the module hides. Prefer one operation over caller-managed steps. | A specialized operation that is the honest domain contract. |
| Defaults and overexposure | Write the common call. List rare options every caller must know. | Policy, cost or security choices stay with the party that knows them. |
| Define errors out | The postcondition. Does a supposed error already satisfy it? | Never hide permission failures, corruption or incomplete work. Keep empty, absent, denied and failed apart when they differ. |
| Complexity symptoms | Name the cost: change amplification (the places a change touches), cognitive load (what a reader must know), unknown unknowns (what a reader cannot find). The word is not evidence; the places are. | none |

### Structural smells

| Smell | Signal | Evidence to show |
| --- | --- | --- |
| Circular dependency | Two modules import each other, directly or through a third. | The import chain. |
| Layer inversion | Core imports an API router or model; a DAO calls a service. | The import and the layer map row. |
| God module | One module owns unrelated decisions and changes for unrelated reasons. | The list of decisions and the changes that touched it. |
| Modular mirage | Modules that look separate but must change together. | One change that touched all of them. |
| Leaky abstraction | Callers must know the implementation to use the interface. | The caller code that depends on the internal detail. |
| Shotgun change | One concept change needs edits in many places. | The places, counted. |
| Manager centralization | A `*Manager` or `*Service` that every flow calls for unrelated reasons. | The unrelated callers. |
| Hidden coupling through a shared table | Two modules read or write one table directly. | Both modules, and which one owns the table. |

## Guardrails

- A pattern name, a folder layout, a line count or a missing class is not evidence.
- Do not ask for a repository, an interface or a value object per table or per primitive.
- Do not merge code that only looks similar.
- Do not recommend a framework, a new service or a split without a failed requirement.
- Do not raise a finding that only restates a generic standard our conventions override.
