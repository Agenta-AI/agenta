---
name: review-naming
description: Review one code change, or one design (an OpenSpec change, a spec draft or an architecture doc), for naming, consistency and layering, and rate it Low, Medium, or High. Looks for one concept with several names across layers (table, column, DTO, route, JSON field, UI label), one word with two meanings, enum values from mixed schemes, names that mislead, item kinds or owner levels that break the shared resource pattern, singular and plural folder pairs, and layering faults such as pass-through layers, one decision in several places, rules that only one entry point checks, and doubtful public surface. Each finding cites the rule it breaks. Use when asked to "review the naming", "check this spec for consistent names", "is this PR consistent with our conventions", "review this PR that changes a contract", or when a review loop runs the naming lens. Read-only; it reports findings and does not fix them.
---

# Review a change or a design for naming and consistency

You review one target and report where names, patterns and layers are inconsistent, and how
much it matters. You do not edit code or documents, and you do not post anything. The rules
live in the `naming-and-resources` skill; this lens applies them.

## Targets

The caller names one target.

- **Code (default).** A diff between two commits that changes a contract: a table, column,
  index, route, DTO field, enum value, config field or UI label.
- **Design.** An OpenSpec change folder, a spec draft or an architecture doc. No code exists
  yet, or the code is not the subject. Check the proposal before any migration is written.
  When the doc describes existing code (an architecture map), review the names in the code
  it describes: folders, tables, modules, routes, types. The doc is the map, not the target.

## Inputs

The caller gives you these. If the caller leaves one out, work it out and say what you used.

For a code target: **checkout path** (the repo at the head commit), **base** (for a PR, the
merge base of the head and its base branch), **head**. Read the change with
`git -C <checkout> diff <base> <head>`.

For a design target: **checkout path** (today's code, to check what the design says about
today), **design path** (read every file), **version** (commit or date).

For both: **context file (optional)** with settled decisions and owner rules. Do not raise a
settled point again unless the fix is wrong or incomplete; then say why. Only the caller's
context file settles a point. A decision log inside the target (for example a `SETTLED.md`
in the spec folder) is part of the design under review: you may disagree with a naming
decision recorded there, cite the rule, and say where it was decided.

## Procedure

1. **Read the conventions first.** Read `lens.md` in this skill's directory, then from
   `.agents/skills/naming-and-resources/references/`: `project-conventions.md`,
   `naming-rules.md`, `layer-name-table.md`, `resource-template.md`. Read the `AGENTS.md` of
   each area the target touches and any glossary the target has. Read
   `references/calibration.md` for what is and is not a finding. Judge against these, not
   against a generic ideal. Flag a doc that the code contradicts.
2. **Sketch the path under review.** Write a few rows that give each module, its promise to
   callers, the details it keeps inside, the state it owns and its word for each concept. Share
   the sketch only when a finding needs it.
3. **Build the name inventory.** For each concept the target adds or changes, collect its
   name in every layer (the per-layer name table). Include enum values, index names, folder
   names, route parameters and UI labels. Collect every meaning of each word.
4. **Trace one normal path and one failure path** through every layer, from entry point to
   stored state and response, and check the name at each hop. For a design, follow the
   proposal step by step, and say that the result is reasoning rather than a test.
5. **Try one likely change.** Use a change that today's requirements make realistic (for
   example, one more item kind or one more owner level). Count the files it touches and the
   names it forces you to choose. Leave out consumers nobody has asked for.
6. **Apply the checks** in `references/checks.md`.
7. **Filter.** Pass each finding through the evidence gate in `references/report-template.md`.
   Group symptoms under one cause.
8. **Write the report** in the format of `references/report-template.md`, with the rating.

## Rules

- Read-only. Do not install dependencies, and do not run builds, type checks, linters, or
  tests.
- Review the target. Existing code counts where the target adds to it, copies it, or depends
  on it. A pre-existing mismatch that the target spreads to new surface is the target's.
- Project conventions win over generic standards. Never ask to move toward a generic rule
  that `project-conventions.md` overrides.
- Prefer a few substantial findings to a list of nits.
- Stay in this lens. Races and data loss go to review-correctness, removable parts and
  needless machinery to review-simplify, secrets and access to a security review, and field
  grouping by role to design-interfaces. Report the naming side of such an issue only. Drop
  a finding that sits fully in another lens.
- With a pull-request procedure (a review loop), the procedure owns the target, the head and
  publication. This lens writes its own report; the loop merges it into one findings list.
- Do not read `references/evals.md` during a review. It is for testing this skill.

## Optional references

Load only when needed:

- `references/optional/red-flags.md`: a one-page list of design warning signs, when a finding
  needs a short name for a structural problem.
- `references/optional/confidence-labels.md`: when the caller asks for a confidence label
  on each finding.
- `references/optional/action-timing.md`: when the caller asks when to act on each finding.
- `references/optional/long-report.md`: when the caller wants a full report instead of the
  lens format, for example a standalone architecture review.
- `references/optional/restraint-cases.md`: extra cases for when you are unsure whether a
  pattern is a real finding.

## Rating

- **Low:** names and patterns match the glossary, the conventions and the template, or only
  optional suggestions remain.
- **Medium:** on new surface, at least one concept has two names across layers, one word
  has two meanings, an item kind or an owner level breaks the shared template, or a layering
  fault adds a real obligation. The change still works.
- **High:** a mismatch on a shipped or about-to-ship contract (stored data, a migration, a
  public route or SDK field) that will need a migration to fix, or a name that leads callers
  to a wrong result.

The report ends with the line `Rating: Low|Medium|High` with nothing after it.
