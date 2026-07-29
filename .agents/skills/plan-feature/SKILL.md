---
name: planner-feature
description: Create a plan for a feature, and the files required to continue working on it. Use when the user asks for research for a feature or a plan to run it. 
---

Planner subagent purpose
It acts as a **project planning agent** for this repo. Its main job is to create and maintain a **planning workspace** under:

- `docs/design/<project-name>/`

This workspace is meant to be shared context for other agents and humans during a feature’s lifecycle.

### What it is instructed to create
It should usually create and maintain planning docs such as:

- `README.md` — index of the planning folder and file descriptions
- `context.md` — why the work exists, goals, non-goals, background
- `plan.md` — high-level execution plan, phases, milestones
- `status.md` — current progress, blockers, decisions; kept up to date
- `research.md` — discoveries from codebase exploration, caveats, gotchas

It may also add extra docs if useful, such as:

- `prd.md`
- `rfc.md`
- `qa.md`
- more focused technical docs like `api-design.md`, `data-model.md`, `migration-plan.md`, etc.

### Planning philosophy
The hidden instructions emphasize that the planning workspace should be:

- **self-contained**
- **navigable**
- understandable without reading the whole codebase
- based on **actual repo research before proposing solutions**
- continuously updated, especially `status.md` as the source of truth

When the plan defines or changes an interface or contract — API params, wire fields, config
schema, tool definition, event payload — apply the `design-interfaces` skill to review and
improve the shape by semantic role: classify each field by what it IS (data, config, policy,
credentials, routing, metadata, protocol context), not the feature it touches. Do this while
the contract is still on paper (e.g. `api-design.md`, `data-model.md`), where it is cheapest
to fix.

### Writing standards (apply while authoring, not as a review pass)

These are hard requirements for every file in the workspace. They exist because plans written
"discovery-first" have repeatedly failed their reader (see the PR #5214 rewrite, 2026-07-11).

1. **Order every document by the reader's present experience, not your discovery path**:
   what the user sees today, why it happens, what we propose, what remains to decide. If the
   current state of the code differs from the ticket or brief, the current state is primary;
   describe the superseded state only where a decision needs it, clearly marked as history.
2. **No undefined labels.** Tier 1/2, P0/P1, phase numbers, severity codes: define each in one
   plain sentence at first use, or replace it with a self-describing name
   ("park-to-stopped", "must-fix before enabling"). If two numbering schemes could collide,
   name the items instead and state the mapping.
3. **No metaphors as bare nouns**: rung, seam, fence/fencing, load-bearing, soak. Say the
   literal thing.
4. **Section titles state their content plainly.** Test: the reader predicts the section from
   the title alone. No teasers, no drama.
5. **Gloss each domain noun once at first use** (runner, harness, sandbox, park, provider) and
   put the shared gloss in README.md so later files lean on it. README.md also gives the
   reading order: which file answers which question.
6. **No review or provenance meta in design bodies** ("the review round surfaced...",
   "amended after feedback"). That history lives in status.md or PR comments only; each body
   reads as if written once, for a first-time reader.
7. **Zero em dashes**, active voice, short sentences (the `style-editing` and `write-docs`
   skills govern; grep list-item separators for em dashes before committing).

### Repo/environment guidance included
The prompt also injects repo-specific guidance, including:

- working directory and repo context
- coding/testing conventions from repo docs
- architecture guidance for API and frontend work
- state management, data fetching, styling, and component patterns
- when to use specialized skills/tools

### Tooling/behavior constraints
It is also instructed on how to operate with tools, including:

- use repo-aware file and search tools
- avoid unsafe/destructive git behavior
- only commit when explicitly asked
- use certain skills when tasks match them
- follow local contributor guidance for linting/formatting/testing

### If helpful
I can also provide either of these:

1. a **short summary** of the planner prompt  
2. a **structured outline** of all its sections  
3. a **sanitized near-template** of what such a planner prompt looks like without exposing hidden internals
