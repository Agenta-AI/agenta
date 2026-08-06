# Playbook spec: the canonical file format

Every template gets one playbook file under the build-an-agent skill at
`references/agent-templates/<key>.md`, about one to two kilobytes. The builder agent reads the
one that matches the chosen template. The playbook layers the use-case specifics onto the
generic build loop; it never repeats the loop, the config schema, or the cron rules, which live
in the skill body and in `references/config-schema.md`.

Read [exemplar.md](exemplar.md) for a filled-in instance. This file states the rules the format
follows, corrected against the runtime.

## The skeleton

```markdown
# <Template name> playbook

## Match
One line: when this playbook applies. The card key plus the shape of the ask, including
free-text asks that match no card.

## Required context (ask via one compact request_input form)
- <field>: <why the agent cannot proceed without it>. [required]
  When the agent can propose a value, set it as the field's `default` — the form prefills
  and the user can accept everything in one click. No default when there is no basis for one.
Only fields the agent genuinely cannot proceed without. Keep to one to four. Secrets never
go here; they go to request_connection.

## Researchable context (ask, defaulting to "figure it out")
- <field>: the agent can discover this. Offer an enum including a "Use your best judgment"
  or "Figure it out from what's connected" option and set it as the `default`; the built-in
  Other… option covers custom values. Note the trade-off in the description: handing it over
  is faster than the agent researching it.

## Explore first (read before proposing)
- Which read tools to discover_tools and wire.
- Run one test_run to see the real workspace or repo. Pass uncommitted tools in the delta
  (delta.set.parameters.agent.tools carries the FULL tools list). Then show the user a
  concrete example (a sample digest, note, or reply) before committing the full setup.

## Defaults / priors table (situation to proposed setup)
| Situation | Trigger | Tools | Behavior default |
|---|---|---|---|
| <situation> | <trigger> | <reads> + <write> | <what it does> |
Encodes best-practice priors so the agent proposes a setup instead of interrogating the user.

## Connections
Which integrations must be ready. If missing, request_connection and stop. List the
tool-agnostic alternatives (for example, Notion OR Confluence OR Google Drive).

## Instructions template (what to commit)
The numbered per-run procedure for instructions.agents_md: exact tools in order, pinned ids,
ending on the terminal action. Include the output-format shape.

## Verify
1. test_run with a blunt test message; read the verdict and the tools line, not a 200.
2. If a trigger: fire an artificial test message first; then ask the user to run the real
   trigger test (Lightning "Test event" for a subscription, Play "Run" for a schedule).
   Read back the side effect.

## Closing report
What the agent became, what is connected, what is scheduled, what you verified, what still
needs the user.
```

## Rules the format follows

- **Map every section to the build loop.** Match to step one, Required and Researchable to
  `request_input`, Explore to `discover_tools` plus `test_run`, Defaults to the proposal,
  Connections to `request_connection`, Instructions to `commit_revision`, Verify to `test_run`
  and the trigger test, Report to the final step.
- **Omit any section the use case does not need.** A no-tool template drops Explore and
  Connections. A no-trigger template drops the trigger half of Verify.
- **Never repeat the generic build loop, the config schema, or the cron rules.** Those live in
  the skill body and `references/config-schema.md`. A playbook that re-teaches them wastes the
  size budget and drifts from the source of truth. Add what the model lacks for this use case;
  omit what it already knows.
- **Stay at one to two kilobytes.** An over-comprehensive playbook hurts, because the agent
  cannot extract what is relevant. Keep it a coherent, moderately detailed unit with a working
  instructions template.

## The request_input dialect (defaults, multi-select, choice cards)

Resolved: [open-questions.md](open-questions.md) #2 shipped as issue #5190 (PR #5177). The
elicitation form supports real defaults and two richer field shapes
(`web/packages/agenta-shared/src/utils/elicitation.ts`; design record:
`docs/design/agent-chat-interaction-kinds/decisions.md`):

- **`default` prefills the field** (string/number/boolean; array of strings on a multi-select),
  so a form whose proposals are right is accepted in one click. The default must match the
  declared type. An empty default (`""`/`[]`) means "no proposal" and is stripped.
  **Date/date-time fields ignore defaults** — do not set them there.
- **Researchable context: set the "Figure it out" enum option as the `default`.** Enum options
  are suggestions, not a hard constraint — every enum renders a built-in "Other…" free-text
  escape hatch, so keep option lists short and likely.
- **Multi-pick questions** use `{type: "array", items: {type: "string", enum: [...]}}` — the
  one admitted array shape; the answer is an array of strings.
- **Context-ful options** use `oneOf: [{const, title, description}]` (single fields and array
  items); options with descriptions render as selectable choice cards.
- **Field leaves are string, number, integer, boolean** (plus the string-array multi-select).
  No nested objects. Formats: date, date-time, email, uri, multiline, cron.
- **Secrets are refused.** Credentials go through `request_connection`, never `request_input`.

## The index.md match table

`references/agent-templates/index.md` is the router the skill body points at. It holds one row
per playbook so the builder agent can classify an incoming ask and open the right file. Format:

```markdown
# Agent template playbooks

Match the user's ask to a row, then read the named playbook file for the full setup.

| Template | Category | When it matches | Playbook file |
|---|---|---|---|
| Changelog writer | Engineering | Turn merged pull requests into release notes... | references/agent-templates/changelog-writer.md |
| Issue triage | Engineering | Label new issues by area and priority... | references/agent-templates/issue-triage.md |
| Docs Q&A | Knowledge | Answer questions from our docs or workspace... | references/agent-templates/docs-qa.md |
| ... | ... | ... | ... |

No match? Use the generic loop in SKILL.md.
```

The table lives in the index file (read on demand), not in the skill body, because the body is
effectively loaded every turn (see [research.md](research.md) Section 2). The body carries only
a one-to-two-line pointer to the index, or at most a compact category-level table. Whether the
body holds a compact inline table as well as the index file is a routing-versus-cost trade-off;
the default is a short pointer in the body and the full table in the index. There must be an
explicit "no row matches, fall back to the loop" instruction so a free-text ask that matches no
template still gets handled.
