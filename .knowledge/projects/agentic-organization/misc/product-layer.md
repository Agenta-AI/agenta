# Product Layer

## Inputs (initial) and outputs (refined)

## 1. Framing

### context

The surrounding situation that explains why this work exists now.

This includes the business, product, operational, technical, or market background that gives meaning to the effort.

### problem statement

A concise articulation of the problem to be solved.

It should make clear what is wrong or missing today, for whom, and why it matters.

### goals and objectives

The intended outcomes of the work.

Goals express the direction and purpose; objectives make that direction more concrete and actionable.

## 2. People

### stakeholders

The people or groups who are affected by, influence, sponsor, approve, build, operate, or depend on the outcome.

This may include end users, business owners, product, design, engineering, support, security, legal, operations, or external partners.

### target users

The primary user groups the product or feature is meant to serve.

These are the people whose needs, problems, behaviors, and outcomes most directly shape the definition.

## 3. Value

### jobs to be done

The underlying goals users are trying to achieve.

This expresses the progress users want to make, independently of any particular interface or solution.

### pains and gains

The negative conditions users experience today and the positive outcomes they seek.

Pains capture friction, risk, delay, confusion, cost, or failure; gains capture improvement, relief, speed, confidence, quality, or success.

## 4. Evidence

### research

The source material used to ground the work in reality rather than opinion alone.

This may include interviews, analytics, experiments, support data, market research, competitive analysis, technical investigation, or prior delivery learnings.

### insights

The conclusions drawn from the research that materially influence the product definition.

Insights are not raw findings; they are the distilled implications that affect choices, priorities, and trade-offs.

## 5. Unknowns

### assumptions

Statements currently treated as true for the purpose of progressing the work, but not yet fully validated.

Assumptions should be explicit, reviewable, and ideally testable.

### open questions

Important unresolved points that may affect definition, scope, validation, prioritization, or delivery.

These are not hidden uncertainties; they are known unknowns that need resolution or tracking.

## 6. Boundaries

### constraints

The conditions, limits, or obligations that shape what can be designed or delivered.

These may be technical, legal, compliance-related, operational, organizational, budgetary, timing-related, or platform-related.

### dependencies

External elements that this work relies on or is blocked by.

These may include teams, systems, vendors, APIs, data sources, infrastructure, approvals, or parallel initiatives.

### risks

Potential events or conditions that could reduce value, delay delivery, introduce failure, increase cost, or create harm.

Risks should be identified early so they can shape decisions rather than surprise execution later.

## 7. Focus

### in scope

What is intentionally included in the current effort.

This clarifies the intended area of action and helps avoid ambiguity around what the team is expected to define and deliver.

### out of scope

What is intentionally excluded from the current effort.

This protects clarity, avoids accidental expansion, and makes trade-offs explicit.

## 8. Definition

### product-facing interfaces

The product layer should explicitly identify the interfaces through which the product is consumed.

These interfaces may include:

- web UI
- API
- SDKs
- CLI
- external documentation
- observability or telemetry surfaces, when users consume metrics, logs, analytics, or status through the product
- and other user- or agent-facing product interfaces

#### role

These interfaces are part of the product definition.

They are the product-facing surfaces that the system layer will later refine into concrete system interfaces and contracts.

External documentation is special here:

- it is not only a product-facing interface
- it is also the external knowledge surface
- that is why docs belong both to interface thinking and to knowledge thinking

Jobs to be done, use cases, user flows, scenarios, acceptance criteria, and related product-definition elements should be defined to a meaningful extent in terms of the interaction points through these product-facing interfaces.

### use cases

Goal-oriented interactions between an actor and the system.

Use cases bridge user value and system definition by describing what a user or actor is trying to accomplish through the product in a structured way.

#### role

Use cases translate user intent into concrete product behavior.

They are more specific than jobs to be done, but still more product-facing than low-level system behavior.

### user flows

The intended sequence of steps, decisions, states, and branches through which a user progresses toward an outcome.

User flows clarify the interaction structure when order, transitions, branching, or navigation matter.

#### role

User flows make interaction logic explicit.

They help define how a use case unfolds in practice and help reveal missing states, broken transitions, and UX ambiguities.

### product requirements

The statements that define what the product must do or must be.

These are the core contractual outputs of the definition layer and should be precise enough to support design, engineering, and review.

#### role

Product requirements translate the framed problem and the defined use cases into a buildable specification.

They may be functional, non-functional, behavioral, policy-related, operational, security-related, or otherwise cross-cutting.

## 9. Verification and Validation

### acceptance criteria

The conditions that must be satisfied for a product requirement to be accepted as met.

Acceptance criteria define what must be true, observable, or demonstrable.

#### role

Acceptance criteria operationalize requirements for review, delivery, and testing.

They provide the immediate bridge from specification to verifiable correctness.

### test scenarios

Structured cases used to exercise behavior and verify expected outcomes.

These may include happy paths, grumpy paths, typical cases, edge cases, boundary cases, exceptional cases, or failure cases.

#### role

Test scenarios instantiate concrete situations against which requirements, flows, and acceptance criteria can be exercised.

They make verification real and prevent the definition from remaining purely abstract.

### metrics and indicators

The measures used to observe outcome, quality, performance, health, or success in practice.

They may be quantitative or qualitative, leading or lagging, user-facing, business-facing, technical, or operational.

#### role

Metrics and indicators do not replace acceptance criteria.

Acceptance criteria verify that the requirement is met; metrics and indicators help assess whether the resulting behavior performs or succeeds in reality.

These may also include telemetry and observability at different layers, for example:

- product analytics
- system observability
- platform observability
- infrastructure observability

## Traceability within Definition

### Every use case should trace to:

- zero or more user flows, when interaction structure matters
- one or more product requirements

#### rationale

A use case should not remain only as a high-level intention.

When interaction structure matters, it should be expressed through one or more user flows; and in all cases it should lead to one or more product requirements so that it becomes buildable and actionable.

### Every user flow should trace to:

- one or more use cases
- zero or more product requirements, when relevant

#### rationale

A user flow should represent some meaningful user goal, not an arbitrary sequence of screens or states.

It should usually connect back to one or more use cases, and may also connect directly to product requirements where a specific interaction structure is required by the definition.

### Every product requirement should trace to:

- one or more use cases, unless it is cross-cutting
- zero or more user flows, when interaction structure matters
- zero or more product-facing interfaces, when the requirement is realized through a specific surface

#### rationale

Requirements should normally be justified by one or more use cases.

This prevents orphan requirements with no user or actor rationale.

The exception is cross-cutting requirements, which may apply broadly across many use cases or across the product as a whole.

Where the requirement depends on sequence, branching, navigation, or state transitions, it should also trace to relevant user flows.

Where the requirement is specific to a consumption surface, it should also trace to the relevant product-facing interface.

## Traceability from Definition to Verification and Validation

### Every product requirement should trace to:

- one or more acceptance criteria

#### rationale

A requirement without acceptance criteria is not yet adequately verifiable.

Acceptance criteria are the immediate verification layer that turns a defined requirement into something testable and reviewable.

### Every use case, user flow, or product requirement should trace to:

- one or more test scenarios, when behavioral validation is needed
- zero or more metrics and indicators, when outcome measurement is relevant

#### rationale

Behavioral elements of the definition should be exercisable through test scenarios wherever verification depends on observed behavior.

This includes use cases, user flows, and product requirements.

Where success, health, performance, or impact needs to be observed beyond simple acceptance, they should also trace to relevant metrics and indicators.

## Practical reading of the whole structure

### inputs (initial)

Sections 1 to 7 collect and organize the upstream material used to understand and frame the work.

They are expected to evolve as the team learns more.

### outputs (refined)

Sections 8 and 9 transform that upstream material into artifacts that can support design, engineering, testing, review, and measurement.

They are the refined contract produced from the initial context.

### traceability

Traceability ensures that the refined outputs remain connected to their purpose, justification, and means of verification.

It is what prevents:

- use cases with no requirements
- requirements with no acceptance criteria
- flows with no user rationale
- scenarios with no definitional anchor
- metrics with no meaningful purpose

## Note on further decomposition

The product layer document names scenarios, acceptance criteria, interfaces, and other outputs, but it does not yet fully define their detailed internal structure.

In particular:

- what scenarios should look like in detail
- what acceptance criteria should look like in detail
- what should be generated at each product-facing interface

still needs to be defined more precisely.

That is related to the different steps in the V model and will be handled in a separate document.
