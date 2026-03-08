# Documentation Taxonomy and Boundaries

## Why this note exists

We need a stable taxonomy before deciding which folders in `application` should own which responsibilities.

This note captures the current model.

## The six documentation classes

The top-level classification is:

1. internal agent docs
2. internal project docs
3. internal process docs
4. internal system docs
5. internal product docs
6. external product docs

## Core principle

Classify documentation by what question it answers and who it is for.

If a document tries to answer too many of these at once, it drifts.

## Canonical-doc gate

`process`, `system`, and `product` are **not** theme buckets.

They are the homes for **validated, verified, invariant truth**.

That means:

- being about process is not enough to belong in `process`
- being about the system is not enough to belong in `system`
- being about the product is not enough to belong in `product`
- PRDs, RFCs, QA plans, draft specs, migration notes, and design notes can all still be project docs

Until material has been distilled into stable truth that should hold beyond the current effort, it should remain in internal project docs.

## Best-effort truth

Even canonical docs are still **best-effort documentation** of invariant truth.

They are the best current articulation of what should be true, not a guarantee that reality perfectly matches the docs.

Practical implications:

- for `system`, the running codebase and actual system behavior may still expose drift or exceptions
- for `product`, the shipped behavior may still reveal mismatches with the intended product definition
- for `process`, actual execution may deviate from the intended workflow

So canonical docs should be treated as:

- the best current documentation of durable truth
- something to continuously reconcile against implementation and observed behavior
- not a license to ignore the codebase, production behavior, or real execution

## 1. Internal agent docs

This is documentation for agents working on the repository or participating in internal workflows.

### Purpose

These docs answer:

- how a specific agent platform should load knowledge
- how prompts, skills, or harnesses should be invoked
- how tool-specific wrappers map onto shared internal docs

### Typical contents

- platform-specific prompts
- skills
- thin harness wrappers
- tool metadata
- agent entrypoint docs

### Audience

- development agents
- engineers maintaining agent integrations

### Key property

This class should be **thin and derivative**.

It should adapt or point to canonical internal docs, not replace them.

### What it is not

It is not the primary home for:

- project memory
- engineering/product process rules
- current system definition
- current product definition

## 2. Internal project docs

This is the working memory for a specific effort.

`Project` is broad:

- feature
- subsystem
- component
- issue
- migration
- PR-sized change

### Purpose

These docs answer:

- what are we changing
- why are we changing it
- what have we learned so far
- what is the current plan, status, evidence, and rollout state

### Typical contents

- intent
- context
- research
- design options
- plans
- status
- findings
- evidence
- rollout notes

### Audience

- developers
- reviewers
- test authors
- technical leads
- development agents

### Key property

This is **mutable working memory**.

It is allowed to be messy, exploratory, and incremental.

### What it is not

It is not the durable canonical home for process, system, or product truth.

## 3. Internal process docs

This is documentation for how work should be carried through product-and-engineering execution.

This includes the lifecycle and the rules of engagement.

### Purpose

These docs answer:

- how should work be done
- what rules and guardrails apply
- what artifacts should exist
- how review, testing, release, and rollout should be conducted

### Typical contents

- SDLC / V-model guidance
- review process
- testing process
- release process
- templates
- rubrics
- policies
- guardrails
- local development runbooks

### Audience

- developers
- reviewers
- QA engineers
- technical leads
- release engineers
- development agents

### Key property

This is **internal process truth**.

Humans should be able to follow it directly. Agents should consume the same rules.

It should be stable enough to reuse across efforts, not merely process-themed.

It is still a best-effort description of the intended stable process, and real work may reveal deviations that require correction.

### What it is not

It is not the canonical home for the current product definition or the current system definition.

It is not the home for one-off project QA checklists, initiative-specific rollout notes, or draft process ideas just because they discuss testing/review/release.

## 4. Internal system docs

This is documentation for the system as currently intended internally from a system/technical perspective.

### Purpose

These docs answer:

- how is the system structured
- what architectural decisions define it
- what internal boundaries, models, and invariants currently apply
- what behaviors are true at the system level

### Typical contents

- architecture overviews
- ADRs
- domain models
- invariants
- internal boundaries
- topology and dependency maps
- technical behavior catalogs
- system-level BDD/specs when the viewpoint is technical/systemic

### Audience

- developers
- reviewers
- test authors
- technical leads
- development agents

### Key property

This is **internal system-definition truth**.

It is durable across projects, but it evolves as the system evolves.

It should contain validated, verified, invariant technical truth, not merely technical exploration or draft architecture.

It is still a best-effort description of system truth; the codebase and observed system behavior remain critical checks on drift.

### What it is not

It is not mainly about process.

It is not end-user-facing product documentation.

It is not the home for project architecture notes just because they are technical.

## 5. Internal product docs

This is documentation for the product as currently intended internally from a product perspective.

### Purpose

These docs answer:

- what user problems and use cases are in scope
- what journeys and acceptance expectations define the product
- what the current product behavior is supposed to be
- what UX intent and capability coverage currently apply

### Typical contents

- requirements
- use cases
- user journeys
- acceptance criteria
- capability maps
- product behavior catalogs
- UX intent and product design rationale
- BDD/specs when the viewpoint is user/product behavior

### Audience

- product engineers
- designers
- developers
- reviewers
- QA engineers
- technical leads
- development agents

### Key property

This is **internal product-definition truth**.

It is not yet the external documentation surface, but it is more durable than project memory.

It should contain validated, verified, invariant product truth, not merely product-themed plans or requirements drafts.

It is still a best-effort description of product truth; shipped behavior can reveal that the docs need revision.

### What it is not

It is not mainly about process.

It is not the same thing as external product docs.

It is not the home for PRDs or other project framing docs merely because they discuss product behavior.

## 6. External product docs

This is documentation for the running product and its supported interfaces.

This includes both human users and agent users of the product.

### Purpose

These docs answer:

- how to use the product
- how to integrate with the product
- how to operate supported interfaces
- what the shipped system currently guarantees

### Typical contents

- user docs
- API docs
- SDK docs
- CLI docs
- operator/admin docs
- hosting docs for supported product surfaces
- integration docs

### Audience

- human users
- operators
- integrators
- partner teams
- support
- agent users of the running product

### Key property

This is **external product truth**.

### What it is not

It is not the place for internal process rules, internal project memory, or internal-only architecture/product-definition debates.

## Important distinctions

## Internal product docs vs internal system docs

This is the most important distinction after project/process.

- internal product docs describe intended behavior from the product/user/use-case viewpoint
- internal system docs describe intended structure and behavior from the system/architecture viewpoint

Examples:

- use-case coverage -> internal product docs
- architecture overview -> internal system docs
- acceptance criteria -> internal product docs
- ADR -> internal system docs

BDD/spec artifacts can belong to either class depending on viewpoint:

- user/business behavior -> internal product docs
- system/component/invariant behavior -> internal system docs

## Internal process docs vs internal product/system docs

- internal process docs describe how work should be done
- internal product docs describe what product should exist
- internal system docs describe what system should exist

The process may define how to write or maintain product/system docs, but it does not replace them.

In all three cases, the topic alone is insufficient.

The content must be distilled into validated, verified, invariant truth before it leaves internal project docs.

## External product docs include agent users

We do not need a separate top-level class for external agent docs if the agent is simply a user of the running product.

If an agent is using the shipped API, SDK, CLI, or UI like any other user/integrator, it should rely on external product docs.

## Evolution within an increment

An increment can evolve:

- internal project docs
- internal process docs
- internal system docs
- internal product docs
- external product docs

Internal agent docs may also need updates, but only as a consequence of changes in the canonical internal docs they adapt.

The end of an increment is a particularly important distillation boundary.

Most artifacts produced during an increment may still remain in internal project docs.

Only the residue that has become stable, reusable, and invariant should be promoted into `process`, `system`, or `product`.

## Increment closeout questions

At the end of each increment, ask:

1. What should be closed, archived, or retained in internal project docs?
2. What did we learn about how work should be done next time that is now validated enough to count as process truth?
3. What is now true about the system definition that is validated, verified, and invariant enough to become canonical?
4. What is now true about the product definition that is validated, verified, and invariant enough to become canonical?
5. What changed in the shipped product that external users, operators, integrators, or agent users now need to know?
6. Do any internal agent docs need to change because the canonical internal docs changed?

## Current implications for `application`

The current repo appears to have the beginnings of all six classes, but several are mixed:

- `application/.claude/*` and parts of `application/.agents/*` look like internal agent docs
- `application/docs/design/*` looks like internal project docs
- `application/AGENTS.md`, parts of `application/.agents/docs/*`, and `application/docs/packs/*` look like internal process docs
- parts of `application/docs/designs/*` look like internal system docs
- parts of `application/docs/designs/*` may also look like internal product docs
- `application/docs/docs/*` plus product-facing documentation surfaces look like external product docs

## Next step

The next useful artifact is not an immediate move plan.

It is a future-extraction matrix that asks:

- which project folders may later yield durable residue
- what kind of invariant truth that residue might become
- what must be validated before any extraction happens
