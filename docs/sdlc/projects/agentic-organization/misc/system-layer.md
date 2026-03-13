# System Layer

## Working note

This note is being built step by step.

For now, it records the points as stated, without trying to decompose them too early.

## 1. External system interfaces

- The system can be read from the perspective of the tests we are going to run.
- One important part is the different interfaces of the system.
- These interfaces may be layered.
- As long as a layer is still consumable by a user, it is still part of the product, so it is still a system interface.
- This is not about internal subsystem interfaces.
- This is about the system interface to the outside world.

Examples of system interfaces:

- web UI in a browser
- SDKs
- Python SDK
- web / TypeScript SDK
- other language SDKs
- CLI
- API

Notes on the API bucket:

- services that can be run through the API still belong under the API interface
- tools that can be run through the API still belong under the API interface

Generalization:

- at this layer there is some kind of consumer
- that consumer may be human
- that consumer may be programmatic
- that consumer may be an agent
- it is still an interface

Important extension:

- external documentation is also an interface
- the product-facing interfaces from the product layer are the system interfaces at this level
- observability or telemetry surfaces are also interfaces
- external documentation is the external knowledge interface at this level

## 2. Interface contracts and point interactions

- For each system interface, something important is the contract.
- The contract includes requests, responses, and expected behaviors.
- These expected behaviors include:
  - happy paths
  - grumpy paths
  - typical cases
  - edge cases
  - authentication-related behavior
  - and similar interaction conditions

Important distinction from the product layer:

- at the product layer, the focus was on fuller behaviors
- that means use cases, flows, and jobs to be done from one point to another
- here, the focus is on point-like interactions through the interface

Clarification:

- these are not necessarily single-step interactions
- sometimes they may involve two or three steps
- but they are still point-like interactions rather than full end-to-end product behaviors

API example:

- requests
  - endpoints
  - methods
  - query parameters
  - body parameters
  - schemas
- responses
  - response codes
  - exceptions
  - response bodies
  - and related response structures

## 3. System-level black-box evaluation dimensions

- This is still the system level in the sense that the system is treated as a complete black box and we interact with it from the outside.
- At this level, the point-like interactions can be checked against different kinds of specs.

These dimensions include:

- functional elements
- non-functional elements
- performance elements
- security elements
- testability elements
- observability or telemetry elements
- quality elements
- reliability elements
- consistency elements
- scalability and other ilities

Examples of what may matter at this level:

- rates
- latency
- timing
- whether behavior is synchronous or asynchronous
- if asynchronous, the delay for processing
- throughput or similar indicators
- product observability
- system observability
- platform observability
- infrastructure observability

Interpretation:

- the same point-like interaction can be checked from multiple perspectives
- that includes functional expectations
- non-functional expectations
- performance expectations
- security expectations
- testability expectations
- telemetry or observability expectations
- and other quality attributes

Validation posture:

- for each level we need to define whether validation is black-box or white-box
- whether the system under test is treated as black-box or white-box
- whether its dependencies are treated as black-box or white-box
- whether dependencies need to be running
- whether our own system needs to be running
- whether dependencies can or should be mocked
- and what infrastructure is therefore required for validation

## 4. Subsystem layer

- Once we peek a little bit under the hood of the system, we have subsystems.
- At the subsystem layer, we are talking about the different connections in the system once it is broken down.
- This is like the morphological chart of the system.
- Different pieces of work will have different complexity, different depth, and different amount of detail at this layer.

Examples of subsystem elements:

- an API
- a handler or router behind the API
- publishing to a queue
- the queue living in Redis
- asyncio workers
- TaskIQ workers
- a Postgres database
- frontend elements
- frontend async workers or service workers

This also starts to include where things run:

- whether something runs in a container
- whether things run in the same container
- and similar runtime placement questions

Interpretation:

- this starts to talk about the cyber-physical infrastructure architecture
- more precisely, it is still cyber in the sense that it ranges from software to platform to infrastructure
- but it is still necessary to understand where things live

What matters at this layer:

- where components live
- what the subsystem interfaces are
- whether connections are push or pull
- whether interactions are synchronous or asynchronous
- and similar execution and boundary properties

## 5. Interfaces between subsystems

- At the subsystem layer it is also important to talk about subsystem interfaces.
- If two subsystems interact with each other, then there is an interface between them.

Possible cases:

- sometimes the subsystem interface may coincide with an interface from the layer above
- for example, the web talking to the API may still be the same interface from one point of view
- sometimes it is about an adapter to an external dependency
- for example, how we interact with Redis
- or how we interact with Postgres

Important point:

- sometimes the interface is about objects in transit
- this is similar to request and response models
- but here it may be the shape of an event
- or a message in a queue
- or some other transport object

Clarification:

- these may be request and response models
- they may be transport objects
- they are not necessarily domain-level objects

Boundary-crossing interpretation:

- every time we cross a boundary, we touch some cyber-logical phase
- we move out of pure software logic and into something that depends on the actual architecture

Example:

- an internal DTO for a message may have to be transformed into a transport-level DTO for Redis
- that may require serialization or some other transformation

Generalization:

- the same kind of transformation happens at interfaces between subsystems

## 6. Evaluation dimensions at subsystem interfaces

- The same concerns apply here as well.
- Functional concerns can be considered here.
- Non-functional concerns can be considered here.
- Performance concerns can be considered here.
- Security concerns can be considered here.

So subsystem interfaces can also be checked from the perspective of:

- functional behavior
- non-functional behavior
- performance behavior
- security behavior
- testability behavior
- telemetry or observability behavior
- and related ilities

Security clarification:

- security here includes authentication
- security here includes authorization
- authorization includes permissions
- authorization also includes identity-related control
- it also includes access in terms of plan tiers
- so it includes entitlements
- it includes roles and entitlements

Interpretation:

- authentication and authorization exist at different levels
- and that is one important part of security
- the same general evaluation dimensions and validation-posture questions continue at this layer as well

## 7. Architecture decisions at the subsystem layer

- This is the layer where we ask architecture questions such as:
  - should Redis be used for persistence or caching
  - should something be kept in memory
  - should a flow be push or pull
  - should a router handle something synchronously on request
  - or should it push work to a queue and let another worker handle it asynchronously
  - should data be persisted here or later

Interpretation:

- this is about the structure of the different pieces
- this is about the flow of information, data, and decisions across those pieces
- this is architecture

What matters here:

- understanding the implications of the different morphological options
- understanding dependency perspective from the point of view of each running part

Example dependency perspective:

- if we are the API process running a router, then Redis, Postgres, SendGrid, and similar systems are external dependencies to that API handler
- even a worker reached through a queue in Redis is external from that API-handler point of view
- the worker may have a different dependency set
- for example, the worker may consume from Redis and also call an outside HTTP service through an HTTPX client pool
- the frontend or web UI may treat the API as an external dependency through hooks

General rule:

- for every dependency, there should be a core representation of the behavior of that dependency
- and there should be an adapter for that dependency

Boundary rule:

- for every logical boundary, there is an interface being exposed
- that interface has a port to the core logic
- and then adapters and interfaces on the inbound or outbound side

Interpretation in architecture terms:

- this is where the proper initial description of ports and adapters appears
- this is where hexagonal architecture appears for each boundary

Examples:

- Redis is an external dependency, so it needs an adapter
- Postgres is an external dependency, so it needs an adapter
- other outside services also need adapters
- for some boundaries we are on the inside
- for example, route handlers and task workers are inside-facing runtime pieces of our own system

## 8. Component level inside one hexagonal bubble

- At the subsystem level, we described the ports-and-adapters bubbles.
- We also described the adapters and the interactions at those adapters.
- Some of those boundaries may correspond to system-level interfaces.
- For example, the API may also be used from the outside.
- But here we go one level below that.

Interpretation:

- now we sit inside one of those ports-and-adapters or hexagonal bubbles
- and we define the core domain of that bubble

At this level we define:

- the core domain
- the core service behavior
- the types
- the functions and behaviors

The types may include:

- DTOs
- exceptions
- enums
- constants
- strings
- and other domain-level types

We also define:

- the interfaces for the adapters from the perspective of that bubble
- the external methods or calls that inbound adapters can use
- the service interface used from the outside of the bubble

Implementation perspective:

- we implement the outbound adapters against the outbound interfaces we defined
- we implement the inbound adapters against the service interface we defined

Architecture implications:

- this is where dependency injection happens
- this is where the domain-level internal DTOs are defined
- this is where domain-level exceptions and types are defined
- this is where inbound and outbound ports are defined through interfaces
- this is where inbound and outbound adapters are defined to interact with the outside world

## 9. Domain objects and operations at the component level

- At this level, we define which objects exist.
- We define which things are actually entities.
- We define what operations are possible.

This includes:

- what is exposed to inbound adapters or inbound interfaces
- what operations are required from outbound ports or interfaces
- what therefore requires some implementation because it is required by the model
- what combinations are possible or not possible

Interpretation:

- this is where we describe the types
- this is where we describe the methods
- this is where we describe what is possible and what is not
- this is where we describe valid and invalid combinations

Simple case:

- sometimes the inbound adapter transforms an HTTP request into the equivalent core-level input
- after checks such as authentication, authorization, entitlements, permissions, caching, and similar concerns
- then the service may simply recognize the operation as a read
- then it calls an outbound adapter to perform that read
- then the outbound adapter fetches the data and returns it

So in some cases:

- the core is almost a pass-through
- it mainly connects one inbound adapter to one outbound adapter

Complex case:

- sometimes the core is much more complex
- there is compute
- there is logic
- there are loops
- there are algorithms
- there is validation
- there is business logic
- there are enforced rules
- there is a process inside the body of the service

## 10. Implementation details and testing relation

- Once we are at that point, what remains is to implement the details.
- That includes all the utilities, methods, helpers, core algorithms, logic, checks, and related implementation pieces needed at each level.

This means:

- if it is an outbound adapter, we implement that outbound adapter
- if it is core logic, we implement that core logic
- if it is an inbound adapter, we implement that inbound adapter

Cross-cutting concerns:

- if there are concerns such as authentication, authorization, caching, and similar shared concerns
- then they should be implemented in a way that can be injected and reused

Interpretation:

- this is where we implement utilities
- this is where we implement helper functions
- this is where we pipe the logic
- this is where we do the transformations
- this is where we do the checks

Testing relation:

- this is the part that will ultimately be unit tested
- the level above is tested at the different interfaces

Testing interpretation:

- internal components are closer to unit tests
- they are still more white-box
- once we get to subsystem boundaries and outbound dependencies, the dependency is a black box
- so we test it through our adapter and through our interface
- that is where integration testing happens

Validation posture at this level:

- sometimes dependencies need to run
- sometimes our own system under test needs to run
- sometimes dependencies can be mocked
- sometimes the system under test is exercised as a black box
- sometimes internal components are exercised as a white box

Clarification:

- you could say that components involve integration, but it is internal integration
- that is still closer to unit testing because it remains white-box

Level above:

- once that is done, subsystems can be tested more fully
- in practice, that often becomes system-level validation
- for the API, everything behind the API needs to work
- for the web, everything behind the web needs to work

Exception:

- unless we are specifically testing third-party dependencies
- for example, testing our adapter and interface against Redis
- or against Postgres
- or against SendGrid
- or against another outside dependency

Final point:

- we do not necessarily need every interface in the whole system running at the same time
- for example, we may test the API independently of the web
- but that is still system-level validation for that interface

## 11. Loops and sub-loops in the V model and double V model

- The different loops and sub-loops in the V model and the double V model are about exactly this progression.
- One level takes the layer above it and makes a breakdown and design for the specific layer below.
- Then it passes that design to the level below.
- Then whatever needs to be defined or implemented at that level is defined or implemented.

Review dimension:

- at each level we need to understand what it means to review the work for the characteristics that matter

That includes:

- consistency with the rest of the codebase
- consistency with best practices
- soundness
- completeness
- correctness
- code quality
- security
- observability
- testability
- stability
- performance
- and related quality concerns

Validation dimension:

- we also need to make sure that we validate with the proper tests
- and that the review can actually happen

Practical implication:

- there must be proper documentation of what was done
- the code must be clear enough to be reviewed
- the work must be reviewable against:
  - the specifics of this V-model iteration or slice of work
  - the rest of the system

Interpretation:

- it is about internal review and validation
- but always with respect to the rest of the system as well

## 12. Cross-layer interfaces and documentation obligations

- The system layer has to remain internally consistent.
- It also has to remain eventually practicable, even if the practical execution model is refined later.

Upstream interface:

- the interface with the product layer above is important
- this system-layer work should refine what comes from the product layer for this V iteration
- in particular, the system layer should connect to the product-facing interfaces defined at the product layer

Existing knowledge interface:

- the interface to existing process knowledge is important
- the interface to existing system knowledge is important
- the interface to existing product knowledge is important
- the interface to existing documentation at those levels is important

Project and agent interface:

- the interface to project-level documentation and knowledge is important
- the interface to agent-level documentation and knowledge is important

Output expectation:

- what this loop does and produces should be properly reviewable
- the reviews should be clear and possible
- the outputs should be properly validated against the relevant requirement elements from the product layer

Documentation implication:

- because documentation is one of the interfaces, outputs from this layer may need to update documentation as part of the work
- that may include project documentation
- internal system documentation
- internal product or process documentation
- agent-facing documentation
- and external documentation where the interface itself is user-facing

Knowledge layering note:

- the existing agent knowledge
- the existing project knowledge
- the existing process knowledge
- the existing system knowledge
- the existing product knowledge
- and external knowledge
- all feed any task in the double V model

Internal versus external knowledge:

- agent, project, process, system, and product knowledge are internal knowledge
- external documentation is external knowledge
- that is why docs appear here as an interface

Task-specific knowledge note:

- what still needs to be defined separately is the knowledge that is specific to a given task
- that is, the knowledge created, maintained, and emitted by that specific piece of work
- that belongs to the future document about input artifacts, intermediate artifacts, and output artifacts for each activity

Artifact-generation note:

- similarly, what needs to be generated at each kind of interface is related to the different steps in the V model
- the current system-layer note names the layers and the concerns
- but it does not yet fully define the exact artifacts generated at each interface or each step
- that also belongs to the future document about input artifacts, intermediate artifacts, and output artifacts for each activity
