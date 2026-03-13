# Activities, Skills, and Possible Agents

## Working note

This note captures the kinds of activities that may later become:

- skills
- agents
- or agent bundles with multiple skills

It is cross-cutting relative to product, system, process, and knowledge work.

## Baseline role idea

For each layer of the local V-loop, we already have at least:

- one worker actor
- one reviewer critic
- one tester critic

So at minimum, that suggests at least three role-shaped agents per layer.

It also suggests at least three skills per layer, though an agent may carry multiple skills.

## Product-layer possibilities

At the product layer, even the worker side may split into multiple specialized activities.

Examples:

- competitor research
- best-practices research
- product framing
- product review
- product validation

These could later become:

- specialized research skills
- specialized product agents
- or product-worker sub-agents

## System- and product-level issue understanding

There could be a debugger-style activity or agent that:

- takes an issue at the system level or product level
- tries to understand what is going on
- gathers the information needed for a new V-loop iteration
- helps support fixing the existing system

## Exploration and improvement

There could be exploratory activities or agents that:

- take the system as it exists
- explore possible improvements
- compare possible ways to modify the system
- provide exploratory direction before a concrete V-loop begins

## Security review outside a single project context

There could be security-oriented activities or agents that:

- review the system outside the context of one specific project
- provide an assessment of risks
- identify things to improve
- feed future work or future rules

## Process-improvement activities

There could be process-oriented activities or agents that:

- inspect the codebase and the knowledge surfaces
- improve process knowledge
- add or modify rules
- encode lessons learned from a specific project
- help prevent the same issue from recurring

This applies beyond simple verification and validation.

## Knowledge extraction in both directions

There are at least two important questions:

### 1. What existing knowledge should feed a specific activity?

This may come from:

- system knowledge
- product knowledge
- process knowledge
- project knowledge
- agent knowledge
- and other relevant knowledge surfaces

### 2. What did the activity learn that should improve knowledge afterward?

Once an activity is done, we may need to improve:

- process knowledge
- system knowledge
- product knowledge
- agent knowledge
- project knowledge
- or other relevant knowledge surfaces

## Main idea

The work is not only:

- design (actor)
- implementation (actor)
- verification (critic)
- validation (critic)

It is also:

- selecting the right knowledge for the activity
- performing the activity with the right skills and tools
- and then pushing the learned residue back into the right knowledge layers

That feedback direction is part of the model, not an afterthought.

## Attempt at full coverage across the double V model

This is a first-pass inventory of the skills and agents needed to cover the whole model without splitting hairs too early.

Each item below could exist as:

- a skill
- an agent
- or an agent carrying several related skills

## Product layer

### Worker-side agents or skills

- product framer
- user researcher
- competitor researcher
- best-practices researcher
- interface shaper
- product definer

### Reviewer and tester critics

- product reviewer
- product validator

### Product-layer skills

- frame context, problem, goals, and scope
- identify stakeholders and target users
- define product-facing interfaces
- derive jobs to be done, pains, and gains
- derive use cases, user flows, and product requirements
- derive acceptance criteria, scenarios, and metrics
- review traceability inside the product layer

## System layer

### Worker-side agents or skills

- system architect
- interface-contract designer
- system-observability designer
- system-test designer

### Reviewer and tester critics

- architecture reviewer
- system validator

### System-layer skills

- refine product-facing interfaces into system interfaces
- define point-like interaction contracts
- define black-box behavior expectations
- define functional, non-functional, security, performance, telemetry, and testability dimensions
- define system-level validation posture
- map product requirements to system interfaces and system behaviors

## Subsystem layer

### Worker-side agents or skills

- subsystem architect
- dependency mapper
- integration designer
- transport-model designer

### Reviewer and tester critics

- subsystem reviewer
- integration validator

### Subsystem-layer skills

- break the system into morphological options and boundaries
- define subsystem interfaces
- define dependency perspective per running part
- define transport objects across boundaries
- define push vs pull and sync vs async choices
- define ports and adapters at subsystem boundaries
- assess architecture tradeoffs for those choices

## Component level

### Worker-side agents or skills

- component designer
- domain modeler
- service designer
- port designer
- adapter designer

### Reviewer and tester critics

- component reviewer
- component validator

### Component-layer skills

- define core domain types
- define DTOs, exceptions, enums, constants, and related types
- define entities and allowed operations
- define inbound and outbound ports
- define inbound and outbound adapters
- define dependency injection seams
- review whether the core is pass-through or logic-heavy

## Implementation level

### Worker-side agents or skills

- implementer
- refactorer
- helper and utility builder

### Reviewer and tester critics

- code reviewer
- unit tester

### Implementation-layer skills

- implement core logic
- implement inbound adapters
- implement outbound adapters
- implement transformations and checks
- implement reusable cross-cutting utilities
- unit test internal logic
- keep the code reviewable, stable, and clear

## Cross-cutting activities outside one layer

These are not limited to one point in the double V.

### Investigation and debugging

- issue investigator
- debugger
- failure triager

### Exploration and change design

- improvement explorer
- migration explorer
- alternative-design explorer

### Quality and risk review

- security reviewer
- performance reviewer
- reliability reviewer
- observability reviewer

### Knowledge and documentation improvement

- process improver
- system knowledge improver
- product knowledge improver
- agent knowledge improver
- project knowledge maintainer
- external documentation maintainer

## Team-shaped role families that map well to agents

If we want coverage similar to strong product and engineering teams, the obvious role families are:

- product framing and research
- interaction and interface definition
- technical architecture
- subsystem and integration design
- component and domain design
- implementation
- review
- validation and testing
- security
- performance and reliability
- observability and operations
- documentation
- process improvement
- debugging and investigation

## Main practical takeaway

The double V model does not imply only three generic roles repeated forever.

At minimum it gives:

- worker actor
- reviewer critic
- tester critic

But in practice, to cover the whole model well, we likely need:

- layer-specific worker skills
- layer-specific reviewer skills
- layer-specific tester skills
- and cross-cutting investigative, exploratory, security, observability, documentation, and process-improvement skills
