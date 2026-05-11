# Process Organization Working Note

## Why this note exists

This note consolidates the current process-thinking scattered across:

- `.memory/Agentic Engineering Loops.md`
- `.memory/Testing Layered Architectures.md`
- `.memory/Organizing Skills and Tools.md`
- `docs/sdlc/projects/agentic-engineering/*.md`

The immediate goal is not to declare canonical process truth.

The goal is to make the emerging process model explicit enough to:

- organize the discussion
- identify the likely documentation seams
- surface the decisions that are still missing

## Boundary

This file is an **internal project doc** for the `agentic-engineering` effort.

It should remain in `docs/sdlc/projects/agentic-engineering/` until the relevant parts have been validated and distilled into stable, reusable process truth.

In other words:

- this is working memory
- it is not yet a canonical `docs/sdlc/process/*` document

## What currently looks stable

### 1. Engineering should be modeled as a graph of loops

The current notes point toward a graph of interacting loops rather than a single linear pipeline.

The major loops currently implied are:

- intent / product clarification
- design
- implementation
- review
- testing / validation
- release / operations

Research and security behave more like cross-cutting loops that can feed back into several of the above.

### 2. Loops should exchange artifacts, not hidden chat context

Each loop appears to need:

- an actor
- a critic
- a state artifact
- an exit condition

The important implication is that loops should hand off through explicit artifacts rather than through implicit conversational state.

### 3. Each work slice runs a local V-loop

The memory notes consistently converge on an artifact-based V-model:

- product requirements
- system specifications
- module specifications
- component specifications
- implementation

Each layer has both:

- a verification critic reviewing structure against the artifact
- a validation critic testing behavior against the artifact

### 4. Slice completion is not enough

A work slice should not only merge code.

It should also update the relevant durable knowledge when the slice changes something that is meant to remain true:

- product knowledge
- system knowledge
- process knowledge
- operational knowledge

Without this merge-back step, the code evolves faster than the knowledge model.

### 5. Agent docs are an operating surface, not the canonical truth layer

The current project docs already establish a useful separation:

- `.agents/` = shared internal-agent operating layer
- `AGENTS.md` and `CLAUDE.md` = thin entrypoint wrappers
- `docs/sdlc/projects/*` = mutable project memory
- `docs/sdlc/process|system|product/*` = best-effort canonical truth after validation

That separation should remain intact while the process model is being defined.

### 6. `initial.specs` already behaves like a real early-phase artifact

Sampled `docs/sdlc/projects/*/*.initial.specs.md` files are not lightweight placeholders.

They usually capture a fairly rich early artifact, often including:

- overview and scope
- explicit constraints
- architecture or boundary framing
- algorithm or data-flow detail
- testing strategy
- concrete implementation direction

That suggests the process discussion should treat `initial.specs` as an actual stage artifact in the work-slice loop rather than as incidental prose.

## Proposed organization of the process

### A. Work-slice loop

This is the local loop for a feature, bug fix, migration, or other bounded change.

Suggested flow:

1. intent refinement
2. design refinement
3. implementation
4. review and validation
5. rollout or handoff

Suggested artifacts by stage:

- intent refinement
  - goal
  - non-goals
  - constraints
  - acceptance criteria
  - open questions
- design refinement
  - design notes
  - specification deltas
  - ADR delta when needed
  - risk notes
- implementation
  - code diff
  - migrations
  - local evidence
- review and validation
  - review findings
  - test results
  - unresolved risks
- rollout or handoff
  - rollout notes
  - runbook delta
  - post-change verification

### B. Knowledge-integration loop

Every work slice should also answer:

What durable truth changed?

That creates a second loop after local delivery:

1. classify the residue of the slice
2. decide whether it remains project memory or becomes candidate canonical truth
3. update the appropriate durable knowledge surface

The current classification should remain:

- still effort-scoped or draft -> stays in `projects`
- stable process truth -> candidate for `process`
- stable system truth -> candidate for `system`
- stable product truth -> candidate for `product`

This is the point where the earlier taxonomy and the loop model actually connect.

### C. Agent-operating loop

The process model also needs an explicit operating layer for humans and agents.

Current shape that seems directionally correct:

- policies define always-on rules and guardrails
- skills define reusable procedures
- agents and sub-agents define role-bearing actors
- tools define capability surfaces
- approvals and hooks define deterministic enforcement

This layer should adapt to the process model, not compete with it.

There is also a cross-cutting space of activities that may later become skills, agents, or agent bundles beyond the basic design/implementation actor and verification/validation critic roles. See `activities_skills_agents.md`.

## Minimal artifact set worth testing

If the process is going to be lightweight enough to use, the artifact set probably needs to stay small.

A plausible minimum set is:

- `intent.md`
- `questions.md`
- `acceptance.md`
- `design.md` or ADR delta
- `plan.md`
- `evidence.md`
- `findings.md`
- `rollout.md`
- `knowledge-delta.md`

Not every change would need the same depth, but this list is a useful starting envelope for the conversation.

## Human gates that already appear necessary

The notes imply that humans are not removed from the system; they are concentrated at authority and risk boundaries.

The clearest recurring gates are:

- goal and priority definition
- ambiguity resolution
- architecture approval for high-impact design changes
- security review for sensitive surfaces
- production release approval
- conflict resolution when critics do not converge

This suggests that humans are part of the graph as explicit gate nodes, not informal background participants.

## Questions that need decisions

The current material is strong on concepts, but several operational decisions are still missing.

### 1. What is the canonical unit of work?

Is the local V-loop centered on:

- a feature
- a ticket
- a pull request
- a deployment slice
- some other unit

The answer affects folder structure, artifact scope, and handoff rules.

### 2. Which artifacts are mandatory for every slice?

The current model names many useful artifacts, but it does not yet separate:

- always-required artifacts
- risk-triggered artifacts
- optional supporting artifacts

### 3. What is the exact boundary between product and system artifacts?

This remains especially blurry for:

- API behavior
- UX-backed API workflows
- acceptance criteria that imply system constraints

The taxonomy is clear in principle, but the operational classification rule still needs to be made sharper.

### 4. When does a project artifact graduate into canonical truth?

The current docs say "validated, verified, invariant truth," but the actual extraction gate still needs to be operationalized.

For example:

- who decides
- what evidence is required
- whether code, tests, rollout, and observed usage must all exist first

### 5. How should review and testing relate?

Possible shapes include:

- review before testing
- testing before review
- parallel peer loops against the same artifact

The current notes support the idea of distinct critics, but not yet the required orchestration.

### 6. What is the minimum evidence needed to exit a loop?

The process needs a practical answer for evidence such as:

- commands run
- outputs observed
- screenshots or logs
- coverage or scenario traceability
- production verification notes

### 7. Which human gates are mandatory, and who owns them?

The notes identify gate categories, but not yet:

- the owners
- the thresholds
- the required sign-off artifacts

### 8. How should agent wrappers consume canonical docs without duplicating them?

The structural direction is clear, but the operating pattern still needs to be nailed down:

- what lives in `.agents/`
- what only points outward
- what can be copied locally for usability
- what should never be duplicated

### 9. What autonomy and permission model belongs to each actor?

The notes imply capability buckets such as:

- read-only repo access
- write access
- execution access
- runtime sandbox access
- web access
- deployment access

But the actor-to-capability mapping is still not defined.

### 10. What folder and file conventions should a slice actually use?

The process model will stay abstract until it has a concrete project-memory layout that engineers and agents can both follow with low friction.

### 11. What should an `initial.specs` document be required to contain?

The current repo examples suggest that `initial.specs` often mixes:

- requirements
- system constraints
- design intent
- implementation detail
- testing expectations

That may be acceptable, but the process should decide whether `initial.specs` is meant to be:

- a single composite early artifact
- a temporary umbrella that later splits into clearer artifacts
- or a document with a more constrained required schema

## Candidate next documents

If this project continues, the next project-scoped notes that seem most useful are:

- `process_graph.md`
- `artifact_templates.md`
- `gate_and_escalation_matrix.md`
- `knowledge_integration_rules.md`

Those would make the current conceptual model much easier to execute and critique.

## Bottom line

The current material already suggests a coherent shape:

- engineering as nested loops
- artifacts as the edges
- local V-loops per work slice
- a separate knowledge-integration loop
- explicit human gate nodes
- agent wrappers as a projection layer rather than a truth layer

What is still missing is not more theory.

What is missing is the operational definition of:

- required artifacts
- extraction rules
- gate ownership
- evidence thresholds
- a concrete working folder shape
