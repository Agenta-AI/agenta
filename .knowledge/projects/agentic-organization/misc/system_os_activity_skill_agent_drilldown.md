# System OS Activity, Skill, and Agent Drilldown

## Status

This is a working note.

It is meant to get concrete and pragmatic before we decide what should move back into `system-os/process.md`.

## Placement

Current intended split:

- `system-os/layer.md` = scope and overlaps
- `system-os/process.md` = compact operating summary
- `system-os/state.md` = state and knowledge summary
- this note = detailed drilldown on activities, roles, skills, agents, and likely artifacts

## Concrete role model

The current role model inside System OS has two groups.

### Core delivery loop roles

- `design actor` = the role defining the current layer
- `implementation actor` = the role building the current layer
- `verification critic` = the role reviewing the current layer for coherence, correctness, completeness, and quality
- `validation critic` = the role testing the current layer against expected behavior

These role types repeat across layers.

### Supporting workers

These are important, but they are not the same thing as the core left/right delivery loop.

- `debugger` = understands an issue and identifies where the issue actually is
- `researcher` = retrieves and synthesizes internal and external knowledge for the current task, including docs, products, implementations, and codebases
- `curator` = updates, consolidates, and improves internal system knowledge and documentation

These supporting workers are especially relevant when the work starts from:

- a bug
- an incident
- a failing test
- a production symptom
- an unclear mismatch between product expectation and system behavior
- a design gap
- an uncertainty about tradeoffs or alternatives
- a need to improve internal documentation or internal knowledge structure
- a need to update internal knowledge after the work is done

## Agents, sub-agents, and skills

The lists below should not be read as "one separate top-level agent for every bullet."

A cleaner reading is:

- a skill = a reusable capability
- an agent = a role-bearing operating shape that may carry multiple skills
- a sub-agent = a narrower agent shape used for a focused task, often as a projection of a broader agent

So in practice:

- one reviewer agent may carry multiple review skills
- one tester agent may carry multiple testing skills
- some focused review or testing work may still be best handled by specialist sub-agents

The current code-review and testing docs already point in that direction:

- reviews have broad domain passes plus deeper specialist passes when warranted
- tests have different interfaces and different lenses such as functional, performance, and security

So the working rule here is:

- do not create a separate top-level agent for every criterion, interface, or layer combination by default
- prefer a smaller number of broader agents with multiple skills
- split into specialist sub-agents only when that sharper operating shape is actually useful

### Reviewer pattern

A good default reviewer model is:

- `reviewer`
  - carries multiple review skills
  - may operate broadly across many layers and interfaces
  - may operate narrowly on one layer, one interface, or one review pass
- `focused review sub-agent`
  - is useful when a narrower pass is needed
  - examples: security, performance, design, testability, observability

So, for example:

- security review is often a skill or focused review sub-agent, not always its own permanent top-level agent
- observability review is often a skill or focused review sub-agent, not always its own permanent top-level agent
- frontend review and backend review are often domain-context skills, not necessarily distinct primary agents

The reviewer is also not limited to developer output.

- the reviewer may review any artifact produced by the other roles
- that includes research findings, issue-localization findings, design artifacts, implementation artifacts, tests, documentation updates, and knowledge updates

### Reviewer dimensions

The base reviewer dimensions should be explicit and stable.

The strongest source for this is the existing code-review criteria, which already define the universal review vocabulary.

#### Universal reviewer dimensions

These should be applied in every System OS review, regardless of whether the artifact under review is research, design, code, tests, or documentation.

- correctness
- completeness
- consistency
- soundness
- complexity
- security
- performance
- architecture
- testability
- observability

#### Situational reviewer dimensions

These should be pulled in when the work or artifact makes them relevant.

- reliability
- compliance
- maintainability
- risk

Interpretation:

- `risk` is not just another check item; it is the reviewer synthesis of likelihood, impact, exposure, and uncertainty across the findings
- `reliability` often overlaps with soundness, performance, and observability, but deserves explicit treatment for async, distributed, operational, or failure-sensitive work
- `compliance` matters when legal, regulatory, contractual, policy, privacy, audit, or data-handling obligations are in scope
- `maintainability` overlaps with consistency, complexity, architecture, and testability, but is still useful as an explicit summary concern in broader reviews

### Tester pattern

A good default tester model is:

- `tester`
  - carries multiple testing skills
  - may operate broadly across many layers and interfaces
  - may operate narrowly on one layer, one interface, or one testing lens
- `focused test sub-agent`
  - is useful when a narrower pass is needed
  - examples: performance testing, security testing, API testing, web testing, services testing

So here too:

- functional, performance, and security are often testing skills or lenses
- API, SDK, web, frontend, backend, and services are often testing contexts
- they can combine without forcing one permanent agent per combination

### Designer pattern

A good default designer model is:

- `designer`
  - can work across multiple layers and interfaces
  - may define broadly across the system
  - may also focus on one layer, one interface, or one design concern
- `focused design sub-agent`
  - is useful when a narrower design pass is needed
  - examples: interface-contract design, subsystem-boundary design, observability design, security design

### Developer pattern

A good default developer model is:

- `developer`
  - can work across multiple layers and interfaces
  - carries implementation skills that may apply broadly or narrowly
- `focused development sub-agent`
  - is useful when a narrower implementation pass is needed
  - examples: adapter development, API development, SDK development, and service integration work

So here too:

- layer and interface should usually be parameters, not a reason to create a separate permanent top-level developer agent every time
- one developer agent may work across all layers or all interfaces
- or may be focused on a subset when that sharper operating shape is useful

## Parameterized specialization dimensions

To avoid an exhaustive list of specialist agents, specialization should be treated as parameterized.

### Shared dimensions

- `layer`
  - may be a single value, multiple values, or `all`
  - `system`
  - `subsystem`
  - `component`
  - `functional`
- `interface`
  - may be a single value, multiple values, or `all`
  - `general`
  - `web`
  - `api`
  - `sdk`
  - `clients`
  - `services`
  - `docs`
- `coverage`
  - `breadth`
  - `depth`

These shared dimensions can apply to:

- designers
- developers
- reviewers
- testers

Interpretation:

- `coverage` describes whether the operating shape is broad or deep
- the breadth of `layer` and `interface` values also contributes to how broad or deep the work really is

### What is not parameterized here

For now, things such as:

- security
- performance
- observability
- design
- testability
- lens
- posture
- path
- case

should be read as:

- skills
- loaded knowledge
- review rubric choices
- test-plan or execution details

not as top-level agent parameters in this note

### Working rule

The point is not to create a top-level agent for every combination.

The point is to be able to say things like:

- `designer(layer=all, interface=all, coverage=breadth)`
- `designer(layer=subsystem, interface=services, coverage=depth)`
- `developer(layer=all, interface=all, coverage=breadth)`
- `developer(layer=functional, interface=api|services, coverage=depth)`
- `reviewer(layer=subsystem, interface=api, coverage=depth)`
- `reviewer(layer=component, interface=services, coverage=breadth)`
- `tester(layer=system, interface=sdk, coverage=depth)`
- `tester(layer=subsystem, interface=services, coverage=depth)`

So the specialization is compositional rather than exhaustive.

## Main System OS layers

- system layer
- subsystem layer
- component layer
- functional layer

## Activity families

### Issue investigation and localization

Purpose:

- understand the issue
- identify where the issue actually is
- identify which layer should own the next V-loop iteration
- separate symptom from likely fault location

Primary role:

- debugger

Likely skills:

- debugging
- issue triage
- fault localization
- log, trace, and telemetry reading
- reproduction building
- hypothesis generation
- scope reduction

Likely agents:

- debugger
- failure triager

Typical artifacts:

- issue framing note
- reproduction notes
- evidence and traces
- suspected layer or boundary
- suspected subsystem or component
- next-step recommendation for the V-loop

Typical outputs:

- issue-localization findings
- clarified failure mode
- narrowed fault surface
- recommendation on whether the next work starts at the system, subsystem, component, or functional layer

### External research and tradeoff exploration

Purpose:

- gather outside experience relevant to the current design or issue
- inspect how comparable systems, competitor products, open source codebases, or other companies' implementations approach the problem
- compare best practices, tradeoffs, alternatives, and examples
- bring outside knowledge into the current System OS task

Primary role:

- researcher

Likely skills:

- best-practices research
- competitor analysis
- open-source implementation reading
- alternative comparison
- tradeoff analysis
- source triage
- pattern extraction

Likely agents:

- researcher
- external researcher
- best-practices researcher

Typical artifacts:

- external research notes
- competitor or peer implementation notes
- option comparison notes
- pros and cons summary
- candidate patterns and anti-patterns

Typical outputs:

- external research findings
- recommended options to carry into design
- explicit tradeoffs to review

### Internal knowledge retrieval

Purpose:

- gather relevant internal knowledge before or during the work
- avoid rediscovering what the organization or repo already knows

Primary role:

- researcher

Likely skills:

- internal documentation search
- prior-change retrieval
- ADR and incident lookup
- precedent extraction
- existing-system reading

Likely agents:

- researcher
- internal researcher
- system historian

Typical artifacts:

- internal knowledge notes
- prior-decision summary
- relevant precedent set
- existing-boundary or contract references

Typical outputs:

- internal knowledge findings
- relevant prior decisions
- reusable prior patterns
- warnings about repeating known mistakes

### System knowledge maintenance

Purpose:

- update internal system knowledge after the work or during major changes
- keep the documented knowledge aligned with the evolving system

Primary role:

- curator

Likely skills:

- knowledge curation
- system documentation updates
- taxonomy and placement judgment
- summary writing
- truth distillation

Likely agents:

- curator
- system curator
- system documentation maintainer

Typical artifacts:

- documentation updates
- knowledge delta
- updated references
- extracted stable system truth

Typical outputs:

- system knowledge updates
- clearer internal documentation
- candidate stable truth for later extraction

### 1. System interface definition

Purpose:

- define the product-facing system interfaces as system contracts
- make point-like interactions explicit
- define behavior, errors, auth, telemetry, and non-functional expectations

Primary role:

- design actor

Supporting roles:

- verification critic
- validation critic

Likely skills:

- interface-contract design
- request and response modeling
- auth, authz, and entitlement modeling
- telemetry and observability design
- non-functional requirement design
- scenario shaping for happy, grumpy, edge, and failure cases

Typical designer parameterizations:

- `designer(layer=system, interface=api|sdk|web|docs, coverage=breadth)`
- `designer(layer=system, interface=api, coverage=depth)`

Typical artifacts:

- public interface contracts
- schema and model definitions
- auth and permission notes
- error model
- system-level scenarios
- interface-level acceptance and validation notes

### 2. System interface review

Purpose:

- review whether the system contract is coherent, complete, consistent, and realistic

Primary role:

- verification critic

Likely skills:

- contract review
- consistency review against product requirements
- security review
- observability review
- failure-mode review

Typical reviewer parameterizations:

- `reviewer(layer=system, interface=api, coverage=breadth)`
- `reviewer(layer=system, interface=api, coverage=depth)`
- `reviewer(layer=system, interface=sdk|web|docs, coverage=breadth)`

Typical outputs:

- review findings
- missing-case findings
- contract mismatch findings
- requests for tighter auth, telemetry, or error handling

### 3. System interface validation

Purpose:

- exercise the running system through its public boundaries
- verify black-box behavior against the contract

Primary role:

- validation critic

Likely skills:

- black-box system testing
- environment and fixture setup
- API, SDK, CLI, and UI test design
- timing and async behavior checks
- telemetry and observability checks

Typical tester parameterizations:

- `tester(layer=system, interface=api|sdk|web|docs, coverage=breadth)`
- `tester(layer=system, interface=api|sdk|services, coverage=depth)`
- `tester(layer=system, interface=api|web, coverage=depth)`

Typical outputs:

- system test evidence
- failing scenarios
- contract mismatch evidence
- runtime and telemetry evidence

### 4. Subsystem decomposition and boundary design

Purpose:

- break the system into meaningful subsystems
- define where boundaries, dependencies, and transports sit
- choose sync, async, push, pull, persistence, and runtime placement patterns

Primary role:

- design actor

Likely skills:

- subsystem decomposition
- boundary design
- dependency mapping
- transport-model design
- queue and event-flow design
- ports-and-adapters design

Typical designer parameterizations:

- `designer(layer=subsystem, interface=services, coverage=breadth)`
- `designer(layer=subsystem, interface=services, coverage=depth)`

Typical artifacts:

- subsystem map
- boundary definitions
- dependency notes
- transport shapes
- runtime placement notes
- design tradeoff notes

### 5. Subsystem review and integration validation

Purpose:

- check whether subsystem boundaries and collaborations are sound
- exercise real boundary behavior where integrations matter

Primary roles:

- verification critic
- validation critic

Likely skills:

- boundary review
- dependency direction review
- contract testing
- integration testing
- external dependency validation

Typical reviewer and tester parameterizations:

- `reviewer(layer=subsystem, interface=services, coverage=breadth)`
- `reviewer(layer=subsystem, interface=services, coverage=depth)`
- `tester(layer=subsystem, interface=services, coverage=depth)`

Typical outputs:

- boundary review findings
- integration test evidence
- transport mismatch findings
- invalid dependency assumptions

### 6. Component and domain design

Purpose:

- define the inside of one subsystem bubble
- define the domain types, ports, adapters, and service behavior

Primary role:

- design actor

Likely skills:

- domain modeling
- DTO and exception design
- port design
- adapter interface design
- dependency injection design
- service and orchestration design

Typical designer parameterizations:

- `designer(layer=component, interface=general|services, coverage=breadth)`
- `designer(layer=component, interface=services, coverage=depth)`

Typical artifacts:

- component specifications
- domain types
- exceptions and enums
- inbound and outbound interfaces
- dependency injection seams
- behavior notes and invariants

### 7. Component review and component testing

Purpose:

- review the design and exercise the component against its specification

Primary roles:

- verification critic
- validation critic

Likely skills:

- interface review
- cohesion and responsibility review
- component test design
- mock and double design
- white-box validation

Typical reviewer and tester parameterizations:

- `reviewer(layer=component, interface=general|services, coverage=depth)`
- `tester(layer=component, interface=general|services, coverage=depth)`

Typical outputs:

- interface findings
- cohesion findings
- component test evidence
- refactor requests

### 8. Functional layer implementation and unit testing

Purpose:

- build the actual code, helpers, transformations, and checks
- keep the implementation understandable and testable

Primary role:

- implementation actor

Supporting roles:

- verification critic
- validation critic

Likely skills:

- implementation
- refactoring
- helper extraction
- defensive checks
- unit test writing
- code readability and maintainability

Typical developer, reviewer, and tester parameterizations:

- `developer(layer=functional, interface=all, coverage=breadth)`
- `developer(layer=functional, interface=api|services, coverage=depth)`
- `reviewer(layer=functional, interface=general|services, coverage=depth)`
- `tester(layer=functional, interface=general|services, coverage=depth)`

Typical artifacts:

- code changes
- unit tests
- local execution evidence
- code review findings
- refactor notes

## Cross-cutting System OS activities

These are useful across more than one layer.

### Debugging and issue understanding

Purpose:

- understand a failure, mismatch, or bug in the existing system
- identify the layer where a new V-loop should start

Primary role:

- debugger

Likely skills:

- debugging
- issue triage
- trace reading
- log and telemetry reading
- minimal reproduction building

Likely agents:

- debugger
- failure triager

### Security review

Purpose:

- assess auth, authz, entitlements, exposure, and misuse paths across the system

Likely skills:

- threat modeling
- permission review
- security test design
- abuse-case review

Typical parameterizations:

- `reviewer(layer=system|subsystem|component|functional, interface=all, coverage=depth)`
- `tester(layer=system|subsystem|component|functional, interface=all, coverage=depth)`

### Performance and reliability review

Purpose:

- assess latency, throughput, async behavior, bottlenecks, degradation, and reliability risks

Likely skills:

- performance analysis
- load and bottleneck analysis
- reliability review
- failure-path review

Typical parameterizations:

- `reviewer(layer=system|subsystem|component|functional, interface=all, coverage=depth)`
- `tester(layer=system|subsystem|component|functional, interface=all, coverage=depth)`

### Observability review

Purpose:

- assess whether the system is observable enough to operate, debug, and validate

Likely skills:

- telemetry design review
- metrics and tracing review
- logging review
- operability review

Typical parameterizations:

- `reviewer(layer=system|subsystem|component|functional, interface=all, coverage=depth)`
- `tester(layer=system|subsystem|component|functional, interface=all, coverage=depth)`

## Pragmatic first cut for agent shapes

A practical first cut is not to create one agent per parameter combination above.

A smaller starter set is probably:

- `researcher`
- `debugger`
- `designer`
- `developer`
- `reviewer`
- `tester`
- `curator`

That set is small enough to operate, but still rich enough to cover the important activity families.

## Skills that should likely become first-class

Strong candidates for first-class reusable skills are:

- interface-contract design
- auth and entitlement design
- telemetry and observability design
- subsystem decomposition
- transport and boundary design
- ports-and-adapters design
- domain modeling
- dependency injection design
- black-box system testing
- integration testing
- component testing
- unit testing
- code review
- debugging
- external research
- internal knowledge retrieval
- knowledge maintenance
- security review
- performance review

## Open questions

- Which of the activity families above deserve dedicated agents, versus just skills inside broader agents?
- Which concrete artifacts should be mandatory at each System OS layer?
- Which skills are generic across repos, and which are specific to this system?
- How much of the subsystem and component work should stay inside System OS versus move into repo-specific project state?
