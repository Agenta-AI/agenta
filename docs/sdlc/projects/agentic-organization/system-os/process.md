# System OS Process

## Detailed working note

For the concrete drilldown on activities, roles, skills, agents, and likely artifacts, see:

- `../misc/system_os_activity_skill_agent_drilldown.md`

## Main loop

- localize the issue when the work starts from an existing problem
- gather or update knowledge when the work starts from uncertainty, a design gap, or a documentation gap
- refine the layer above into the current layer
- define the layer
- review the layer
- validate the layer
- implement what belongs at the layer
- feed residue back into system knowledge

## Core activities

- debugging and issue localization
- external research and tradeoff exploration
- internal knowledge retrieval
- system knowledge maintenance
- system definition
- subsystem decomposition
- dependency and interface design
- component and domain design
- functional development
- code review
- unit, integration, and system validation

## Actors and critics

- design actor = system designer
- implementation actor = system developer
- verification critic = system reviewer
- validation critic = system tester

## Supporting workers

- debugger = localizes the issue and recommends where the next V-loop should start
- researcher = gathers and synthesizes internal and external knowledge for the current task, including docs, products, implementations, and codebases
- curator = updates, consolidates, and improves internal system knowledge and documentation

## Reviewer note

- the reviewer may review anything produced by the other roles, not just code
- reviewable outputs include research findings, issue-localization findings, design artifacts, developer outputs, tests, documentation updates, and knowledge updates
- every review should at least assess:
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
- when relevant, the reviewer should also deepen on:
  - reliability
  - compliance
  - maintainability
  - risk

## Agent shape note

- one agent may carry multiple skills
- many review and testing specializations are better modeled as skill bundles or specialist sub-agents than as separate top-level agents
- a reviewer or tester can operate broadly or narrowly depending on the parameter values in use
- focused review or test sub-agents can be invoked when deeper security, performance, design, testability, or observability work is needed
- frontend, backend, API, SDK, services, and docs are often context skills or sub-agent specializations rather than always separate primary agents
- the same parameter pattern should usually apply to designers, developers, reviewers, and testers
- `layer` and `interface` may each be a single value, multiple values, or `all`
- `coverage` uses `breadth` or `depth`
- security, performance, observability, design, testability, and similar dimensions are usually better treated as skills, loaded knowledge, or execution details than as top-level agent parameters
- the same applies to test execution details such as posture, path, and case

## Likely agents, sub-agents, or skill bundles

- researcher
- debugger
- designer
- developer
- reviewer
- tester
- curator

## Main outputs

- issue-localization findings
- external knowledge findings
- internal knowledge findings
- system knowledge updates
- system contracts
- subsystem boundary definitions
- ports and adapters
- component types and methods
- functional-layer changes
- tests
- review findings
- documentation updates
