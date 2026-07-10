# Prompting checklist for playbook authors

The rules a playbook must not skip, grouped by area. Each is one line plus a short why. Tag:
`[E]` = external evidence or practice, `[J]` = our own judgment (from the exemplar, the
builder-reliability findings, or design reasoning).

## Procedure writing (the instructions template a weaker model executes)

- `[E]` Write per-run behavior as an explicit NUMBERED procedure, not prose. A Sonnet-class
  model follows a chronological step list far more reliably than a paragraph.
- `[E]` Name the EXACT tool at each step (`LIST_PULL_REQUESTS`, `SEND_MESSAGE`), not the
  capability. Vague names lower tool-invocation accuracy.
- `[J]` Make the LAST step the terminal side effect and say "finish by doing step N."
  Multi-tool runs do the reads then wander and stop short before the write. This is the core
  reliability finding.
- `[J]` Pin concrete ids (channel id, repo, owner) once. Do not tell the agent to re-resolve
  them each fire; re-resolution is fragile and burns a list-dump.
- `[E]` Prefer the narrowest filtered tool (`FIND_*`, `GET_A_*`) over `LIST_ALL_*` dumps. A
  big payload pushes the agent toward a shell tool, which trips a separate approval gate and
  derails the run.
- `[E]` Provide a concrete output-format TEMPLATE (the shape of a release note, a digest).
  Agents pattern-match a template better than a described format.
- `[E]` Calibrate prescriptiveness to fragility: rigid on the fragile tool-chain path, free on
  judgment calls (tone, grouping). Explain *why* only where the agent makes context-dependent
  calls.

## Template design (design the use case, not the loop)

- `[E]` Use decision tables for branching (release process to trigger type), not prose
  conditionals. Agents pattern-match tables well.
- `[E]` Give ONE default with a brief escape hatch, never a menu of equals. Too many options
  with no clear default is a top cause of the agent pursuing unproductive paths.
- `[J]` Encode a priors/defaults table (situation to proposed setup) so the agent proposes
  best-practice defaults instead of interrogating the user on every decision.
- `[E]` Keep a short "Gotchas" list of environment facts that defy assumption (for example,
  triggers do not follow a new revision, so re-point them after commit). Concrete corrections,
  not general advice.
- `[J]` Encode the problem DECOMPOSITION and the access the use case needs, so a Sonnet-class
  model does not re-derive it. This is the exemplar's core intent.
- `[E]` Add what the model lacks, omit what it knows. A playbook carries the use-case
  procedure, defaults, and tools, not a definition of what a PR or a cron is.

## Form elicitation (request_input, corrected for our runtime)

- `[E]` Minimize required fields. Completion drops sharply as field count rises. Keep required
  to one to four.
- `[J]` Separate REQUIRED context (must ask) from RESEARCHABLE context ("figure it out" as
  the default enum option) explicitly in the playbook. Do not leave the ask/research boundary
  to the model.
- `[J]` Propose values via the field's `default` — the form prefills and the user can accept
  everything in one click. The default must match the field type; empty defaults are stripped;
  date/date-time fields ignore defaults. See the platform facts in SKILL.md.
- `[J]` For a researchable value, include a "Figure it out, use your best judgment" enum
  option and set it as the `default`. The built-in Other… escape hatch covers custom values,
  so keep option lists short and likely.
- `[J]` Surface the speed trade-off in the description: handing information over is faster than
  "figure it out," because research takes time. Let the user choose to save the round trip.
- `[J]` Never request secrets via `request_input`; route credentials to `request_connection`.
  The runtime refuses secrets in a form.
- `[J]` Echo the plan in plain language BEFORE executing (before commit, before creating a
  trigger) so the user can veto. Commit and trigger are approval gates; pre-state what is
  coming.

Field types are `string`, `number`, `integer`, `boolean` only. No arrays, no nested objects,
no multi-select. Formats: `date`, `date-time`, `email`, `uri`, `multiline`.

## Verification (against our runtime)

- `[J]` Explore before proposing: wire read tools, run a `test_run` (pass uncommitted tools in
  `delta.set.parameters.agent.tools`), then show the user a concrete example before committing
  the full setup.
- `[J]` After every commit, run `test_run` and read the `verdict` and the tools line, not a
  200. An `incomplete` verdict means rewrite the instructions blunter and re-test.
- `[J]` Trigger verification is two-phase: first fire an artificial test message as if the
  trigger fired; only if that passes, hand the user off to the real trigger test. The affordance
  is the Lightning "Test event" button for a subscription, the Play "Run" button for a
  schedule. Never a flask (that is Evaluations).
- `[J]` For an external WRITE, confirm the side effect by reading it back (fetch the channel,
  re-read the issue). A returned tool result alone is not proof.
