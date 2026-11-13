---
name: write-template-playbooks
description: >-
  Write a template playbook for the build-an-agent skill: a 1-2 KB per-use-case file that
  teaches the builder agent to configure one kind of Agenta agent (changelog writer, issue
  triager, support router, and so on). Use when the ask is "write a template playbook", "add
  an agent template", "author a playbook for the build-an-agent skill", or "write the <X>
  playbook". Encodes the file format, the prompting checklist, and the platform facts authors
  get wrong.
allowed-tools: Read, Edit, Write, Grep, Glob, Bash
user-invocable: true
---

# Write a template playbook

The builder agent reads a playbook as `references/agent-templates/<key>.md` in the
build-an-agent skill, then follows it to configure that specific agent. That path is virtual: it
is generated at runtime. To add or edit a playbook, edit a `TemplateEntry` in the `ENTRIES` list
of the right category module, `sdks/python/agenta/sdk/agents/adapters/agent_templates/<category>.py`
(`engineering`, `support`, `sales`, `monitoring`, `knowledge` or `ops`). The entry's `body` is the
playbook Markdown, and its `key` becomes `<key>.md`. The generated `index.md` picks the entry up
automatically. Your job: encode the use-case thinking so a Sonnet-class
model can execute it. You get one inventory row as input (name, one-line pitch, integrations,
trigger). Turn it into a spec-conforming playbook.

Keep each playbook **1 to 2 KB**. An over-comprehensive playbook hurts: the agent cannot
extract what is relevant. Write a coherent, moderately detailed unit with a working
instructions template.

## The skeleton

Fill this in. Omit any section the use case does not need (a no-tool template drops Explore and
Connections; a no-trigger template drops the trigger half of Verify).

```markdown
# <Template name> playbook

## Match
One line: when this playbook applies. The card key plus the shape of the ask, including
free-text asks that match no card.

## Required context (ask via one request_input form)
- <field>: why the agent cannot proceed without it. When the agent can propose a value, set
  it as the field's `default` (prefilled, one-click acceptable); no default otherwise. [required]
Only fields the agent genuinely cannot proceed without. One to four. Secrets never go here.

## Researchable context (do not ask; figure it out and state the assumption)
- <field>: what the agent looks up, and what it assumes when the lookup is inconclusive. Never
  a question and never an enum. The platform prompt forbids asking for a detail the agent can
  look up or default, so this section names the lookup and the fallback assumption instead.

## Explore first (read before proposing)
- Which read tools to discover_tools and wire.
- One test_run passing the uncommitted tools in delta.set.parameters.agent.tools (the FULL
  tools list), to see the real repo or workspace. Show the user a concrete example before
  committing the full setup.

## Defaults / priors table (situation to proposed setup)
| Situation | Trigger | Tools | Behavior default |
|---|---|---|---|
| <situation> | <trigger> | <reads> + <write> | <what it does> |

## Connections
Which integrations must be ready. If missing, request_connection and stop. List the
tool-agnostic alternatives (Notion OR Confluence OR Google Drive).

## Instructions template (what to commit)
The numbered per-run procedure for instructions.agents_md: exact tools in order, pinned ids,
ending on the terminal action. Include the output-format shape.

## Verify
1. test_run with a blunt test message; read the verdict and the tools line, not a 200.
2. If a trigger: send an artificial test message first; then ask the user to run the real
   trigger test with the "Run now" button on the automation.

## Closing report
What the agent became, what is connected, what is scheduled, what you verified, what still
needs the user.
```

Every section maps to the build loop: Match to step one, Required and Researchable to
`request_input`, Explore to `discover_tools` plus `test_run`, Defaults to the proposal,
Connections to `request_connection`, Instructions to `commit_revision`, Verify to `test_run`
and the trigger test, Report to the final step.

## Three platform facts authors get wrong

These are counterintuitive and every first draft gets them backwards. State them correctly.

1. **`request_input` HAS a real `default` field (#5190, shipped) — use it.** A field's
   `default` prefills the form so the user can accept every proposal in one click; set one
   whenever the agent can propose a value. Rules: the default must match the field type
   (array of strings on a multi-select); an empty default (`""`/`[]`) means "no proposal" and
   is stripped; **date/date-time fields ignore defaults** — do not set them there. For a
   researchable choice, include a "Figure it out, use your best judgment" enum option and set
   it as the `default`. Enum options are SUGGESTIONS: every enum renders a built-in "Other…"
   free-text escape hatch, so keep lists short and likely, not exhaustive. Multi-pick
   questions use `{type: "array", items: {type: "string", enum: [...]}}`; options needing a
   sentence of explanation use `oneOf: [{const, title, description}]`, which renders as
   selectable choice cards. Forms with several questions can set `"x-ag-stepper": true` on
   requestedSchema (one question at a time + review) — the tool description teaches this;
   playbooks do not re-state it.
2. **`test_run` exercises uncommitted tools** through its in-memory delta
   (`delta.set.parameters.agent.tools` carries the FULL tools list, lists replace wholesale).
   So exploration does NOT require commit-and-stop-turn. Explore the real repo or workspace
   with new tools before committing anything. Commit-and-stop is only a fallback for when the
   flow cannot carry the delta.
3. **The trigger-test affordance is the "Run now" button** (Play icon) on the automation's
   detail screen, also in the automation's actions menu. It works for event automations and
   schedules alike, and starts a new session with the automation's message. It is never a
   flask icon. The flask is for Evaluations. Write the correct copy in every Verify section.

## What a playbook NEVER contains

Add what the model lacks for this use case; omit what it already knows. Do not put in a
playbook:

- The generic build loop (discover, commit, test). It lives in the build-an-agent skill body.
- The config schema (tool entries, the fixed `llm`/`harness`/`runner` block). It lives in
  the skill body and `references/config-schema.md`.
- Tool wire shapes or cron rules. Those live in the skill body and its other references.

A playbook that re-teaches these wastes the 1-2 KB budget and drifts from the source of truth.

## Read a reference when

| To do this | Read |
|---|---|
| Get the prompting rules for procedure, priors, forms, and verification | `references/prompting-checklist.md` |
| Copy from a complete, spec-conforming example | `references/worked-example.md` |

The canonical file format and the index.md match-table format are in the project spec at
`docs/design/agent-workflows/projects/agent-templates/playbook-spec.md`. Read it if the
skeleton above is not enough.
