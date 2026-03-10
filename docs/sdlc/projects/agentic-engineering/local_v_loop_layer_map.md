# Local V-Loop Layer Map

## Why this note exists

This note decomposes a single local V-loop into the same directional fields at each layer.

The purpose is to make the artifact flow explicit before we finalize naming.

## Boundary

This is still a project-working note for `agentic-engineering`.

It is not yet a canonical process document.

## Direction conventions

For each layer:

- `left inbound` = what enters the construction side from the next more abstract layer above
- `left outbound` = what the worker sends downward to the next more concrete layer below
- `right inbound` = what arrives from the next more concrete critique layer below
- `right outbound` = what the critique side sends upward to the next more abstract critique layer above
- `left -> right` = what the worker submits to the reviewer critic and tester critic at the same layer
- `right -> left` = what the reviewer critic and tester critic send back to the worker at the same layer

Role conventions:

- role types = actor and critic
- left side role = worker, which is the actor
- right side roles = reviewer and tester, which are the two critics

These arrows do not have to be read as literal file transport.

They can also be read as:

- signaling
- readiness conditions
- responsibility handoff
- state-transition expectations over shared project knowledge

General convention:

- inbound and outbound fields focus on project-specific active state in the slice
- every layer always has ambient access to the knowledge plane

For now, the layer names are:

1. product
2. system
3. slice/module layer (name pending)
4. inner component layer (name pending)
5. implementation

## Cross-cutting depth planes

The local V-loop is not only a left/right artifact structure.

It also has depth.

The current best split is:

- back planes
- role plane

The split is still provisional.

### Back planes

These are the supporting planes behind the local V-loop.

They feed each layer and can also be improved by each layer.

### 1. Knowledge plane

This is the context and truth surface that each worker and critic consumes.

The project slice can be understood as living largely in the project stratum of this plane.

Each layer reads from and writes to that project knowledge.

The V-flow then indicates how work is activated, handed off, critiqued, and advanced.

### Knowledge strata

To keep the distinction clear, the knowledge plane currently appears to have at least these strata:

- agent-specific memory
- project memory and project state
- canonical internal process knowledge
- canonical internal system knowledge
- canonical internal product knowledge
- external documentation and references

Examples:

- agent-specific memory
- project memory from the slice
- rules
- policies
- prior decisions
- design notes
- specs
- canonical process, system, and product truth
- examples and scenarios
- prior findings
- prior evidence

Directional reading:

- knowledge -> layer = the layer reads background knowledge, project state, retained memory, rules, and prior truth
- layer -> knowledge = the layer writes updated project state, findings, distilled truth, or reusable knowledge back

### 2. Capability plane

This is the actionable surface each role can use to perform work.

Capabilities are not the same thing as raw resources.

They are the usable methods, tools, and procedures available at a layer.

Examples:

- tools
- search and read surfaces
- write surfaces
- test runners
- runtime access methods
- observability access methods
- web research
- skills
- reusable procedures
- permissioned integrations

Directional reading:

- capabilities -> layer = what the roles are able to do
- layer -> capabilities = clarified missing capabilities, improved skills, and improved procedures discovered through execution

### 3. Resource plane

This is the substrate that capabilities depend on.

Examples:

- compute
- runtime environments
- sandboxes
- CI workers
- credentials or scoped tokens
- datasets
- logs and telemetry stores
- budgeted execution time
- network reachability

Directional reading:

- resources -> layer = available execution substrate and constraints
- layer -> resources = resource consumption, produced artifacts, generated logs, and observed runtime state

### Role plane

This is the operating layer of who acts at each layer of the V.

At each layer we currently have:

- one worker on the left
- one reviewer critic on the right
- one tester critic on the right

Skills are no longer modeled as a separate plane here.

They fit better under the capability plane because they are reusable ways of acting, not the actors themselves.

So the role plane answers "which actor and critics are responsible at this layer."

The capability plane answers "what that role can do."

## Relationship between the back planes

The intended dependency is:

knowledge informs capabilities
capabilities operate over resources
execution against resources produces evidence
evidence feeds knowledge

In shorthand:

knowledge -> capabilities -> resources -> evidence -> knowledge

## Project knowledge vs V-flow

The project-specific information of the slice can be modeled as persisted in the project stratum of the knowledge plane.

Each layer reads from and writes to that project state.

The V-flow should therefore be read less as "where the data physically lives" and more as:

- left inbound
- left outbound
- left -> right
- right -> left
- right inbound
- right outbound

These directions mainly describe:

- which state becomes active
- who is expected to act next
- which critique is expected next
- what kind of state transition is being requested
- when a lower or upper layer should be triggered

So the clean reading is:

- project knowledge holds the slice state
- the V arrows describe signaling, handoff, critique, and progression over that state

## 1. Product layer

### Worker

Product shaper, product designer, or requirements author.

### Left inbound (initial)

#### 1. Framing

##### context

The surrounding situation that explains why this work exists now.

This includes the business, product, operational, technical, or market background that gives meaning to the effort.

##### problem statement

A concise articulation of the problem to be solved.

It should make clear what is wrong or missing today, for whom, and why it matters.

##### goals and objectives

The intended outcomes of the work.

Goals express the direction and purpose; objectives make that direction more concrete and actionable.

#### 2. People

##### stakeholders

The people or groups who are affected by, influence, sponsor, approve, build, operate, or depend on the outcome.

This may include end users, business owners, product, design, engineering, support, security, legal, operations, or external partners.

##### target users

The primary user groups the product or feature is meant to serve.

These are the people whose needs, problems, behaviors, and outcomes most directly shape the definition.

#### 3. Value

##### jobs to be done

The underlying goals users are trying to achieve.

This expresses the progress users want to make, independently of any particular interface or solution.

##### pains and gains

The negative conditions users experience today and the positive outcomes they seek.

Pains capture friction, risk, delay, confusion, cost, or failure; gains capture improvement, relief, speed, confidence, quality, or success.

#### 4. Evidence

##### research

The source material used to ground the work in reality rather than opinion alone.

This may include interviews, analytics, experiments, support data, market research, competitive analysis, technical investigation, or prior delivery learnings.

##### insights

The conclusions drawn from the research that materially influence the product definition.

Insights are not raw findings; they are the distilled implications that affect choices, priorities, and trade-offs.

#### 5. Unknowns

##### assumptions

Statements currently treated as true for the purpose of progressing the work, but not yet fully validated.

Assumptions should be explicit, reviewable, and ideally testable.

##### open questions

Important unresolved points that may affect definition, scope, validation, prioritization, or delivery.

These are not hidden uncertainties; they are known unknowns that need resolution or tracking.

#### 6. Boundaries

##### constraints

The conditions, limits, or obligations that shape what can be designed or delivered.

These may be technical, legal, compliance-related, operational, organizational, budgetary, timing-related, or platform-related.

##### dependencies

External elements that this work relies on or is blocked by.

These may include teams, systems, vendors, APIs, data sources, infrastructure, approvals, or parallel initiatives.

##### risks

Potential events or conditions that could reduce value, delay delivery, introduce failure, increase cost, or create harm.

Risks should be identified early so they can shape decisions rather than surprise execution later.

#### 7. Focus

##### in scope

What is intentionally included in the current effort.

This clarifies the intended area of action and helps avoid ambiguity around what the team is expected to define and deliver.

##### out of scope

What is intentionally excluded from the current effort.

This protects clarity, avoids accidental expansion, and makes trade-offs explicit.

### Left outbound (refined)

#### 8. Definition

##### use cases

Goal-oriented interactions between an actor and the system.

Use cases bridge user value and system definition by describing what a user or actor is trying to accomplish through the product in a structured way.

###### role

Use cases translate user intent into concrete product behavior.

They are more specific than jobs to be done, but still more product-facing than low-level system behavior.

##### user flows

The intended sequence of steps, decisions, states, and branches through which a user progresses toward an outcome.

User flows clarify the interaction structure when order, transitions, branching, or navigation matter.

###### role

User flows make interaction logic explicit.

They help define how a use case unfolds in practice and help reveal missing states, broken transitions, and UX ambiguities.

##### product requirements

The statements that define what the product must do or must be.

These are the core contractual outputs of the definition layer and should be precise enough to support design, engineering, and review.

###### role

Product requirements translate the framed problem and the defined use cases into a buildable specification.

They may be functional, non-functional, behavioral, policy-related, operational, security-related, or otherwise cross-cutting.

#### 9. Verification and validation

##### acceptance criteria

The conditions that must be satisfied for a product requirement to be accepted as met.

Acceptance criteria define what must be true, observable, or demonstrable.

###### role

Acceptance criteria operationalize requirements for review, delivery, and testing.

They provide the immediate bridge from specification to verifiable correctness.

##### test scenarios

Structured cases used to exercise behavior and verify expected outcomes.

These may include happy paths, grumpy paths, typical cases, edge cases, boundary cases, exceptional cases, or failure cases.

###### role

Test scenarios instantiate concrete situations against which requirements, flows, and acceptance criteria can be exercised.

They make verification real and prevent the definition from remaining purely abstract.

##### metrics and indicators

The measures used to observe outcome, quality, performance, health, or success in practice.

They may be quantitative or qualitative, leading or lagging, user-facing, business-facing, technical, or operational.

###### role

Metrics and indicators do not replace acceptance criteria.

Acceptance criteria verify that the requirement is met; metrics and indicators help assess whether the resulting behavior performs or succeeds in reality.

### Traceability within Definition

Every use case should trace to:

- zero or more user flows, when interaction structure matters
- one or more product requirements

#### rationale

A use case should not remain only as a high-level intention.

When interaction structure matters, it should be expressed through one or more user flows; and in all cases it should lead to one or more product requirements so that it becomes buildable and actionable.

Every user flow should trace to:

- one or more use cases
- zero or more product requirements, when relevant

#### rationale

A user flow should represent some meaningful user goal, not an arbitrary sequence of screens or states.

It should usually connect back to one or more use cases, and may also connect directly to product requirements where a specific interaction structure is required by the definition.

Every product requirement should trace to:

- one or more use cases, unless it is cross-cutting
- zero or more user flows, when interaction structure matters

#### rationale

Requirements should normally be justified by one or more use cases.

This prevents orphan requirements with no user or actor rationale.

The exception is cross-cutting requirements, which may apply broadly across many use cases or across the product as a whole.

Where the requirement depends on sequence, branching, navigation, or state transitions, it should also trace to relevant user flows.

### Traceability from Definition to Verification and validation

Every product requirement should trace to:

- one or more acceptance criteria

#### rationale

A requirement without acceptance criteria is not yet adequately verifiable.

Acceptance criteria are the immediate verification layer that turns a defined requirement into something testable and reviewable.

Every use case, user flow, or product requirement should trace to:

- one or more test scenarios, when behavioral validation is needed
- zero or more metrics and indicators, when outcome measurement is relevant

#### rationale

Behavioral elements of the definition should be exercisable through test scenarios wherever verification depends on observed behavior.

This includes use cases, user flows, and product requirements.

Where success, health, performance, or impact needs to be observed beyond simple acceptance, they should also trace to relevant metrics and indicators.

### Practical reading of the whole structure

#### inputs (initial)

Sections 1 to 7 collect and organize the upstream material used to understand and frame the work.

They are expected to evolve as the team learns more.

#### outputs (refined)

Sections 8 and 9 transform that upstream material into artifacts that can support design, engineering, testing, review, and measurement.

They are the refined contract produced from the initial context.

#### traceability

Traceability ensures that the refined outputs remain connected to their purpose, justification, and means of verification.

It is what prevents:

- use cases with no requirements
- requirements with no acceptance criteria
- flows with no user rationale
- scenarios with no definitional anchor
- metrics with no meaningful purpose

### Right inbound

- acceptance execution evidence from the running system
- demo or staged behavior evidence
- escalated system-level mismatches that affect requirement truth

### Right outbound

- product acceptance decision
- accepted or rejected scenarios
- unresolved requirement gaps
- escalation to delivery or release decision makers

### Left -> Right

- refined definition package
- verification and validation package
- traceability links
- unresolved open questions

### Right -> Left

- ambiguity findings
- missing scenario findings
- acceptance failures
- requests to tighten or change requirements

### Reviewer critic

Product reviewer checking clarity, consistency, and completeness.

### Tester critic

Acceptance tester validating behavior against product requirements.

### Notes

This is the topmost construction layer in the local V.

Its left inbound usually comes from outside the engineering loop proper, and its right outbound usually feeds human decision or release gates rather than another engineering layer.

## 2. System layer

### Worker

System designer or architect.

### Left inbound

- product requirements
- acceptance criteria
- product constraints
- non-functional expectations

### Left outbound

- system specifications
- public interface contracts
- architecture decisions
- boundary definitions
- runtime and observability requirements
- risk notes

### Right inbound

- assembled-system behavior evidence
- lower-layer mismatch reports that have system-level impact
- system test execution evidence

### Right outbound

- architecture review verdict
- system validation status
- unresolved systemic risks
- escalations that affect product-level commitments

### Left -> Right

- system specification package
- interface contracts
- ADR delta
- architecture diagrams or boundary notes
- threat or risk notes

### Right -> Left

- architecture findings
- system test failures
- public-contract mismatches
- missing runtime or observability requirements

### Reviewer critic

Architecture reviewer.

### Tester critic

System tester validating the running assembled system through its public boundaries.

## 3. Slice or module layer (name pending)

### Worker

Slice designer, domain designer, or boundary owner.

### Left inbound

- system specification slice relevant to the change
- interface contracts
- system constraints
- use-case allocations for this part of the system

### Left outbound

- slice specification
- port and adapter boundaries
- dependency rules
- collaboration flow
- contract examples
- data ownership notes

### Right inbound

- component-level behavior evidence
- boundary failures discovered during integration or contract testing
- lower-layer assumptions that proved invalid

### Right outbound

- integration or contract test results
- slice design review verdict
- unresolved boundary issues escalated upward

### Left -> Right

- slice spec package
- contract examples
- dependency assumptions
- fixture and test-shape expectations

### Right -> Left

- integration failures
- contract mismatches
- dependency-boundary findings
- missing or invalid edge cases

### Reviewer critic

Slice or module reviewer checking boundary design, responsibility split, and dependency direction.

### Tester critic

Integration or contract tester validating the slice boundary with real collaborators or real boundary behavior.

### Notes

This is the layer currently called `module` in earlier notes.

The name is still open because we may want a term that better emphasizes vertical slices and bounded responsibility.

## 4. Inner component layer (name pending)

### Worker

Component designer or detailed design owner.

### Left inbound

- slice specification
- boundary assumptions
- dependency rules
- collaboration expectations

### Left outbound

- component specification
- interfaces and responsibility split
- invariants
- algorithm or orchestration notes
- wiring assumptions
- implementation task split

### Right inbound

- implementation behavior evidence
- unit-level failures that reveal component-spec problems
- review findings that indicate the component boundary is wrong

### Right outbound

- component review verdict
- component test results
- unresolved design problems escalated to the slice layer

### Left -> Right

- component spec package
- example inputs and outputs
- invariants
- dependency-injection assumptions

### Right -> Left

- interface design findings
- component test failures
- refactor requests
- signs that the component split is wrong

### Reviewer critic

Component reviewer checking interface quality, cohesion, and responsibility separation.

### Tester critic

Component tester validating the component against its specification, often with doubles or controlled collaborators.

### Notes

This is the layer currently called `component` in earlier notes.

The name is also still open because it may collide with broader usage of "component" elsewhere in the system.

## 5. Implementation layer

### Worker

Implementer.

### Left inbound

- component specification
- implementation tasks
- examples
- invariants
- constraints

### Left outbound

- none downward

### Right inbound

- none from a lower layer

### Right outbound

- none as a separate vertical artifact in this model

### Left -> Right

- code diff
- local execution evidence
- unit-test runs
- static-analysis outputs
- notes on edge cases or technical constraints discovered during coding

### Right -> Left

- code review findings
- failing unit tests
- defect reports
- required refactors
- requests for clarification when the spec does not survive implementation

### Reviewer critic

Code reviewer.

### Tester critic

Unit tester or unit-test automation.

### Notes

Implementation is the terminal point on the construction side.

In this framing, it does not produce another left-side artifact below itself.

Its meaningful movement is horizontal:

- implementation work goes from left to right for critique
- findings and failures return from right to left for revision

The upward movement starts when stable implementation evidence is interpreted by the layer above as critique-side input.

## Cross-layer reading

A useful way to read the model is:

- left side carries increasingly concrete construction artifacts downward
- right side carries increasingly abstract critique and validation outcomes upward
- horizontal movement is where each layer actually converges

So for a normal slice:

1. the worker receives an inbound artifact from above
2. the worker produces a more concrete artifact below
3. that artifact is also submitted horizontally for same-layer review and testing
4. findings come back horizontally for revision
5. stabilized evidence contributes upward on the critique side

Implementation is the special case because it has no deeper construction layer beneath it.

## Depth-plane overlays by layer

The sections above describe the artifact flow.

The sections below describe what each layer consumes from the depth planes and what it contributes back.

## Product layer overlays

### Knowledge plane

Knowledge into the layer:

- business context
- user research
- prior product truth
- previous acceptance scenarios
- project state relevant to the product layer
- external reference material

Knowledge back out of the layer:

- retained product-level questions
- scenario taxonomy worth reusing
- clarified product terminology
- product-level project-state updates
- candidate product truth to distill later

### Capability plane

Likely capabilities:

- issue or project tracker
- docs navigation
- note-taking
- research or web access
- scenario-writing skills
- acceptance-review skills
- lightweight prototype or demo access

### Resource plane

Likely resources:

- product docs corpus
- ticketing/project system
- prototype environment
- demo environment

### Role plane

Typical roles:

- worker = product shaper
- reviewer critic = product reviewer
- tester critic = acceptance tester

## System layer overlays

### Knowledge plane

Knowledge into the layer:

- previous ADRs
- system maps and boundary docs
- operational constraints
- previous incidents and risks
- project state relevant to the system layer
- external technical references

Knowledge back out of the layer:

- candidate system invariants
- architecture learnings
- new architecture risks
- observability learnings
- system-level project-state updates

### Capability plane

Likely capabilities:

- repo-wide code reading
- architecture review skills
- interface inspection
- API or schema inspection
- threat-modeling procedures
- system-test execution
- observability querying

### Resource plane

Likely resources:

- codebase
- architecture diagrams
- schema stores
- test environments
- staging runtime
- telemetry systems

### Role plane

Typical roles:

- worker = system designer
- reviewer critic = architecture reviewer
- tester critic = system tester

## Slice or module layer overlays

### Knowledge plane

Knowledge into the layer:

- domain model
- reusable interface patterns
- prior boundary findings
- dependency rules
- project state relevant to slice boundaries

Knowledge back out of the layer:

- reusable boundary clarifications
- contract examples worth retaining
- fixture expectations worth retaining
- integration findings
- slice-level project-state updates

### Capability plane

Likely capabilities:

- code navigation and search
- contract review
- integration-test execution
- dependency inspection
- fixture design
- boundary-debugging procedures

### Resource plane

Likely resources:

- source code
- contract definitions
- dependency sandboxes or stubs
- integration environments
- logs from boundary interactions

### Role plane

Typical roles:

- worker = slice designer
- reviewer critic = slice reviewer
- tester critic = integration or contract tester

## Inner component layer overlays

### Knowledge plane

Knowledge into the layer:

- component patterns
- implementation conventions
- prior component findings
- reusable testing seams
- project state relevant to inner design

Knowledge back out of the layer:

- interface patterns
- responsibility rules
- reusable testing seams
- clarified invariants
- inner-design project-state updates

### Capability plane

Likely capabilities:

- local code inspection
- static analysis
- use of mocks, fakes, and stubs
- component-test execution
- focused debugging
- interface review

### Resource plane

Likely resources:

- source code
- local test harnesses
- mock and fake libraries
- debugger runtime
- focused execution environments

### Role plane

Typical roles:

- worker = component designer
- reviewer critic = component reviewer
- tester critic = component tester

## Implementation layer overlays

### Knowledge plane

Knowledge into the layer:

- coding conventions
- edge-case examples
- previous findings
- local implementation constraints
- project state relevant to implementation

Knowledge back out of the layer:

- concrete edge cases discovered in coding
- extracted implementation constraints
- reusable code patterns
- failures that force spec refinement
- implementation-level project-state updates

### Capability plane

Likely capabilities:

- write access to the repo
- formatting
- linting
- unit-test execution
- local runtime use
- debugging
- CI log inspection

### Resource plane

Likely resources:

- writable repo
- local machine or sandbox
- CI workers
- test fixtures
- runtime services
- log outputs

### Role plane

Typical roles:

- worker = implementer
- reviewer critic = code reviewer
- tester critic = unit tester

## Naming decisions still open

The main unresolved naming questions exposed by this map are:

- what should replace `module`
- what should replace `component`
- whether both middle layers are needed in every slice
- whether some efforts collapse one of the middle layers entirely
