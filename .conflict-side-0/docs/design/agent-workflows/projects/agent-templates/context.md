# Agent templates: context

## Why this exists

The agent home page shows a strip of template cards. Each card is a shortcut: click it and a
builder agent opens in the playground, seeded with a one-line prompt like "Create an agent
that turns merged pull requests into clean release notes and publishes them to our docs
page." The promise is that the card carries the use case. The reality is that the card
carries a sentence and nothing else.

That sentence describes an outcome. It does not tell the builder agent how to reach it. The
builder agent (a Sonnet-class model running the platform build-an-agent skill) is left to
derive the entire use case from one line. It has no playbook for a changelog writer, so it
guesses. It asks the user questions the user cannot answer, or asks nothing and assumes. It
wires the wrong tools, or wires read tools and never wires the write tool that does the real
work. It proposes a plan built on wrong priors, or proposes no plan and starts committing.
The run stalls, wanders, or produces an agent that does not do the job.

The prompt is the wrong place for the intelligence. A one-line prompt cannot hold the
problem decomposition, the tools the use case needs, the questions worth asking, the
defaults worth proposing, and the way to verify the result. That knowledge has to live
somewhere the builder agent reads in full when it recognizes the use case. That place is the
skill.

## What this project does

Move the per-use-case intelligence into the platform build-an-agent skill as an
agent-templates reference set. Each template gets a short playbook (about one to two
kilobytes of markdown) that encodes how to build that specific agent: the context to gather,
the tools to wire, the defaults to propose, and how to verify. The skill body becomes a
short router that points the builder agent at the right playbook. The card prompt shrinks to
a pointer ("Build a changelog writer that ...") because the depth now lives in the playbook,
not the prompt.

Three things move together:

- **The skill.** Reframe the build-an-agent skill body to route by use case, and append the
  playbooks and an index as bundled reference files. This is the content change that fixes
  the broken-prompt problem.
- **The catalog.** Grow from 6 templates to about 28, chosen for the beachhead personas
  below. Each new template is a card plus a playbook.
- **The authoring skill.** Add a repo skill that encodes how to write a playbook, so the
  remaining playbooks can be written consistently by a Sonnet-class author and reviewed
  against one checklist.

## Personas the catalog serves

Three beachhead users. The catalog is weighted toward the first.

- **Founding engineer or technical CEO** automating their own operations. Wears every hat,
  wants an agent that removes a recurring chore (a pipeline digest, an incident briefer, a
  changelog). Values a working default over a questionnaire.
- **Junior engineer** inside the development workflow. Wants help with the daily loop: PR
  review, issue triage, CI-failure triage, a repo digest. Knows the tools, wants the wiring
  done right.
- **Freelancer** building automations for clients over a knowledge base (Notion,
  Confluence, Google Drive). Wants a Q&A bot, a support-reply drafter, a content
  repurposer that they can stand up for a client and hand over.

## How this builds on prior art

This is not the first pass at builder-agent reliability. Two efforts came before and their
conclusions carry straight into this work.

- **Builder-agent reliability** ([../builder-agent-reliability/](../builder-agent-reliability/))
  found the failure modes a weaker builder model hits: it does the reads then wanders and
  stops short before the write; a huge `LIST_ALL_*` payload pushes it to a shell tool and
  trips a separate approval gate; vague instructions fail on multi-tool chains. The fix is an
  explicit numbered procedure that names exact tools in order and ends on the terminal side
  effect. Every playbook encodes its use case as exactly that.
- **Skill packaging** (the plan under builder-agent-reliability) settled the shape of the
  skill: one reunified playbook with progressive disclosure through `references/`, not four
  cross-referencing skills. The SKILL.md body is a short router with a "to do this, read
  this" index; the deep content lives in reference files that cost nothing until the agent
  opens them. The agent-templates set is a direct extension of that index pattern.

The changelog-writer playbook Mahmoud wrote by hand (see [exemplar.md](exemplar.md)) is the
seed. It shows what "encode the thinking so a Sonnet-class model can execute it" looks like
in practice. Every other playbook is written to match it.

## Non-goals

- **No backend template hosting.** The card registry stays a static frontend file and the
  playbooks stay bundled in the skill. Serving templates from the backend is a separate,
  later question.
- **No new elicitation protocol, unless [open-questions.md](open-questions.md) #2 decides
  otherwise.** The `request_input` form has no default-value field today. The playbooks work
  within that limit (enum options plus guidance in the description). Adding a `default` field
  to the elicitation protocol is a separate lane that touches the protocol and the frontend
  form; it is proposed as an option, not assumed.
- **No rework of the flag-off legacy surfaces beyond what a decision requires.** The live
  surfaces are the strip-era ones. The classic gallery, the setup drawer, and the onboarding
  quick-pick list are reachable only with a flag flipped off. Whether to freeze, adapt, or
  delete them is [open-questions.md](open-questions.md) #4; the default is to keep the strip
  path correct and not invest in the legacy path.
- **No change to the generic build loop or the config schema.** Those live in the skill body
  and `config-schema.md`. Playbooks layer use-case specifics on top; they never re-teach the
  loop.

## Reading order

1. This file, then [research.md](research.md) for the verified mechanics and every code
   anchor.
2. [exemplar.md](exemplar.md) and [playbook-spec.md](playbook-spec.md) for what a playbook
   is and how to write one.
3. [template-inventory.md](template-inventory.md) for the catalog.
4. [plan.md](plan.md) for the work packages, then [open-questions.md](open-questions.md)
   before starting (several decisions gate the frontend and authoring work).
