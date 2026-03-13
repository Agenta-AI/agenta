# Decomposition Proposal Beyond Initial Sessions

## Why this exists

This proposal applies the current six-class taxonomy:

1. internal agent docs
2. internal project docs
3. internal process docs
4. internal system docs
5. internal product docs
6. external product docs

The main correction compared with earlier drafts is:

- internal product docs and internal system docs are separate
- internal process docs are separate from both
- external product docs include both human users and agent users of the running product
- internal agent docs are real, but they should stay thin and derivative

Another important correction:

- `process`, `system`, and `product` are canonical homes for validated, verified, invariant truth
- they are not topic buckets for anything process-related, technical, or product-related
- even when canonical, these docs are still best-effort documentation of that truth rather than a perfect substitute for code or real execution

## Current signals in `application`

### 1. Internal project docs are now consolidated

The former contents of:

- `docs/design/*`
- `docs/designs/*`

have been merged into:

- `docs/sdlc/projects/*`

### 2. External product docs already exist

Product-facing documentation already has a clear home in:

- `docs/docs/*`
- `docs/blog/*`
- `docs/src/*`
- `docs/static/*`

### 3. Internal agent docs already exist

Current likely internal-agent surfaces:

- `CLAUDE.md`
- `.claude/*`
- parts of `.agents/*`

These should remain thin wrappers over canonical internal docs.

### 4. Internal process docs exist, but are mixed

Current likely process surfaces:

- `AGENTS.md`
- parts of `.agents/docs/*`
- `docs/packs/*`

These contain rules, guidance, and runbooks that humans and agents should both follow.

### 5. Internal system docs and internal product docs are still blurred together inside projects

The merged `docs/sdlc/projects/*` content still contains material that may later yield at least two durable classes:

- internal system docs
- internal product docs

That future split is currently implicit.

It should not be forced prematurely.

## Main organizational problem

The repo already contains most of the necessary material, but it does not yet clearly separate:

- effort-specific working memory
- process truth
- system-definition truth
- product-definition truth
- external product truth
- internal agent wrappers

That ambiguity will grow as work moves beyond initial sessions.

## Proposed decomposition

## A. Internal agent docs

Recommended target shape:

```text
.agents/
.claude/
AGENTS.md
CLAUDE.md
```

Rules:

- platform-specific
- thin
- derivative of canonical internal docs
- never the only home of important rules or definitions

## B. Internal project docs

Recommended target shape:

```text
docs/sdlc/projects/
  <initiative>/
    README.md
    intent.md
    research/
    decision/
    delivery/
    verification/
    rollout/
```

Current state:

- `docs/sdlc/projects/` = internal project docs
- `docs/plans/` = still a candidate to retire or fold into internal project docs

Important rule:

- PRDs, RFCs, QA plans, draft specs, migration notes, and design notes stay here while they are still effort-scoped or provisional

## C. Internal process docs

Recommended target shape:

```text
docs/sdlc/process/
  README.md
  lifecycle.md
  review.md
  testing.md
  release.md
  templates/
  rubrics/
  packs/
```

This is the canonical home for:

- process and lifecycle rules
- review/testing/release guidance
- templates and rubrics
- local development runbooks

Only material that has become validated, reusable, and invariant across efforts should move here.

## D. Internal system docs

Recommended target shape:

```text
docs/sdlc/system/
  README.md
  architecture/
  adrs/
  models/
  boundaries/
  behaviors/
```

This is the canonical home for:

- architecture overviews
- ADRs
- domain models
- invariants
- internal boundaries
- system-level technical behavior definitions

Only material that has become validated, verified, and invariant at the system level should move here.

## E. Internal product docs

Recommended target shape:

```text
docs/sdlc/product/
  README.md
  requirements/
  use-cases/
  journeys/
  acceptance/
  capabilities/
  ux/
```

This is the canonical home for:

- requirements
- use cases
- user journeys
- acceptance criteria
- product behavior definitions
- UX intent

Only material that has become validated, verified, and invariant at the product-definition level should move here.

## F. External product docs

Recommended target shape:

```text
docs/
  docs/
  blog/
  src/
  static/
```

This is the canonical home for:

- user docs
- operator docs
- API docs
- SDK docs
- CLI docs
- integration docs

This includes docs for human users and agent users of the running product.

## Important boundary rules

## Canonical docs are best-effort

Even after distillation, canonical docs remain best-effort descriptions of stable truth.

- system docs must be reconciled against the codebase and actual behavior
- product docs must be reconciled against shipped behavior
- process docs must be reconciled against how work is actually being carried out

So the goal is not "perfect truth in docs".

The goal is the best current, intentionally maintained documentation of invariant truth.

## Internal agent docs vs everything else

If humans are expected to treat a document as canonical, it should not live only in an internal-agent surface.

## Internal process docs vs internal product/system docs

- process docs say how work should be done
- product docs say what product should exist
- system docs say what system should exist

But topic alone is not enough for extraction.

The content must first become canonical truth rather than project memory.

## Internal product docs vs internal system docs

- product docs use the product/use-case/acceptance viewpoint
- system docs use the architecture/system/invariant viewpoint

BDD/spec material can belong to either, depending on viewpoint.

## Evolution within an increment

An increment can update:

- internal project docs
- internal process docs
- internal system docs
- internal product docs
- external product docs

Internal agent docs should update only when their source docs change.

## Increment closeout rule

At the end of each increment, explicitly ask:

1. What should be closed or retained in internal project docs?
2. What became stable enough to count as internal process truth?
3. What became stable enough to count as internal system truth?
4. What became stable enough to count as internal product truth?
5. What changed in external product docs?
6. Do internal agent docs need to adapt to any of the above?

## Migration plan

### Phase 1: Clarify ownership without large moves

- declare the six classes explicitly
- keep `docs/sdlc/projects/` as the internal-project-docs pool
- keep `docs/docs/*` as external product docs
- identify mixed areas in `docs/sdlc/projects/*`, `AGENTS.md`, `.agents/docs/*`, and `docs/packs/*`

### Phase 2: Add templates

- internal project template
- internal process templates
- internal system templates
- internal product templates
- internal agent wrapper conventions

### Phase 3: Split mixed durable docs

- separate process material from product/system definition material
- keep internal agent docs thin
- ensure external product docs only contain shipped/supportable product truth

## Recommended next step

Build a mapping matrix with these columns:

- current folder
- primary class
- secondary class if mixed
- intended audience
- keep/move/split
- notes
