# Agentic Engineering Loops

**User:** Juan Pablo Vega (jp@agenta.ai)  
**Created:** 3/5/2026 21:20:52  
**Updated:** 3/8/2026 14:25:55  
**Exported:** 3/8/2026 14:26:33  
**Link:** [https://chatgpt.com/c/69a9e5a3-527c-838e-a7c7-8408d61450f3](https://chatgpt.com/c/69a9e5a3-527c-838e-a7c7-8408d61450f3)  

## Prompt:
Let's start the discussion about agentic engineering in a software development company, at least within the team where we have different loops. For instance, when you're developing, you're checking against your progress. When you're reviewing, you're checking against your own findings. And then when you're testing, you're checking against requirements in a way, defining like BDD if you will, or TDD if you're at a lower level, for instance, for development. And overall, there's a loop, and you can have autonomy, and you can split it. And obviously, you can have rules that these agents can use, and you can have different prompts that they can use, or documentation and so on. Then you could run this manually if you're using skills, right, and basically do it for yourself. You can also run it with agents and sub-agents. But what I'm interested in is what that loop could look like in terms of best practices for this, and then the kind of artifacts that basically constitute the boundary for beginning and end and tracking and so on, like a paper memory to basically continue the loop, and also the kind of environment setups that are needed, for instance, access to web, obviously, when you're doing comparisons and research and so on, or access to a runtime environment where you can run what you're developing, execute against, but also you can run your tests and so on and so forth. But before that, I'm trying to understand the different, let's say, sub-agents of the whole flow and the kind of powers and counterpowers, like actors and critiques in the smaller loops and in the overall loop.

## Response:
What you’re describing is basically “software development, but every step has an explicit _actor–critic loop_ and an explicit _memory boundary_ so humans + agents can keep iterating without drifting.”

Here’s a concrete way to model it that tends to work in real teams.

1) Think in loops, not “one agent”
----------------------------------

### Micro-loops (tight, frequent)

These are the ones that happen dozens of times per day.

*   **Dev loop**: _Implement ↔ self-check_  
    Goal: converge on correct code quickly.
*   **Review loop**: _Critique ↔ revise_  
    Goal: catch risk, correctness, maintainability.
*   **Test loop**: _Specify ↔ verify_ (BDD/TDD)  
    Goal: turn requirements into executable truth.
*   **Research loop**: _Hypothesize ↔ verify_ (web/docs)  
    Goal: pick the right approach and avoid cargo culting.

### Macro-loop (slow, governing)

This is the one that prevents local optimization from breaking the product.

*   **Delivery loop**: _Intent ↔ evidence ↔ decision_  
    Goal: “Are we building the right thing, safely, within constraints?”

Agents are useful when you make each loop explicit and give each loop:

1.  a **start artifact**, 2) a **stop artifact**, 3) an **evaluation rubric**, 4) a **memory log**.

* * *

2) The sub-agents and their “powers / counterpowers”
----------------------------------------------------

A useful pattern is: **every actor has a paired critic**, and some critics must be _structurally independent_ (can’t “want” the same outcome).

### A. Product / Intent loop

*   **Actor: Scope & Intent Agent**
    *   Power: summarize requirements, clarify constraints, propose acceptance criteria.
*   **Counterpower: Ambiguity Hunter**
    *   Power: identify missing definitions, edge cases, contradictory requirements, untestable statements.
*   **Boundary artifacts**
    *   _Start_: PRD / ticket / issue
    *   _Stop_: “Acceptance Criteria + Non-goals + Constraints” (1 page)

### B. Design loop (technical)

*   **Actor: Solution Architect**
    *   Power: propose design, interfaces, data contracts, migration plan.
*   **Counterpower: Risk & Complexity Critic**
    *   Power: challenge with “what breaks?”, perf/cost, operational burden, security, maintainability.
*   **Boundary artifacts**
    *   _Start_: acceptance criteria
    *   _Stop_: ADR (Architecture Decision Record) + interface spec (OpenAPI / typed contracts) + threat notes (short)

### C. Implementation loop (dev)

*   **Actor: Implementer**
    *   Power: produce code changes, wiring, migrations.
*   **Counterpower: Invariant Checker**
    *   Power: ensure invariants hold (types, contracts, backwards compat, idempotency, error handling).
*   **Boundary artifacts**
    *   _Start_: design + tasks
    *   _Stop_: “diff + local evidence”: commands run, outputs, screenshots/log excerpts, perf checks

### D. Review loop (quality)

*   **Actor: Reviewer**
    *   Power: find bugs, architecture issues, readability problems.
*   **Counterpower: Author Advocate (limited)**
    *   Power: defend necessity, provide context, prevent bikeshedding.
*   **Boundary artifacts**
    *   _Start_: PR + evidence
    *   _Stop_: structured findings list (severity + fix suggestion) + “approve with conditions” or “block”

### E. Testing loop (verification)

*   **Actor: Test Author**
    *   Power: encode acceptance criteria as tests; create fixtures; define test matrix.
*   **Counterpower: Coverage Skeptic**
    *   Power: ask “what’s not tested?”, “what would fail in prod?”, “what about weird inputs?”
*   **Boundary artifacts**
    *   _Start_: acceptance criteria
    *   _Stop_: test plan + test results + coverage notes

### F. Release / Ops loop (real-world)

*   **Actor: Release Captain**
    *   Power: propose rollout, flags, migration order, rollback plan.
*   **Counterpower: Incident Paranoid**
    *   Power: block release if rollback/observability is weak; demand SLOs, monitors, runbook.
*   **Boundary artifacts**
    *   _Start_: merged PRs
    *   _Stop_: release checklist + runbook delta + monitors added + post-release verification

### G. Security loop (continuous)

*   **Actor: Security Reviewer**
    *   Power: threat model delta, secret handling, authz/authn concerns, dependency risk.
*   **Counterpower: Exploit Thinker**
    *   Power: actively tries to break assumptions; focuses on abuse paths.
*   **Boundary artifacts**
    *   _Start_: changeset + exposed surfaces
    *   _Stop_: security notes + required mitigations + “residual risk accepted by X”

Key idea: **don’t let one agent do both actor and critic in the same step** unless you _force separation_ via different rubrics and memory boundaries.

* * *

3) The “paper memory” that makes loops stable
---------------------------------------------

If you only keep chat logs, the loop decays. You want a small set of _durable artifacts_ that are easy to diff and review.

A minimal but powerful set:

1.  **Intent Doc (1 page)**
    *   goal, non-goals, constraints, acceptance criteria, examples
2.  **ADR (1 page)**
    *   decision, alternatives, trade-offs, consequences, rollback/exit
3.  **Plan / Task Breakdown**
    *   checkpoints + “definition of done” per checkpoint
4.  **Findings Log**
    *   reviewer/test/security findings with severity, status, evidence link
5.  **Evidence Log**
    *   exact commands run + outputs (tests, lint, migrations, benchmarks)
6.  **Change Log / PR Description Template**
    *   what changed, why, risk, how to validate, rollout/rollback
7.  **Runbook Delta**
    *   what ops needs to know _because of this change_

These are the “boundaries” where agents can safely hand off work without re-deriving context.

* * *

4) Environment setup: what agents need (and what they must not have)
--------------------------------------------------------------------

Think in **capabilities** with explicit policies, not “give the agent a shell”.

### Capability buckets

*   **Read-only repo access** (default for critics)
*   **Write access** (only for implementer)
*   **Execution access** (tests, linters, typecheck, build)
*   **Runtime sandbox** (run the service locally / ephemeral env)
*   **Web access** (for research agent only, with citation requirement)
*   **Secrets access** (almost never; use short-lived scoped tokens or a proxy)
*   **CI access** (read-only logs by default; gated triggers)

### Practical guardrails

*   Critics should usually be **read-only**.
*   Implementers can write but must produce an **evidence log**.
*   Anything that can deploy or touch prod is gated by a **release loop** artifact (checklist + rollback plan).
*   Web research should produce **sources + quotes + decision** (avoid “vibes-based” design).

* * *

5) How autonomy works without chaos
-----------------------------------

Autonomy isn’t “agents do whatever.” It’s:

*   **Autonomy inside a box** (clear acceptance criteria + constraints)
*   **Small checkpoints** (micro-loop stop artifacts)
*   **Escalation rules** (when an agent must stop and ask for a human decision)

Good escalation triggers:

*   requirement ambiguity
*   security/auth changes
*   schema/data migrations
*   performance regressions
*   external dependency changes
*   anything affecting billing, permissions, or data retention

* * *

If you want to continue, the next useful step is to pick _one_ concrete workflow (e.g., “add endpoint + DB migration + UI form”) and I’ll map it into:

*   the exact sub-agent chain,
*   the artifacts produced at each boundary,
*   and a lightweight folder structure you can standardize in your repo (`/docs/adr/`, `/evidence/`, `/runbooks/`, etc.).

## Prompt:
I'd be interested in understanding how the different sub-loops and the different layers of loops interact with each other. Obviously, at the lower level, you have each actor and the critique and the boundaries and so on. We try to understand that it's clear, like the piping of the deliverables and all the points where there's either human view or human interaction or human input as one of the inputs to one of the loops, or human gatekeeping and making sure that the different loops are clear so that there's no input that's supposed to be needed and no one produces it, even including humans, right, producing it. And the same for checks and for loops and the different axis and so on. But before we go into a lot of detail, I'm trying to understand the connection, the graph.

## Response:
The easiest way to reason about this is to treat **software development as a graph of loops**, not a sequence of steps. Each loop is a **local control system** with:

*   an **actor**
*   a **critic**
*   a **state artifact**
*   an **exit condition**

The loops interact through **artifacts**, not through direct conversation.  
Artifacts are the edges of the graph.

* * *

1\. The core graph of engineering loops
=======================================

At the highest level, you can think of five major loops that continuously interact.

```
          ┌──────────────────────────┐
          │      Product / Intent     │
          │  (requirements clarity)   │
          └─────────────┬─────────────┘
                        │
                        ▼
              ┌─────────────────┐
              │     Design      │
              │ architecture &  │
              │ interface spec  │
              └───────┬─────────┘
                      │
                      ▼
        ┌────────────────────────────┐
        │        Implementation       │
        │  coding + refactoring loop │
        └──────────┬─────────────────┘
                   │
         ┌─────────┴─────────┐
         ▼                   ▼
  ┌───────────────┐   ┌───────────────┐
  │     Review    │   │     Testing   │
  │ code quality  │   │ verification  │
  └───────┬───────┘   └───────┬───────┘
          │                   │
          └─────────┬─────────┘
                    ▼
           ┌─────────────────┐
           │   Release/Ops   │
           │ rollout & SLOs  │
           └─────────────────┘
```

But the key insight is:

**Each box is itself a loop.**

And each loop consumes artifacts produced by the previous loop.

* * *

2\. Nested loops (the fractal structure)
========================================

Every layer has the same structure.

```
loop = {
   actor
   critic
   artifact_state
   evaluation_rule
}
```

Example: Implementation loop

```
Implementer
   ↓ produces
Code change

Critic
   ↓ evaluates
Correctness / invariants

If pass → commit
If fail → revise
```

So the full system is **loops inside loops**.

```
macro-loop: Delivery
    ├─ design loop
    ├─ implementation loop
    │      ├─ coding micro-loop
    │      └─ refactoring micro-loop
    ├─ review loop
    ├─ test loop
    └─ release loop
```

* * *

3\. Artifact flow (the real edges)
==================================

Loops do **not call each other directly**.

They exchange **artifacts**.

```
Requirement doc
      ↓
Architecture decision
      ↓
Code diff
      ↓
Review findings
      ↓
Test suite + results
      ↓
Release plan
```

Graphically:

```
Intent → Design → Code → Review → Test → Release
```

But with feedback edges:

```
Review ───────────────┐
                      │
Test ───────────┐     │
                ▼     ▼
             Implementation
```

And sometimes:

```
Test → Intent (requirements incomplete)
Review → Design (architecture wrong)
Ops → Design (system unstable)
```

So the real graph is:

```
Intent
  ↓
Design
  ↓
Implementation
  ↓
Review
  ↓
Testing
  ↓
Release
  ↓
Production feedback
  ↺
Intent
```

* * *

4\. Human interaction points
============================

Humans usually appear in three types of nodes.

### 1\. Intent authority

Humans define goals and priorities.

Example inputs:

*   product requirements
*   feature acceptance criteria
*   constraints (security, cost, latency)

Agents help refine but **humans decide**.

* * *

### 2\. Risk gatekeeping

Humans intervene when risk exceeds thresholds.

Typical gates:

*   architecture approval
*   security review
*   production deployment

Agents prepare the evidence.

* * *

### 3\. Ambiguity resolution

When loops cannot converge.

Examples:

*   requirements unclear
*   tradeoff unresolved
*   conflicting review feedback

Agents escalate.

* * *

5\. Two orthogonal axes of loops
================================

There are actually **two dimensions**.

### Vertical: lifecycle

```
Intent
Design
Implementation
Review
Test
Release
```

### Horizontal: critique systems

Each stage has its own critique.

```
Implementation → invariant checks
Review → code quality critique
Test → behavioral verification
Ops → reliability critique
Security → threat critique
```

So the real graph is more like:

```
                 Security
                     ▲
                     │
Intent → Design → Implementation → Review → Test → Release
                     │
                     ▼
                 Performance
```

Critics run **across** stages.

* * *

6\. Synchronization boundaries
==============================

Loops must synchronize at **stable artifacts**.

Examples:

| boundary | artifact |
| --- | --- |
| design start | acceptance criteria |
| coding start | architecture spec |
| review start | code diff |
| test start | executable feature |
| release start | passing tests |

This prevents loops from running on inconsistent states.

* * *

7\. Where agents operate best
=============================

Agents work best in **bounded loops** with clear evaluation.

Good loops for agents:

*   research loop
*   code implementation
*   code review
*   test generation
*   static analysis
*   migration validation

Hard loops:

*   product intent
*   architecture tradeoffs
*   prioritization

These require human authority.

* * *

8\. Observability of the loop system
====================================

To keep the system stable you need **meta artifacts**.

Examples:

```
progress.md
findings.md
risks.md
questions.md
evidence/
```

These allow loops to resume without losing context.

* * *

9\. The full graph (simplified)
===============================

```
             ┌──────────────┐
             │    Intent     │
             └──────┬───────┘
                    │
                    ▼
             ┌──────────────┐
             │    Design     │
             └──────┬───────┘
                    │
                    ▼
             ┌──────────────┐
             │ Implementation│
             └──────┬───────┘
                    │
        ┌───────────┴───────────┐
        ▼                       ▼
  ┌─────────────┐       ┌─────────────┐
  │    Review    │       │    Testing   │
  └──────┬───────┘       └──────┬───────┘
         │                      │
         └──────────┬───────────┘
                    ▼
             ┌──────────────┐
             │    Release    │
             └──────┬───────┘
                    ▼
             ┌──────────────┐
             │  Production   │
             └──────┬───────┘
                    ▼
                 Feedback
                    ↺
```

Every box internally contains:

```
actor → artifact → critic → decision
```

* * *

10\. The key principle
======================

The system works when:

**loops communicate through artifacts, not through chat.**

Artifacts give:

*   reproducibility
*   traceability
*   resumability
*   auditability

Without artifacts the loops collapse into one big conversation.

* * *

If you'd like, the next step I can show is something that becomes very powerful in practice:

**the minimal artifact set that makes the entire loop graph stable for agentic engineering** (usually ~10 files in a repo).

## Prompt:
Can we quickly connect this to the V model, for instance, to understand if there are steps that are missing, or about the nested nature of things?

## Response:
Yes — connecting what we discussed to the **V-model** is actually very helpful because the V-model already encodes the key principle you’re trying to design:

> **Every construction step must have a corresponding verification step.**

Agentic loops basically **turn each side of the V into actor–critic loops**, and they make the verification side explicit and continuous.

Let’s map them.

* * *

1\. The classical V-model
=========================

The traditional V-model in software engineering looks like this:

```
Requirements
     │
     ▼
System Design
     │
     ▼
Architecture Design
     │
     ▼
Module Design
     │
     ▼
Implementation
     │
     │
     ▼
Unit Tests
     ▲
Integration Tests
     ▲
System Tests
     ▲
Acceptance Tests
```

Or visually:

```
Requirements ─────────────── Acceptance Test
     │                             ▲
     ▼                             │
System Design ─────────────── System Test
     │                             ▲
     ▼                             │
Architecture ─────────────── Integration Test
     │                             ▲
     ▼                             │
Module Design ─────────────── Unit Test
     │
     ▼
Implementation
```

The left side **builds**.

The right side **verifies**.

* * *

2\. Mapping this to agentic loops
=================================

Each step becomes a **loop with actor + critic**.

| V-Model stage | Actor | Critic |
| --- | --- | --- |
| Requirements | product spec agent | ambiguity critic |
| System design | architecture agent | complexity/risk critic |
| Module design | developer agent | invariant critic |
| Implementation | coder | static analysis/tests |
| Unit testing | test author | coverage critic |
| Integration testing | integration validator | dependency critic |
| System testing | QA | behavior critic |
| Acceptance testing | product reviewer | requirement verifier |

So the V-model becomes:

```
actor (left side)
critic (right side)
```

This is exactly what your **agent + counter-agent idea** mirrors.

* * *

3\. Where agentic engineering adds something
============================================

The classical V-model assumes **big sequential stages**.

Agentic loops make it **continuous and nested**.

Instead of:

```
Design → Implement → Test
```

you get:

```
Design loop
    ↕
Implementation loop
    ↕
Test loop
```

All running simultaneously.

Example:

```
design artifact
      ↓
implementation loop
      ↓
unit test loop
      ↓
review loop
```

Each loop can bounce back to the previous layer.

* * *

4\. Nested V-models (important insight)
=======================================

In real systems the V-model is **fractal**.

Every layer has its own mini V.

Example:

### System level

```
Requirements
     ↓
System design
     ↓
Implementation
     ↓
System tests
```

### Service level

```
Service requirements
     ↓
API design
     ↓
Implementation
     ↓
Integration tests
```

### Function level

```
Function spec
     ↓
Code
     ↓
Unit tests
```

So the actual structure is:

```
V
 ├─ V
 │   ├─ V
 │   └─ V
 └─ V
```

Agentic engineering naturally fits this because **each V is a loop**.

* * *

5\. The graph view vs the V view
================================

The V-model is basically a **projection of the loop graph onto time**.

Your earlier graph:

```
Intent → Design → Implementation → Review → Test → Release
```

If you fold verification upward you get the V.

```
Intent ------------------- Acceptance Test
   │                              ▲
Design --------------------- System Test
   │                              ▲
Implementation ----------- Unit / Integration
```

So:

```
graph view = runtime
V view = structure
```

* * *

6\. What agentic engineering typically adds to the V-model
==========================================================

Three loops usually missing in the classical V-model become explicit.

### 1\. Research loop

Before design.

```
Research
   ↓
Design
```

Agents are extremely useful here (docs, comparisons, experiments).

* * *

### 2\. Review loop

Code review is not explicitly part of the classical V.

But in practice it's essential.

```
Implementation
     ↔
Review
```

* * *

### 3\. Operations loop

Production feedback.

```
Release
   ↓
Production
   ↓
Observability
   ↓
Design/Requirements update
```

This closes the lifecycle.

* * *

7\. The resulting “Agentic V”
=============================

If we combine everything:

```
Research
   │
   ▼
Requirements ───────────── Acceptance tests
   │                            ▲
   ▼                            │
System design ───────────── System tests
   │                            ▲
   ▼                            │
Architecture ───────────── Integration tests
   │                            ▲
   ▼                            │
Module design ───────────── Unit tests
   │
   ▼
Implementation
   │
   ▼
Review loop
   │
   ▼
Release
   │
   ▼
Production feedback
```

* * *

8\. The important connection to your earlier idea
=================================================

Your earlier notion of:

> actor / critic / artifact boundary

is exactly the **mechanism that enforces the V-model automatically**.

Actor = left side  
Critic = right side

Artifact = connection.

* * *

9\. The practical takeaway
==========================

For an agentic engineering workflow you want to explicitly represent:

1.  **construction artifacts**
2.  **verification artifacts**

Example minimal set:

| construction | verification |
| --- | --- |
| requirements.md | acceptance tests |
| design.md | system tests |
| api\_spec.md | integration tests |
| code | unit tests |
| migration plan | migration test |
| runbook | ops validation |

That is literally the V-model encoded in files.

* * *

If you want, the **next interesting step** is something that becomes extremely powerful for agentic workflows:

**turning the V-model into a DAG of loops instead of a linear pipeline**, which is how companies like Amazon and Google actually run engineering internally.

## Prompt:
And how does the different layers there that you mentioned map to the different, you know, tests? I can understand that, you know, unit tests are unit tests, right, like internal things you can mock. It's white box. Then when you have modules, you're starting to get into integration tests and contract testing, and basically you're at the interface level, and you may have, you know, isolations and flows in terms of, you know, illities, but it's still at the interface. It's like black box, immediate use, right? And then you have, from the perspective of the consumer, right, obviously, but still. And then you have at the top, you have acceptance testing, right, which could be, you know, about product requirements and so on and so forth, right? And then when you say systems, I guess it's specifications, right, specs, because you have requirements, specs, and then, you know, modules and then components. But then how do you separate the acceptance tests and the system tests? Would the acceptance tests be, like, product level, like requirements, and then the specification tests would be what? For instance, if you're talking about end-to-end automation testing, which could be at the API level because the API is a product, because it's a developer's, you know, partly a developer's problem, product, but also because with agents, all the APIs are the product, but also you have a UI, so you have just user acceptance testing when you do end-to-end from the perspective of the UI. But seeing the web as the product and the API as part of the system, I think it's wrong in this case because there are different kinds of consumers. So user acceptance testing and, say, you know, agent or developer acceptance testing is still acceptance testing, right? It's just that it's one system on top of each other. So I don't know exactly how maybe the acceptance testing is more kind of validation over time, so that basically in terms of KPIs, if you think about it, right, that would be interesting at the level of the requirements. But then how do you make this difference between the specs and the requirements here?

## Response:
Your confusion is very legitimate because the **classical V-model terminology (requirements / specs / system tests / acceptance tests)** comes from older engineering contexts (embedded, aerospace) where there was **one system and one user**.

Modern software has **multiple consumers and layered systems**, so the mapping becomes blurry unless we reframe it properly.

The key insight that resolves the confusion is this:

> **Each layer of specification corresponds to a different consumer of the system.**

Tests validate that the **system satisfies the contract defined for that consumer**.

So instead of thinking:

```
requirements → specs → modules → components
```

think:

```
consumer layers → contracts → implementations
```

and the tests validate those contracts.

* * *

1\. The real hierarchy: consumers and contracts
===============================================

A modern stack often looks like this:

```
Business / Product users
        ↑
External clients (UI, API consumers, agents)
        ↑
Internal services / modules
        ↑
Functions / algorithms
```

Each layer exposes a **contract**.

| layer | contract |
| --- | --- |
| business | product behavior |
| external interface | API/UI contract |
| service/module | module interfaces |
| function | code semantics |

Each contract has a **matching test layer**.

* * *

2\. Mapping tests to layers
===========================

A clearer mapping is:

| layer | artifact | tests |
| --- | --- | --- |
| business | requirements | acceptance tests |
| external interface | API/UI spec | system / end-to-end tests |
| service/module | interface contracts | integration tests |
| function | implementation | unit tests |

So the stack becomes:

```
requirements
     ↓
API/UI specification
     ↓
service/module contracts
     ↓
code
```

and verification:

```
acceptance tests
system / E2E tests
integration tests
unit tests
```

* * *

3\. The difference between system tests and acceptance tests
============================================================

This is the part that causes the most confusion.

### System tests

System tests verify that **the system behaves correctly according to its specification**.

Example:

```
POST /users
→ returns 201
→ creates user
→ schema correct
```

These tests verify **technical correctness**.

They answer:

> Does the system implement the specification?

* * *

### Acceptance tests

Acceptance tests verify that **the specification satisfies the business requirements**.

Example:

```
A user can register and log in.
A purchase can be completed.
A conversation with an agent returns a useful answer.
```

They answer:

> Does the system solve the user problem?

* * *

### Another way to see it

```
System tests → spec correctness
Acceptance tests → requirement validity
```

* * *

4\. Where end-to-end tests fit
==============================

E2E tests can belong to **either category** depending on what they verify.

### E2E as system test

Example:

```
HTTP request
→ service
→ database
→ response
```

This verifies the **system architecture**.

* * *

### E2E as acceptance test

Example:

```
user logs in
creates document
exports PDF
```

This verifies the **user journey**.

* * *

5\. Multiple acceptance layers (modern systems)
===============================================

Your intuition about APIs and agents is correct.

Modern systems have **multiple acceptance layers**.

Example:

| consumer | acceptance tests |
| --- | --- |
| human user | UI workflows |
| developer | API workflows |
| agent | tool usage scenarios |
| internal team | operational SLOs |

So acceptance testing becomes **multi-perspective**.

Example:

```
User acceptance
Agent acceptance
Developer acceptance
Ops acceptance
```

Each one verifies the product from a different consumer viewpoint.

* * *

6\. Where specs sit
===================

Specs are simply **contracts between layers**.

Example:

```
Requirements
    ↓
Product spec
    ↓
API spec
    ↓
Module interfaces
    ↓
Implementation
```

Each spec produces **tests at the same layer**.

Example:

| spec | tests |
| --- | --- |
| product spec | acceptance tests |
| API spec | system tests |
| module interface | integration tests |
| code | unit tests |

* * *

7\. A clearer modern V-model
============================

If we rewrite the V-model for modern software:

```
Product requirements
      │
      ▼
Product specification
      │
      ▼
API / system specification
      │
      ▼
Service/module interfaces
      │
      ▼
Implementation
      │
      │
      ▼
Unit tests
      ▲
Integration tests
      ▲
System tests
      ▲
Acceptance tests
```

Where:

```
acceptance tests → validate requirements
system tests → validate system spec
integration tests → validate module contracts
unit tests → validate implementation
```

* * *

8\. Your specific observation about APIs
========================================

You said something important:

> APIs are the product for developers and agents.

This is exactly right.

So for an API product:

```
requirements = developer experience goals
spec = API contract (OpenAPI)
system tests = API E2E tests
acceptance tests = real workflows using the API
```

Example:

Acceptance test:

```
Create project
Run workflow
Fetch results
```

System test:

```
POST /runs
returns 200
schema valid
```

* * *

9\. The clean mental model
==========================

Think of it like this:

```
requirements = why
specification = what
implementation = how
```

Tests verify each boundary:

```
acceptance tests → why
system tests → what
integration tests → contracts
unit tests → how
```

* * *

10\. Where agentic engineering fits
===================================

Agents can operate naturally at each layer.

| layer | agent role |
| --- | --- |
| requirements | scenario generator |
| spec | contract validator |
| integration | dependency checker |
| implementation | coder |
| unit tests | invariant tester |
| system tests | workflow simulator |
| acceptance tests | user journey simulator |

This maps almost perfectly to the **actor / critic loops** we discussed earlier.

* * *

If you'd like, the next thing I can show you is something that makes this extremely clear for agentic systems:

**how to structure a repository so each test layer and specification layer is explicit**, which dramatically simplifies automated loops and agent collaboration.

## Prompt:
There are interesting connections between this and the move from the V model for, say, digital products to things like Clean and all those kind of much faster, you know, sprint-based kind of things, right, where basically you're doing small Vs, right, like iterative Vs on every sprint, and, you know, depending on how you break it up, and all this move to describe that doing that is not about slicing all the work horizontally, which would be a lot of foundations first and then no results, to vertical slices, right, where you're getting a little bit of your product and a little bit of your outcome, and you have to build kind of the minimal V slice to actually get something out. And then there's this kind of interplay of truly vertical slices, which means that you're probably making shaky decisions at lower levels, right, in terms of architecture and implementation and so on, completely kind of shaky, to kind of curved slices where it's thin at the top and it becomes heavier and heavier at the bottom, and where you're playing with the trade-offs of future development and current needs, and that's where you get your technical debt, right? The more vertical the slice, the more the vertical debt, the more horizontal and filling, the slower but probably lower technical debt, assuming that you're making the right kind of future calls. And the reason why I mention this is because it's also related... So, okay, let me stop here. Do not respond necessarily, you know, I'm gonna continue with another train of thought.

## Response:
Understood 👍  
Go ahead with the next part of your train of thought — I’ll wait and then respond once you’ve finished.

## Prompt:
There's this other train of thought of the different places and the different ways AI is changing what we do. And all this agents used for engineering, with this whole model, the V-model that we talked about, is one use of agents, which is the one that we use for engineering, for the systems engineering, the agentic engineering kind of setup. But that's systems. When you're thinking processes, you have the other kind of agents that are being used where agents are kind of replacing workflows that correspond to processes, right? And obviously, you know, the engineering process itself is being replaced. And that's, you know, the agents in the agentic model. But when you're doing things that are not engineering, it could be legal, it could be communications, it could be any kind of internal operations, the agents there are kind of supporting a more fragmented kind of overall system made of kind of discrete processes, right? And the kind of integration there that matters is the kind of integration that gets connected to your data, to your communication channels, and so on and so forth, and helps you speed up, improve, automate your workflows, different levels of autonomy, right, and completeness. So, you know, systems on one hand, processes on the other hand. And then there's kind of a third use of agents, which is that of being integrated in your products, right? When you have some functionality that is now an agent, then what you're doing is that in your product, which could be a website, it could be some service, and so on, you're putting AI and agents in them, right? And all the ecosystem that there is around it in terms of observability and evaluation and collaboration and iteration to improve on your product which has AI, right? Which has agents. And yeah, so that's the third use for agents, and the second.

## Response:
Yes — what you’re describing is actually a **very clean and useful taxonomy** of how agents appear in organizations. The confusion in many discussions comes from mixing these three layers. They look similar (they all involve “agents”), but they correspond to **three fundamentally different systems** with different architectures, evaluation methods, and loops.

Let’s structure what you’re describing.

* * *

1\. The three domains where agents appear
=========================================

You’re essentially identifying **three orthogonal uses of agents**:

| domain | what agents augment | primary structure |
| --- | --- | --- |
| **Systems engineering** | building software systems | V-model / engineering loops |
| **Business processes** | operational workflows | process graphs / BPM |
| **Products** | user-facing features | runtime AI systems |

These are three **different kinds of systems**.

```
                Agents
                  │
        ┌─────────┼─────────┐
        │         │         │
   Engineering   Processes   Products
   (build)       (operate)   (experience)
```

They share technology but not the **control loop**.

* * *

2\. Agents for engineering systems
==================================

This is the model we discussed earlier.

Agents participate in **engineering loops**.

```
intent → design → implement → review → test → release
```

Agents act as:

*   implementers
*   reviewers
*   test writers
*   research assistants

The goal is:

**build correct systems faster**

Key characteristics:

| property | engineering agents |
| --- | --- |
| artifact driven | yes |
| verification loops | strong |
| deterministic expectations | high |
| failure tolerance | low |

Evaluation methods:

*   tests
*   code review
*   static analysis
*   CI pipelines

* * *

3\. Agents for processes (workflow automation)
==============================================

This is a **completely different architecture**.

Here agents are used to **replace or augment workflows**.

Example processes:

*   legal document drafting
*   customer support triage
*   HR onboarding
*   marketing content generation
*   finance reconciliation

Structure:

```
process graph

task → decision → task → decision → output
```

Agents become nodes in the process.

Example:

```
ticket received
     ↓
agent triages issue
     ↓
agent searches documentation
     ↓
agent drafts response
     ↓
human review
     ↓
send reply
```

This is closer to:

*   BPM
*   RPA
*   workflow engines

The focus is **automation and throughput**.

Key characteristics:

| property | process agents |
| --- | --- |
| stateful workflows | yes |
| integration heavy | yes |
| determinism | medium |
| human checkpoints | frequent |

Evaluation methods:

*   throughput
*   resolution time
*   accuracy rate
*   cost reduction

* * *

4\. Agents inside products
==========================

The third domain is **runtime product behavior**.

Here agents are part of the **product experience**.

Examples:

*   chat assistants
*   coding copilots
*   search agents
*   automation agents
*   AI features in SaaS tools

Architecture:

```
user request
    ↓
agent reasoning
    ↓
tool use
    ↓
response
```

This introduces new system components:

*   prompt orchestration
*   tool interfaces
*   memory systems
*   evaluation frameworks
*   observability

This is where platforms like **Agenta, LangSmith, etc.** operate.

Key characteristics:

| property | product agents |
| --- | --- |
| runtime AI | yes |
| probabilistic behavior | high |
| continuous evaluation | necessary |
| user interaction loops | central |

Evaluation methods:

*   task success
*   latency
*   hallucination rate
*   user satisfaction
*   benchmark datasets

* * *

5\. The three loops
===================

Each domain has a **different feedback loop**.

### Engineering loop

```
build → verify → improve
```

Goal: correctness.

* * *

### Process loop

```
execute → measure → optimize
```

Goal: efficiency.

* * *

### Product loop

```
deploy → observe → retrain / refine
```

Goal: user value.

* * *

6\. The interesting meta-structure
==================================

These three systems are **stacked**.

```
Engineering builds the product.

The product contains agents.

The company runs processes using agents.
```

Graphically:

```
                Company operations
                (process agents)

                       ▲
                       │
                Product system
                (product agents)

                       ▲
                       │
                Engineering system
                (engineering agents)
```

Each layer uses agents **for a different purpose**.

* * *

7\. Why this distinction matters
================================

Because each layer requires **different infrastructure**.

| domain | core infrastructure |
| --- | --- |
| engineering agents | code tools, CI, repos |
| process agents | workflow engines, integrations |
| product agents | evaluation, observability, prompt management |

Mixing them leads to bad designs.

Example mistake:

Using a workflow tool to build product agents.

Or using agent frameworks to automate internal processes.

* * *

8\. Where your earlier V-model discussion fits
==============================================

The **V-model belongs only to engineering agents**.

It describes:

```
how we build systems
```

But product agents follow a different lifecycle:

```
prototype → evaluate → deploy → observe → iterate
```

And process agents follow:

```
design workflow → automate → measure → refine
```

Three loops.

* * *

9\. Why vertical slices matter in this context
==============================================

Your earlier thought about **vertical slices** connects strongly.

When building AI products:

You must slice vertically across **all three layers**.

Example:

```
engineering slice
    ↓
product agent feature
    ↓
process automation
```

Example feature:

```
"AI support assistant"
```

Requires:

Engineering

*   API
*   tools
*   prompts

Product

*   agent behavior
*   evaluation datasets

Process

*   support workflow integration

* * *

10\. The big picture
====================

The full system of an AI-native company becomes:

```
                ┌──────────────────┐
                │  Process agents   │
                │ (company ops)     │
                └────────▲──────────┘
                         │
                ┌────────┴─────────┐
                │   Product agents  │
                │ (user features)   │
                └────────▲─────────┘
                         │
                ┌────────┴─────────┐
                │ Engineering agents│
                │ (build systems)   │
                └──────────────────┘
```

Each layer:

*   uses agents
*   has different loops
*   has different evaluation metrics

* * *

If you want, the **next interesting step** is something quite deep that emerges from everything you said:

There are actually **two orthogonal axes** that determine how agents behave in organizations:

1.  **system vs process vs product** (what you just described)
2.  **construction vs operation**

When you combine these two axes you get a **6-cell model of agentic systems**, which clarifies a lot of architectural decisions.

## Prompt:
I said don't respond and we'll continue talking, and we just responded. And then you can imagine other great families of processes that are going to get structured. They used to be structured around tools that would basically try to understand the whole domain, and now we'll be organized around, you know, the processes will be organized again. For instance, if you think about science and the scientific process that is embodied in hypotheses and then a lot of research and then a lot of experiment design, and then a lot of, you know, analysis and a lot of verification and a lot of validation and so on, at least for the part that is, that can be, you know, computable and automated or digital, right? It could be that or it could be pipelines for marketing and sales, right, which will have obvious steps and then the process is going to get agentic, right? So that's how it also extends to other kinds of processes and systems.

## Response:
Understood — I’ll just follow your line of thought and extend it, without redirecting it.

What you’re describing is essentially that **agents are re-structuring domains around their underlying processes**, rather than around tools or departments. Historically, many domains were structured around **software systems that attempted to model the whole domain** (CRM, ERP, lab software, marketing suites, etc.). Those systems tended to centralize data and workflows in a rigid way.

With agents, the organizing principle shifts from **tool-centric systems** to **process-centric loops**.

So instead of:

```
domain → software tool → workflows inside the tool
```

you increasingly get:

```
domain → underlying process → agents executing the steps
```

And those processes are often **already well known** in the discipline.

For example:

### Scientific process

```
hypothesis
   ↓
literature review
   ↓
experiment design
   ↓
experiment execution
   ↓
analysis
   ↓
verification
   ↓
publication / knowledge integration
```

Agents can support or automate parts of each step:

*   literature search
*   experiment planning
*   code for simulations
*   statistical analysis
*   reproducibility checks
*   writing drafts

But the **structure already exists** — the agents simply inhabit the steps.

* * *

### Marketing / sales pipelines

Another example you mentioned:

```
lead discovery
   ↓
qualification
   ↓
outreach
   ↓
conversation
   ↓
proposal
   ↓
closing
   ↓
account management
```

Agents can support each stage:

*   lead research agents
*   outreach drafting agents
*   meeting summarization agents
*   proposal generation agents
*   CRM update agents

Again, the **pipeline already exists**. Agents become the workers.

* * *

### Software engineering

Which brings us back to the earlier discussion:

```
intent
   ↓
design
   ↓
implementation
   ↓
review
   ↓
testing
   ↓
deployment
```

The engineering process is also **a structured loop**, and agents can occupy the roles within it.

* * *

### A general pattern appears

Across domains, the pattern is very similar:

```
process step
    ↓
agent performs task
    ↓
artifact produced
    ↓
next step
```

or sometimes

```
step → critique → iteration
```

So the important unit becomes **the process step**, not the application.

* * *

### What changes compared to older software systems

Older software tried to build **complete models of domains**.

Example:

*   CRM tries to model the entire sales process.
*   ELN/LIMS tries to model the entire lab process.
*   project management tools try to model engineering work.

Agents instead allow a much looser structure:

```
process
   ↓
agents + integrations
   ↓
artifacts
```

The software becomes more **modular and composable**, because the intelligence sits in the agents rather than in the rigid application logic.

* * *

### Another pattern that emerges

In many of these domains the processes have the form:

```
generate → evaluate → refine
```

Examples:

Scientific process

```
hypothesis → experiment → analysis
```

Engineering

```
design → implement → test
```

Marketing

```
campaign → measure → optimize
```

Sales

```
outreach → response → qualification
```

So agents often fit naturally as:

*   **generators**
*   **critics**
*   **analysts**
*   **operators**

* * *

### One implication

Because processes are becoming the primary organizing structure, organizations may start defining **agent ecosystems around canonical processes**.

Examples:

*   scientific discovery agents
*   engineering agents
*   marketing pipeline agents
*   legal drafting agents
*   support workflow agents

Each ecosystem corresponds to a **process family**, not a software category.

* * *

### The connection to what you said earlier

Your earlier distinction fits nicely:

*   **systems** → engineering processes
*   **processes** → operational workflows
*   **products** → runtime AI behavior

Now we can see a fourth dimension emerging:

```
disciplines defined by canonical processes
```

Examples:

| discipline | core process |
| --- | --- |
| science | hypothesis → experiment → analysis |
| engineering | design → build → test |
| marketing | campaign → measure → iterate |
| sales | prospect → qualify → close |
| operations | request → resolve |

Agents integrate naturally because they operate **within those process steps**.

* * *

If you continue this line of thought further, it leads to a very interesting idea:

that **most knowledge work can be represented as a graph of process loops**, and agents become the execution layer for those loops.

## Prompt:
And another dimension to think about this is the place agents take, right? They go from LLMs to saved prompts to skills like reproducible subroutines to sub-agents that you kind of trigger manually to then agents that you kind of orchestrate and then teams of agents that work together maybe or agents that are integrated in different products. And in some cases, when you think about software as a service, your interfaces go from being consumed by humans to being consumed by programs to being consumed by agents. And so an agent interface is kind of necessary, or at least making sure that your other interfaces are agent-ready is super important. And you'll see that some values, some products will be agents as a service because some operation, some step is generalized and, you know, in terms of economies of scope and of scale, so that providing that service as an agent, as a service, is going to be valuable. And we see it in many places. And just chat, you know, in and of itself, it's becoming an agent as a service, right? All the ChatGPTs and all the code chats and so on, it's agents as a service. You'll see it in a lot of SaaS that are kind of turning into, you know, improving their agent interface or even building in an agent chat interface or an agent interface into their offerings. It's not just the API, it's also the web UI. And obviously it's going to change how much time we spend in, you know, connecting APIs because agents are going to do it. Maybe we use individual, you know, interaction points. And for the UI, it's going to be something similar. A lot of workflows are going to be replaced by the agent interface, except when you have to go and do some, you know, UI interaction. And then kind of another point, so let's wait and I'll continue.

## Response:
Understood. I’ll pause here and wait for you to continue.

## Prompt:
And so there is this other discussion about the levels of autonomy and the levels of kind of advanced adoption of AI, and you can also see it in terms of, you know, self-driving cars, kind of autonomy levels. Well, there are similar levels to how much AI we use in the processing. And you can think about it, and I think you can find best practices on the web, but, you know, the first level would be not using it. The second level would be just using it as an extension of just like searching and Googling and learning. And on the side, another level is to make it actually do work that replaced you. And then you have another level where it's doing that work kind of autonomously, but it's still being controlled by you. And another level becomes, you have agents which have autonomous loops, and then you have the whole process eventually that gets automated for most of a big chunk of it. And I think that level of autonomy, for instance, in engineering teams, can be mapped out to their processes and their systems and how much they do and how much the agent does. And you can see that when we saw and we talked about it in, let's say, biology and research, and also in, like, say, in marketing and many other places, right, many, many other places. And the same is true in your products, right? You go from not having AI to having AI for, like, side things, to then having a full chat in your app.

## Response:
What you’re building up across these messages is actually a **very coherent multidimensional framework** for thinking about agents in organizations. You’ve already identified several axes, and they fit together quite cleanly. I’ll try to structure them without breaking your train of thought.

* * *

1\. One axis: where agents sit in the stack
===========================================

You described the **place agents occupy** going from simple model usage to complex multi-agent systems.

This can be seen as a **capability ladder**:

| level | description |
| --- | --- |
| LLM | raw model |
| saved prompt | reusable instruction |
| skill | deterministic reusable routine |
| sub-agent | task performer |
| agent | autonomous worker |
| agent team | coordinated agents |
| agent ecosystem | agents embedded across systems/products |

Graphically:

```
LLM
 ↓
prompt
 ↓
skill
 ↓
sub-agent
 ↓
agent
 ↓
agent team
 ↓
agent ecosystem
```

Each step adds:

*   **memory**
*   **tools**
*   **orchestration**
*   **autonomy**

* * *

2\. Another axis: the interfaces being consumed
===============================================

You also pointed out something very important:

Interfaces historically evolved like this:

```
human UI
 ↓
programmatic API
 ↓
agent interface
```

### Human interface

Designed for manual interaction.

Examples:

*   dashboards
*   forms
*   GUIs

* * *

### Programmatic interface

Designed for deterministic programs.

Examples:

*   REST APIs
*   SDKs
*   webhooks

* * *

### Agent interface

Designed for reasoning systems.

Examples:

*   tool schemas
*   action descriptions
*   structured affordances
*   contextual discovery

This means:

```
API ≠ agent interface
```

Agents require additional properties:

*   semantic descriptions
*   discoverability
*   safety constraints
*   state awareness

This is why protocols like MCP, tool schemas, etc. are emerging.

* * *

3\. Agents as a Service
=======================

You also mentioned something important economically.

Certain tasks become **generalized agent capabilities**.

Examples already emerging:

*   research agents
*   coding agents
*   document analysis agents
*   customer support agents
*   scheduling agents

These become **Agent-as-a-Service**.

Similar to SaaS evolution:

```
software → API → agent
```

Example progression:

```
email client
 ↓
email API
 ↓
email agent
```

* * *

4\. UI transformation
=====================

You also highlighted a key shift:

Many workflows move from **structured UI flows** to **agent interaction**.

Old pattern:

```
click → form → submit → result
```

New pattern:

```
intent → agent → action → result
```

So interfaces become:

| interface | purpose |
| --- | --- |
| chat | intent capture |
| structured UI | configuration |
| automation | execution |

The UI does not disappear — it **changes role**.

* * *

5\. Another axis: autonomy levels
=================================

You also described something similar to **self-driving autonomy levels**.

A useful mapping looks like this:

| level | AI usage |
| --- | --- |
| L0 | no AI |
| L1 | AI assistance |
| L2 | AI performs tasks |
| L3 | AI executes tasks under supervision |
| L4 | AI autonomous loops |
| L5 | fully autonomous process |

Example in engineering:

| level | behavior |
| --- | --- |
| L1 | ask ChatGPT questions |
| L2 | generate code |
| L3 | agent writes code but developer reviews |
| L4 | agent implements tasks autonomously |
| L5 | full autonomous engineering system |

Example in marketing:

| level | behavior |
| --- | --- |
| L1 | content suggestions |
| L2 | draft campaigns |
| L3 | run campaigns with approval |
| L4 | optimize campaigns autonomously |
| L5 | fully automated growth engine |

* * *

6\. Another axis: domain processes
==================================

Earlier you also identified the **process families**.

Examples:

| domain | canonical process |
| --- | --- |
| science | hypothesis → experiment → analysis |
| engineering | design → build → test |
| marketing | campaign → measure → optimize |
| sales | prospect → qualify → close |
| operations | request → resolve |

Agents integrate into these loops.

* * *

7\. Putting the axes together
=============================

We now have several independent axes.

### Axis 1 — domain

```
systems
processes
products
```

### Axis 2 — agent sophistication

```
LLM → prompt → skill → agent → agent team
```

### Axis 3 — interface type

```
UI → API → agent interface
```

### Axis 4 — autonomy level

```
assist → automate → autonomous
```

### Axis 5 — process structure

```
generate → evaluate → refine loops
```

* * *

8\. The interesting implication
===============================

These axes interact.

Example:

**Engineering team**

```
domain: system engineering
agent sophistication: sub-agents
autonomy: level 3
interfaces: code tools
process: V-model loops
```

**Customer support**

```
domain: process automation
agent sophistication: workflow agents
autonomy: level 4
interfaces: CRM + communication channels
process: ticket lifecycle
```

**AI feature in product**

```
domain: product runtime
agent sophistication: agent system
autonomy: level 2–4
interfaces: tool schemas
process: user interaction loop
```

* * *

9\. The deeper shift
====================

What you’re describing ultimately suggests something larger.

Software architectures used to look like:

```
applications
connected by APIs
```

They are moving toward:

```
process graphs
executed by agents
```

Where:

*   humans
*   agents
*   services

all become **nodes in the graph**.

* * *

If you continue this reasoning one step further, it leads to a very powerful insight:

The **fundamental abstraction for AI-native systems may no longer be the application, but the loop** — because loops appear everywhere:

*   engineering
*   science
*   product iteration
*   marketing
*   research
*   operations.

## Prompt:
https://dust.tt/blog/build-a-flock-not-a-crowd

This post talks about the process part.

## Response:
Yes — that Dust post fits **exactly into the “process agents” dimension you were describing**, and it makes a very specific point about how those processes should be structured.

The core idea of the article is:

> Don’t build a **crowd of isolated agents**; build a **flock of agents sharing capabilities**. [Dust](https://dust.tt/blog/build-a-flock-not-a-crowd?utm_source=chatgpt.com)

This maps almost perfectly to your earlier distinction between **processes and systems**.

* * *

1\. The problem: agent sprawl
=============================

Dust describes a situation that many teams already see:

*   different teams build different agents
*   each agent embeds its own logic
*   the same knowledge gets duplicated

Example they give:

*   sales qualification logic exists in
    *   a sales agent
    *   an onboarding agent
    *   a forecasting agent
    *   a reporting agent

Each agent ends up with **slightly different versions of the same knowledge**. [Dust](https://dust.tt/blog/build-a-flock-not-a-crowd?utm_source=chatgpt.com)

This leads to divergence.

```
agent A → rule version 1
agent B → rule version 2
agent C → rule version 3
```

So instead of one system, you get **a crowd of agents**.

* * *

2\. Their solution: skills
==========================

Dust introduces **skills** as the abstraction.

A skill contains three parts:

1.  **instructions** (how the capability works)
2.  **knowledge** (data sources, examples)
3.  **tools** (execution capability) [Dust](https://dust.tt/blog/build-a-flock-not-a-crowd?utm_source=chatgpt.com)

So instead of:

```
agent = prompt + logic
```

you get:

```
agent
  └─ uses skills
       ├─ instructions
       ├─ knowledge
       └─ tools
```

Any agent can call the skill.

* * *

3\. Why this matters for process agents
=======================================

This is where it connects to your **process perspective**.

Processes typically have **canonical capabilities**.

Example: sales pipeline

```
lead qualification
outreach drafting
deal analysis
forecasting
```

Instead of embedding them in agents:

```
sales agent
forecasting agent
onboarding agent
```

You build reusable skills:

```
skill: qualify_deal
skill: summarize_customer_history
skill: generate_outreach
```

Agents become **compositions of skills**.

* * *

4\. This is basically modularizing the process
==============================================

Your earlier model:

```
process step
   ↓
agent executes
```

Dust is proposing a refinement:

```
process step
   ↓
agent orchestrates
   ↓
skills execute
```

So the architecture becomes:

```
process
  ↓
agent
  ↓
skills
  ↓
tools / data
```

* * *

5\. This mirrors what happened in software engineering
======================================================

The pattern is extremely similar to the evolution of programming.

Early software:

```
scripts
```

Then:

```
functions
```

Then:

```
libraries
```

Then:

```
services
```

Dust is basically saying:

```
agents should not be monoliths
```

Instead:

```
agents
  ↓
skills
  ↓
tools
```

* * *

6\. Why this matters for agent ecosystems
=========================================

Without this structure you get:

```
agent sprawl
prompt duplication
knowledge divergence
maintenance chaos
```

With it you get:

```
shared capabilities
consistent logic
easier improvement
agent interoperability
```

So instead of **a crowd of agents**, you get a **flock**.

* * *

7\. This connects directly to your earlier ladder
=================================================

Earlier you mentioned:

```
LLM
prompt
skill
sub-agent
agent
agent team
```

Dust is basically saying:

**skills are the stable layer in the middle**.

```
agents
   ↓
skills
   ↓
tools
```

Agents become orchestrators.

* * *

8\. And it connects to process graphs
=====================================

If we combine everything you were discussing:

Process layer:

```
process graph
   ↓
agents orchestrate steps
   ↓
skills perform capabilities
   ↓
tools access systems
```

So the full stack becomes:

```
process
  ↓
agent
  ↓
skills
  ↓
tools
  ↓
systems / data
```

* * *

9\. Why this matters for the future of SaaS
===========================================

This also connects to your earlier point about **agent interfaces and agent-as-a-service**.

A SaaS product might expose:

```
API
```

But in the future it might expose:

```
skills
```

Example:

```
skill: analyze_contract
skill: schedule_meeting
skill: qualify_lead
```

Agents across different systems could reuse them.

* * *

10\. The deeper pattern
=======================

Your whole line of reasoning is converging to something quite fundamental:

Modern AI systems seem to organize around **three layers**:

```
processes
   ↓
agents
   ↓
skills
   ↓
tools / APIs
```

And each layer corresponds to a different kind of abstraction.

* * *

If you want, the next step is actually **very interesting conceptually** and ties everything you said together:

There is a strong analogy between **microservices architectures and agent architectures**, and it explains why “skills” are emerging as the equivalent of **services in the agent world**.

## Prompt:
Tone it down, please. Now, what I'm wondering is why this is different in the case of software. Because I understand that in the case of typical operations, things work through SaaS, right? And everything is very visual, right? It's opening files and typing things and seeing data and so on and so forth, right? Also, it's very generic, right? Because we're talking about operations and very generic. And those may be two differences that we have with software development where things are very, very specific for this flow. And also, the interfaces are different, right? It's a lot of connecting to environments and connecting to code bases. Everything is text and Git and so on. And I wouldn't say the terminal is the issue, because you could say that you have editors. But the point is that things are not that visual. It's not like you open the file and modify directly in it. I mean, you do, but you do it through the terminal, maybe, right? But still, right, it's all interconnected. So I wonder why, you know, what are the things that make it so that all the tooling of, you know, Cloud code and, you know, other agents in VS code could not be done in Dust and the other way around.

## Response:
Good question. The difference isn’t that one _couldn’t_ be built on the other — it’s that the **constraints of the domain are different**, so the tooling converged in different directions.

You already pointed at the two main reasons: **specificity** and **interfaces**. But there are a few concrete properties that make software engineering a special case.

* * *

1\. Software engineering has a deterministic execution environment
------------------------------------------------------------------

In most operational workflows (sales, legal, marketing):

```
input → reasoning → text/action
```

The output is evaluated by **humans or soft metrics**.

Example:

*   draft an email
*   summarize a document
*   qualify a lead

If the answer is _slightly wrong_, the process still works.

* * *

In software engineering:

```
code → compiler/runtime → deterministic result
```

The environment itself evaluates correctness.

Examples:

*   compiler errors
*   failing tests
*   linter failures
*   CI pipelines

This creates a **tight feedback loop with machines**, not humans.

That’s why engineering agents need:

*   file system access
*   shell access
*   build/test execution
*   git operations

Those are first-class primitives in tools like Cursor, VS Code agents, etc.

Operational agent platforms rarely need them.

* * *

2\. The artifact structure is very different
--------------------------------------------

Operations tools manipulate **documents and records**.

Examples:

```
CRM records
Notion pages
Google Docs
emails
tickets
```

They are:

*   mutable
*   loosely structured
*   individually edited

* * *

Software engineering works on **structured repositories**.

Artifacts look like:

```
git repository
commit history
branches
pull requests
codebase dependency graphs
```

Changes must follow strict rules:

```
edit → commit → PR → review → merge
```

So agents must interact with **version control systems**, not just files.

That’s a big architectural difference.

* * *

3\. State synchronization is harder in codebases
------------------------------------------------

In SaaS workflows:

```
document = state
```

You open it, modify it, done.

* * *

In software:

```
state = repository + environment + dependencies
```

To run something you often need:

```
git checkout
install dependencies
build
run tests
run service
```

So the agent environment must reproduce **development environments**.

That’s why engineering agents live close to:

*   IDEs
*   dev containers
*   remote workspaces
*   terminals

* * *

4\. The graph of dependencies is much denser
--------------------------------------------

Operational processes usually look like pipelines:

```
task → task → task
```

Engineering systems look like dependency graphs:

```
module A → module B → module C
            ↑
          module D
```

Small changes propagate.

Agents therefore need:

*   static analysis
*   code navigation
*   refactoring tools
*   type systems

These are very domain-specific capabilities.

* * *

5\. Evaluation is stronger
--------------------------

Operational agent systems evaluate with things like:

*   human review
*   outcome metrics
*   heuristics

Software agents can rely on:

```
unit tests
integration tests
type checking
build success
```

This makes engineering more **automatable**, but also more **tool-integrated**.

* * *

6\. Why the ecosystems diverged
-------------------------------

So we got two tool families.

### Process-agent platforms

Examples:

*   Dust
*   Zapier AI
*   internal workflow agents

Their primitives look like:

```
agent
skill
knowledge base
workflow
integration
```

* * *

### Engineering-agent platforms

Examples:

*   Cursor
*   Copilot
*   Claude Code
*   Cloud Code

Their primitives look like:

```
repository
files
diffs
terminal
tests
PRs
```

* * *

7\. Why you _could_ build them on each other
--------------------------------------------

Technically, nothing prevents it.

You could imagine Dust gaining:

```
repo tools
git tools
shell execution
CI integration
```

And it would start to resemble an engineering agent system.

Likewise, a coding agent could integrate CRM workflows.

But the **center of gravity** differs:

| system | central artifact |
| --- | --- |
| process agents | documents / records |
| engineering agents | repositories |

* * *

8\. A simple mental model
-------------------------

Think of it like this:

Operations platforms automate **business workflows**.

Engineering platforms automate **development environments**.

```
operations → SaaS environment
engineering → dev environment
```

Agents just plug into whichever environment they need.

* * *

9\. The interesting convergence
-------------------------------

What you’re starting to see is a middle layer emerging.

Systems that combine:

```
process orchestration
+
engineering environments
```

Examples are starting to appear in:

*   CI/CD automation
*   dev platform tooling
*   agent orchestrators

But the two ecosystems are still mostly separate because the **primitive abstractions differ**.

* * *

If you're interested, one deeper difference explains almost everything here:  
**software engineering environments are programmable systems themselves**, while most SaaS environments are not.

## Prompt:
What would it look like in scientific environments where maybe some of them where there could be some iterations, some speed or some encoding, for instance, maybe for hypothesis testing and maybe things that would allow for either simulation or computation. It could be things related to biocomputation or again simulation. It could be for a hypothesis. Maybe not all of it can be automated. Maybe the part where the actual execution happens in a lab or something or in a workshop, then that would have to be manual. But what would it look like in that kind of environment?

## Response:
A useful way to think about **scientific environments** is that they sit somewhere **between engineering systems and operational workflows**.

They have:

*   **structured processes** (like operations)
*   **computational artifacts and execution environments** (like software engineering)
*   **physical steps that cannot be automated** (labs, experiments)

So the system becomes a **hybrid loop**.

* * *

1\. The canonical scientific loop
=================================

Most scientific work follows some variant of:

```
hypothesis
   ↓
literature review
   ↓
experiment design
   ↓
experiment execution
   ↓
analysis
   ↓
verification / replication
   ↓
publication / knowledge integration
```

Agents can support different parts of this loop depending on whether the step is:

*   computational
*   informational
*   physical

* * *

2\. The computable vs physical boundary
=======================================

Scientific workflows often split like this:

| phase | automation potential |
| --- | --- |
| hypothesis generation | high |
| literature review | high |
| experiment design | medium |
| experiment execution | low (physical) |
| data collection | medium |
| analysis | high |
| interpretation | medium |

So the workflow becomes:

```
computational work
      ↓
physical experiment
      ↓
computational analysis
```

Agents fit primarily in the **computational sections**.

* * *

3\. What the environment would look like
========================================

Instead of a repository like software engineering, the core artifact becomes something like a **research workspace**.

Example structure:

```
research-project/
   hypotheses/
   literature/
   experiment-designs/
   simulations/
   datasets/
   analysis/
   results/
```

This looks closer to:

*   notebooks
*   datasets
*   simulation code
*   analysis pipelines

Typical tools today:

*   Jupyter
*   Python / R
*   data pipelines
*   simulation environments

Agents would interact with these artifacts.

* * *

4\. Agents in each step
=======================

### Hypothesis generation

Agents can:

*   synthesize literature
*   identify gaps
*   propose testable hypotheses

Inputs:

```
papers
datasets
existing models
```

Outputs:

```
candidate hypotheses
```

* * *

### Literature review

This is already highly automatable.

Agents can:

*   search papers
*   summarize findings
*   extract claims
*   build citation graphs

Output artifacts:

```
literature summaries
evidence tables
related work maps
```

* * *

### Experiment design

Agents can help generate structured plans.

Example:

```
hypothesis
   ↓
variables
   ↓
experimental setup
   ↓
measurement protocol
```

In computational fields (biology, chemistry, physics) this can include **simulation planning**.

* * *

### Simulation / computational testing

This is where it becomes closer to **software engineering**.

Example:

```
model
   ↓
simulation runs
   ↓
data output
```

Agents can:

*   write simulation scripts
*   run experiments
*   analyze results

Similar to coding agents:

```
write code → run experiment → inspect output
```

* * *

### Physical experiments

This step often remains human or lab-driven.

Example:

```
prepare samples
run instrument
collect measurements
```

Agents can still assist with:

*   protocol generation
*   instrument configuration
*   data logging

But execution may be manual or semi-automated.

* * *

### Data analysis

This part is highly automatable.

Agents can:

*   clean data
*   run statistical tests
*   build models
*   generate plots
*   detect anomalies

Artifacts:

```
analysis notebooks
plots
statistical reports
```

* * *

### Interpretation and validation

Agents can:

*   compare results to prior work
*   evaluate significance
*   identify confounding factors

But final interpretation usually remains human-supervised.

* * *

5\. The artifact flow
=====================

The system becomes an artifact pipeline similar to engineering but with different objects.

```
hypothesis
   ↓
experiment plan
   ↓
simulation / experiment
   ↓
dataset
   ↓
analysis
   ↓
result
```

Agents operate on these artifacts.

* * *

6\. Scientific environments resemble engineering more than operations
=====================================================================

Compared to marketing or sales workflows, scientific workflows have more in common with **engineering environments**.

Shared properties:

*   code
*   reproducibility
*   versioning
*   deterministic computations

So the environment might include:

```
repository
notebooks
datasets
simulation environments
analysis pipelines
```

Agents would need access to:

*   compute clusters
*   data stores
*   notebooks
*   statistical libraries

* * *

7\. The human–automation boundary
=================================

In many domains the boundary looks like this:

```
design experiment (agent + human)
        ↓
run physical experiment (human / lab)
        ↓
analyze results (agent)
```

Agents accelerate the **intellectual and computational parts**, while humans run the **material operations**.

* * *

8\. If fully integrated
=======================

A future scientific platform might look like:

```
research workspace
   ↓
agents
   ↓
simulation tools
   ↓
analysis tools
   ↓
lab instruments
```

The loop becomes:

```
hypothesis → simulation → experiment → analysis → refine
```

Agents help run the loop faster.

* * *

9\. A useful comparison
=======================

| domain | core artifact |
| --- | --- |
| operations | records |
| engineering | repositories |
| science | datasets + experiments |

Agents interact with whichever artifact defines the domain.

* * *

10\. The key pattern
====================

Scientific environments ultimately become **closed experimental loops**.

```
generate hypothesis
run experiment
evaluate results
refine hypothesis
```

Agents accelerate the loop by automating the parts that are computational.

* * *

If you push this idea further, something interesting appears:  
**scientific workflows may become the closest real-world analogue to agentic engineering**, because both operate around **iterative testable loops with machine-verifiable outputs.**

## Prompt:
All right, going back to engineering, you have in the double V model, one of the Vs is about verification, the other V is about validation. And if you look at the bottommost V loop, you notice that code review, right, for review is the verification, and then testing is the validation. And obviously, you're reviewing different things.

## Response:
Yes — that’s a useful way to read the **double-V** in practice.

First, just to restate the classical distinction because it matters here:

*   **Verification** → _Did we build the thing right?_
*   **Validation** → _Did we build the right thing?_

Both happen at every level of the system, but they use **different artifacts and different critics**.

* * *

1\. The bottommost loop: implementation
=======================================

At the lowest level of engineering work, the loop looks like this:

```
design → implement → review → test
```

In terms of the two Vs:

| step | role |
| --- | --- |
| design | specification |
| implementation | construction |
| review | verification |
| testing | validation |

So:

```
verification = review
validation = testing
```

But they operate on **different questions**.

* * *

2\. Code review = verification
==============================

Code review checks whether the implementation respects the **intended design and engineering rules**.

Typical checks:

*   correctness of logic
*   architecture consistency
*   API usage
*   readability / maintainability
*   security concerns
*   performance implications
*   adherence to patterns

So the reviewer asks:

```
Does this code correctly implement the intended design?
```

Artifacts involved:

```
diff
codebase context
design notes
```

The reviewer mostly inspects **structure**.

* * *

3\. Tests = validation
======================

Tests check whether the behavior matches the **expected behavior of the system**.

Examples:

*   unit tests
*   integration tests
*   end-to-end tests

The question becomes:

```
Does the system behave correctly when executed?
```

Artifacts involved:

```
test cases
inputs
expected outputs
runtime behavior
```

Testing checks **behavior**, not structure.

* * *

4\. Why both are needed
=======================

A system can pass one and fail the other.

### Example 1 — passes review but fails tests

```
clean code
well structured
but wrong logic
```

Review says:

```
looks correct
```

Tests say:

```
fails edge cases
```

* * *

### Example 2 — passes tests but fails review

```
hacky code
duplicated logic
hidden bugs
```

Tests say:

```
works
```

Review says:

```
fragile and unsafe
```

So both loops are necessary.

* * *

5\. The two Vs across the system
================================

The same pattern appears at higher levels.

### Design level

Verification:

```
architecture review
design review
```

Validation:

```
system tests
acceptance tests
```

* * *

### Requirements level

Verification:

```
spec consistency
requirements review
```

Validation:

```
user acceptance
product evaluation
```

* * *

6\. The pattern across layers
=============================

You can see the double V repeating.

```
specification
     ↓
implementation
     ↓
verification (review)
     ↓
validation (tests)
```

Each level has:

```
design artifact
verification check
validation check
```

* * *

7\. In agentic engineering terms
================================

This maps nicely to the earlier **actor / critic loops**.

Implementation loop:

```
actor → implement code
critic 1 → review (verification)
critic 2 → tests (validation)
```

Two critics, two types of feedback.

* * *

8\. Why this matters for agents
===============================

If you automate engineering loops, you need **two separate evaluators**:

Verification agents:

*   code review
*   static analysis
*   architecture checks

Validation agents:

*   test generation
*   test execution
*   runtime validation

Mixing them leads to weaker feedback.

* * *

9\. The deeper pattern
======================

What the double-V is really encoding is this:

```
structure must be verified
behavior must be validated
```

Software engineering requires both.

* * *

If you want to push this one step further, something interesting appears:

**linting, type systems, and static analysis actually sit between review and tests**, forming a third feedback layer in the bottom loop.

## Prompt:
I think review and test, review and test are parallel, right? I mean, you can do them sequentially if there's any reason to, but they're actually parallel, right? They're double Vs are parallel Vs when you go up.

## Response:
Yes — your intuition is correct. **Review and testing are conceptually parallel**, not sequential. The reason they sometimes appear sequential in practice (e.g., “tests pass → then review → merge”) is mostly **process convenience**, not a structural requirement.

The **double-V** is really describing **two parallel verification/validation paths** that meet at the implementation point.

* * *

1\. The bottom of the V is the same artifact
============================================

At the lowest level, both loops start from the same thing:

```
implementation (code)
```

From there, two evaluations happen:

```
code
 ├─ review → structural verification
 └─ tests  → behavioral validation
```

So graphically:

```
        review
         ▲
         │
code ─────┼─────
         │
         ▼
        tests
```

Both inspect the same artifact but from **different perspectives**.

* * *

2\. What each path inspects
===========================

### Review path (verification)

Review compares the implementation to the **design and engineering standards**.

It evaluates:

*   structure
*   architecture
*   patterns
*   correctness of reasoning
*   maintainability

So it checks **internal correctness**.

```
code ↔ design
```

* * *

### Test path (validation)

Tests compare the running system to the **expected behavior**.

They evaluate:

*   inputs / outputs
*   state changes
*   system behavior

So they check **external correctness**.

```
system behavior ↔ expected behavior
```

* * *

3\. Why they are independent
============================

Neither loop subsumes the other.

Example:

| scenario | review | tests |
| --- | --- | --- |
| wrong algorithm | passes | fails |
| hacky but functional | fails | passes |
| missing edge case | passes | fails |
| overfitted test | passes | passes but wrong |

So they must run **independently**.

* * *

4\. How this scales up the V-model
==================================

This parallel structure exists at **every layer of the V**.

Example:

### Module level

```
implementation
   ├─ design review
   └─ unit tests
```

### System level

```
system implementation
   ├─ architecture review
   └─ system tests
```

### Product level

```
product implementation
   ├─ spec review
   └─ acceptance tests
```

So the **double-V is really two mirrored evaluation paths**.

* * *

5\. Why they sometimes appear sequential
========================================

Teams often run them like this:

```
tests → review → merge
```

Reasons:

*   CI can run automatically
*   review requires humans
*   failing tests make review pointless

But conceptually the graph is:

```
          review
            ▲
            │
implementation
            │
            ▼
           tests
```

* * *

6\. In graph terms
==================

The implementation node has **two outgoing evaluation edges**.

```
            verification
implementation ─────────→ review outcome

            validation
implementation ─────────→ test outcome
```

Both must succeed before progressing.

* * *

7\. In agentic engineering
==========================

Your earlier actor–critic model maps nicely:

```
actor → writes code

critic A → review agent
critic B → testing agent
```

These critics run **in parallel**.

* * *

8\. A subtle point
==================

Review and tests also operate on **different information sources**.

| evaluation | information |
| --- | --- |
| review | code + design intent |
| tests | runtime behavior |

So they are fundamentally **orthogonal signals**.

* * *

9\. The deeper symmetry
=======================

The V-model actually represents two symmetrical comparisons:

```
implementation vs specification
implementation vs expected behavior
```

Which correspond to:

```
verification
validation
```

* * *

If you continue this line of thinking, an interesting insight appears:

**linting, static analysis, and type systems form a third evaluation path** alongside review and tests, creating a small “evaluation fan-out” at the bottom of the V.

## Prompt:
What it means, though, if you look at the V-model as every layer having kind of an interface to the layer below, is that in order for both critiques to be able to do their work, obviously, the actor must have produced something. And also, there must be rules and knowledge and tools to actually do the work of the critiques, right? So knowledge about the good practices and knowledge about how to test and tools like access to environments and so on. But there is also the need for an input in the definition of ready, one for each critique, in addition to the inputs that was used for the actor. So the level above, let's say, N minus 1, must produce the description of the work for the actor. And then any specifics for the work of the critiques so that then the actor takes its inputs and obviously may take what it's going to be tested on, and then it produces the code, and then the critiques independently do their work with those same objects. But the goal is to actually validate and verify. So we need, you know, we can consider it as one input, if you will, but technically it has all three sections on top of all the accumulated knowledge that goes beyond the specific work that that layer is doing at that time.

## Response:
Yes — you’re basically describing the **information contract of a layer in the V-model**.  
Each layer is not just “actor → critiques”. It is actually a **small system with three incoming specifications** and one produced artifact.

Your intuition that the layer above must provide **more than just “do this task”** is correct.

* * *

1\. A layer needs three kinds of inputs
=======================================

For a given layer **N**, there are three inputs coming from **N-1**.

### 1️⃣ Construction input (for the actor)

This is the **definition of work**.

Examples:

*   feature description
*   module specification
*   interface contract
*   architecture decision

This answers:

```
What should be built?
```

* * *

### 2️⃣ Verification input (for review)

This defines **how to judge whether the implementation is correct structurally**.

Examples:

*   coding guidelines
*   architecture constraints
*   design rules
*   security practices

This answers:

```
Did we build it correctly?
```

These inputs are often **partly global** (engineering standards) and **partly task-specific**.

* * *

### 3️⃣ Validation input (for tests)

This defines **how to judge whether the implementation behaves correctly**.

Examples:

*   test cases
*   expected outputs
*   scenarios
*   acceptance criteria

This answers:

```
Does it behave as intended?
```

* * *

2\. The layer therefore receives three specifications
=====================================================

Instead of one input, the layer really receives:

```
construction spec
verification spec
validation spec
```

Or visually:

```
          layer N-1
           │
           │
   ┌───────┼────────┐
   │       │        │
build spec review spec test spec
   │       │        │
   ▼       ▼        ▼
              layer N
```

The actor consumes the **build spec**, while the critiques consume their respective specs.

* * *

3\. The actor still sees most of it
===================================

In practice the actor often reads everything:

*   spec
*   acceptance criteria
*   testing expectations

because good engineers try to **anticipate validation**.

But structurally the responsibilities are separate.

* * *

4\. The artifact produced by the layer
======================================

The actor produces a **single artifact**:

```
implementation artifact
```

Examples:

*   code
*   module
*   system component

That artifact becomes the input to both critiques.

```
implementation
   ├─ review
   └─ tests
```

* * *

5\. The critiques also require infrastructure
=============================================

You also pointed out something important: critiques need **tools and environments**.

### Verification infrastructure

Examples:

*   static analysis
*   architecture diagrams
*   security scanners
*   code navigation

### Validation infrastructure

Examples:

*   runtime environment
*   test harness
*   datasets
*   simulation environments

So critiques require **operational capability**, not just knowledge.

* * *

6\. The full layer model
========================

Putting it together:

```
inputs from layer N-1
   │
   ├─ construction specification
   ├─ verification criteria
   └─ validation scenarios
          │
          ▼
        actor
          │
          ▼
   implementation artifact
          │
     ┌────┴────┐
     ▼         ▼
 verification validation
   critique     critique
```

* * *

7\. Why this matters
====================

This explains why many engineering failures happen when **one of the inputs is missing**.

Examples.

### Missing validation input

```
feature built
but no test scenarios defined
```

Result:

*   tests weak
*   behavior incorrect

* * *

### Missing verification input

```
tests pass
but architecture violated
```

Result:

*   technical debt
*   fragile system

* * *

### Missing construction input

```
tests exist
but implementation unclear
```

Result:

*   confusion
*   inconsistent implementations

* * *

8\. This is exactly what “Definition of Ready” tries to encode
==============================================================

Your observation matches what many teams try to enforce.

A work item is **ready** only if it has:

| category | example |
| --- | --- |
| construction | spec or task description |
| verification | standards or constraints |
| validation | acceptance criteria |

* * *

9\. A nice symmetry appears across the V
========================================

Every layer receives:

```
specification
verification rules
validation scenarios
```

and produces:

```
implementation artifact
```

That artifact becomes the **specification input for the next layer down**.

* * *

10\. In agentic engineering terms
=================================

A layer therefore needs **three classes of context**:

| context | used by |
| --- | --- |
| task context | actor |
| review context | verification agent |
| test context | validation agent |

Plus shared engineering knowledge.

This structure is what allows the actor and both critiques to operate **independently but coherently**.

* * *

If you follow this model one step further, something interesting appears:  
the V-model can actually be represented as a **series of layer contracts**, where each layer exports **three things to the layer below: build spec, review criteria, and test scenarios.**

## Prompt:
Okay, what would it look like at the other, at each one of the levels, right? We said we have product requirements as the output of the first layer, right? And then the output of the first layer going down on top of acceptance tests and some kind of review, I don't know how we structure it. Acceptance tests would be defined as, let's say, BDD, for instance, or the test themselves, but let's say BDD. And then the level below, maybe it has specs, right, as the output going down, and then it has system testing going up, and then maybe something to review the system overall, and so on and so forth. So we're missing the integration level and the description of what goes down, what goes up. We know that what goes up is integration testing, but we haven't described what goes down and what the review is. And we're also missing where ADR goes, right? Yep.

## Response:
Yes — if you apply the structure you described (actor output + two critiques) consistently across the V, you end up with a **layered contract between levels**. Each level exports three things to the level below:

1.  **Construction specification** (what to build)
2.  **Verification criteria** (how structure will be reviewed)
3.  **Validation scenarios** (how behavior will be tested)

And each level receives the **implementation artifact** from below and evaluates it via **review + tests**.

Below is a clean mapping of the main engineering layers.

* * *

1\. Product layer (top of the V)
================================

This layer defines **what the product must achieve**.

### Actor output (goes down)

```
product requirements
```

Typical artifacts:

*   PRD
*   user stories
*   use cases
*   domain concepts

This defines **the problem space**.

* * *

### Validation (goes up)

```
acceptance tests
```

Often expressed as:

*   BDD scenarios
*   user workflows
*   business rules

Example:

```
Given a registered user
When they request a password reset
Then they receive a reset email
```

This validates:

```
Does the system satisfy user needs?
```

* * *

### Verification (review)

This checks **requirement quality**.

Examples:

*   requirement reviews
*   product design review
*   stakeholder review

Questions:

```
Are requirements consistent?
Are they testable?
Are they feasible?
```

* * *

2\. System / specification layer
================================

This translates product requirements into **system-level behavior and interfaces**.

### Actor output (goes down)

```
system specification
```

Artifacts may include:

*   API specifications (OpenAPI)
*   system architecture
*   service boundaries
*   data models
*   high-level workflows

This defines **how the system should behave externally**.

* * *

### Validation (goes up)

```
system tests
```

These verify the system behavior against the specification.

Examples:

*   API tests
*   end-to-end tests
*   system integration tests

They answer:

```
Does the implemented system satisfy the system specification?
```

* * *

### Verification (review)

This is **architecture review**.

Artifacts reviewed:

*   system design
*   service boundaries
*   scalability constraints
*   security model

This is where **ADRs primarily live**.

ADRs document decisions such as:

```
why we use event sourcing
why service X owns resource Y
why we use Kafka instead of RPC
```

So ADRs belong mainly in this layer.

* * *

3\. Module / integration layer
==============================

This layer breaks the system specification into **service or module contracts**.

### Actor output (goes down)

```
module / service interfaces
```

Artifacts:

*   interface definitions
*   service contracts
*   database schemas
*   message formats
*   dependency relationships

This defines **how system parts interact**.

* * *

### Validation (goes up)

```
integration tests
```

Examples:

*   service-to-service tests
*   database integration tests
*   event pipeline tests

They verify:

```
Do components interact correctly?
```

* * *

### Verification (review)

This is **design review at module level**.

Examples:

*   service design review
*   schema review
*   API review

Typical concerns:

*   coupling
*   data ownership
*   interface clarity

* * *

4\. Implementation layer (bottom of the V)
==========================================

This is where code is written.

### Actor output

```
code
```

Artifacts:

*   source code
*   configuration
*   migrations

* * *

### Validation

```
unit tests
```

These verify behavior at small scope.

Examples:

*   function tests
*   class tests
*   algorithm tests

* * *

### Verification

```
code review
```

Checking:

*   correctness
*   maintainability
*   adherence to design

* * *

5\. The full structure
======================

Putting the layers together:

```
PRODUCT LAYER
  ↓ construction
product requirements
  ↑ validation: acceptance tests
  ↑ verification: requirement review

SYSTEM LAYER
  ↓ construction
system specification
  ↑ validation: system tests
  ↑ verification: architecture review + ADR

MODULE LAYER
  ↓ construction
service / module interfaces
  ↑ validation: integration tests
  ↑ verification: module design review

IMPLEMENTATION LAYER
  ↓ construction
code
  ↑ validation: unit tests
  ↑ verification: code review
```

* * *

6\. The flow down vs up
=======================

### Going down (construction)

```
requirements
→ system specification
→ module interfaces
→ code
```

Each step **refines the layer above**.

* * *

### Going up (validation)

```
unit tests
→ integration tests
→ system tests
→ acceptance tests
```

Each step **checks the layer above**.

* * *

### Verification runs in parallel

```
requirement review
architecture review
module design review
code review
```

* * *

7\. Where ADR fits
==================

ADR sits mainly at the **system layer**, sometimes at the module layer.

Examples:

System-level ADR:

```
ADR-004: adopt event-driven architecture
ADR-005: separate tracing service
```

Module-level ADR:

```
ADR-012: user service owns authentication
```

They record **design decisions**, not implementation.

* * *

8\. Why this structure matters for agentic engineering
======================================================

Each layer becomes a **loop with three inputs**:

```
construction spec
verification criteria
validation scenarios
```

Actors produce artifacts, and two critiques evaluate them.

That structure maps very naturally to **agent + review agent + test agent** loops.

* * *

If you'd like, the next interesting refinement is something many teams overlook:  
the **data layer and migrations actually form a parallel V inside the system V**, which changes how integration tests and reviews should be structured.

## Prompt:
One interesting thing here is that in a large software system, every time you run through the double V model, you're doing a dagger for a bug, for a feature, or for something, or for some new capability, or for something. But it doesn't touch the whole system and the whole product. And so this whole set of artifacts are generated for that scope of work. But once things are done, when you're going up through the V and things are finished, this slice of information in terms of the product, the system, the architecture, all the tests, and all the findings, and so on and so forth, it will need to be merged to a central place where we have this information about the product, about the tests, about the system, about the specs, about the architecture, about the findings, and so on and so forth.

## Response:
Yes — this is a very important observation about how the **V-model actually operates in real systems**.

In theory, the V-model describes the **whole system**.  
In practice, every feature, bug fix, or capability runs a **small local V** — a slice of the system.

So the real system looks like many **small daggers (or mini-Vs)** happening continuously.

* * *

1\. Local Vs (feature slices)
=============================

Each piece of work runs its own loop:

```
requirements slice
      ↓
design slice
      ↓
implementation slice
      ↓
review + tests
```

These slices produce artifacts such as:

```
feature spec
ADR update
code diff
unit tests
integration tests
review findings
```

But they only cover **the part of the system that changed**.

* * *

2\. The system knowledge must remain global
===========================================

After the slice completes, the knowledge it produced must update the **global system model**.

Otherwise knowledge fragments.

Example problem if you don't merge knowledge:

```
feature A modifies API
feature B modifies API
feature C modifies API
```

But the **central API specification** is never updated.

Now:

*   tests drift
*   documentation drifts
*   architecture knowledge diverges

* * *

3\. What needs to converge centrally
====================================

Several knowledge bases must stay coherent.

### Product knowledge

```
product requirements
use cases
user journeys
acceptance scenarios
```

* * *

### System knowledge

```
system architecture
service boundaries
data models
API specifications
```

* * *

### Implementation knowledge

```
code
module interfaces
dependencies
```

* * *

### Validation knowledge

```
test suites
test scenarios
coverage
```

* * *

### Decision knowledge

```
ADRs
design rationales
tradeoffs
```

* * *

### Operational knowledge

```
runbooks
observability
SLOs
deployment procedures
```

* * *

4\. Each slice updates these knowledge bases
============================================

When a slice completes, it should produce **deltas**.

Example:

```
feature slice:
   new endpoint
   new user flow
   new data model
```

The slice must update:

```
API spec
architecture docs
tests
ADR if architecture changed
```

* * *

5\. This is why PRs usually include multiple artifacts
======================================================

A good PR often contains:

```
code changes
tests
documentation updates
schema migrations
```

Sometimes also:

```
ADR
design notes
runbook updates
```

This ensures the slice merges back into **system knowledge**.

* * *

6\. In graph terms
==================

You can think of the process as:

```
system knowledge base
      ↓
work slice
      ↓
local artifacts
      ↓
merge updates
      ↓
system knowledge base (updated)
```

The system knowledge is **continuously evolving**.

* * *

7\. This is where architecture knowledge often breaks
=====================================================

Many teams maintain code well but fail to maintain **system-level artifacts**.

Typical problems:

*   outdated architecture diagrams
*   API specs drifting from implementation
*   undocumented design decisions
*   missing ADRs

This happens because slices merge only into **code**, not into **system knowledge**.

* * *

8\. A cleaner model
===================

A large system should maintain **persistent knowledge layers**.

Example:

```
product knowledge
system architecture
module interfaces
test scenarios
code
```

Every slice updates one or more of these.

* * *

9\. In agentic engineering this becomes even more important
===========================================================

Agents rely heavily on **current knowledge**.

If architecture knowledge is stale:

*   code agents make wrong assumptions
*   review agents miss violations
*   testing agents generate incorrect tests

So the merge step becomes:

```
slice artifacts
      ↓
knowledge update
      ↓
system knowledge graph
```

* * *

10\. The system becomes a living model
======================================

Instead of static documents, the system knowledge becomes something like:

```
product model
architecture model
code model
test model
decision log
```

All continuously updated by slices.

* * *

11\. The key insight you pointed out
====================================

The V-model describes **how work is validated**.

But real development also needs a second loop:

```
slice V-loop
      ↓
knowledge integration
      ↓
system model update
```

Without this integration step, the system gradually **loses coherence**.

* * *

If you push this idea one step further, an interesting structure appears:

Large software systems start to look like **knowledge graphs of the system**, where each slice contributes new nodes and edges — rather than just commits to code.

## Prompt:
# Design Artifacts and Test Validation (Hexagonal / Vertical Slice Model)

In this model:

- **Design activities produce artifacts**
- **Artifacts flow downward toward implementation**
- **Tests validate the artifact immediately above them**

Requirements and specifications are **artifacts**, not layers of the runtime system.

Architecture is everything **between product design and implementation**.

Modules correspond to **vertical slices built with hexagonal architecture**, using:

ports
adapters
dependency injection

---

# Artifact Generation Flow

Product Design
      │
      ▼
Product Requirements (artifact)
      │
      ▼
System Design
      │
      ▼
System Specifications (artifact)
      │
      ▼
Module Design (vertical slices)
      │
      ▼
Module Specifications (artifact)
      │
      ▼
Component Design
      │
      ▼
Component Specifications (artifact)
      │
      ▼
Code Generation / Implementation

Key idea:

Design produces specification artifacts.

Examples:

product design → product requirements
system design → system specifications
module design → module specifications
component design → component specifications

---

# Test Validation Mapping

Each test level validates the **artifact immediately above it**.

Product Requirements     → Acceptance Tests
System Specifications    → System Tests
Module Specifications    → Integration Tests
Component Specifications → Component Tests
Code                     → Unit Tests

---

# Product Requirements (artifact)

Produced by **product design**.

Defines what the **product must achieve**.

Examples include:

user journeys
workflows
business capabilities
UX expectations
API usage patterns

Validation:

Acceptance Tests

Acceptance tests validate **product-level behavior**.

Example:

Scenario: run evaluation on a dataset

Given a dataset with scenarios
When a user runs an evaluation
Then results appear in the dashboard

---

# System Specifications (artifact)

Produced by **system design**.

Defines the **structure and runtime behavior of the system**.

Examples include:

system boundaries
services
APIs
protocols
runtime topology

Validation:

System Tests

System tests exercise the **running system through its public interfaces**.

---

# Module Specifications (artifact)

Produced by **module design**.

Modules correspond to **vertical slices of the system**, built with **hexagonal architecture**.

Each module includes concepts such as:

domain logic
application services
ports
adapters

Key characteristics:

vertical slice
isolated responsibility
dependency injection
ports define boundaries
adapters implement infrastructure

Validation:

Integration Tests

Integration tests verify that **module boundaries behave correctly with real dependencies**.

---

# Component Specifications (artifact)

Produced by **component design**.

Components are **internal building blocks within a module**.

Examples include:

domain services
repositories
workflow orchestrators
handlers
adapters

These are typically wired using:

dependency injection

Validation:

Component Tests

These tests often use:

mocks
fakes
stubs

---

# Implementation (code)

Produced by **code generation / development**.

Examples include:

functions
classes
algorithms
utilities

Validation:

Unit Tests

---

# Boundary Perspective

The same structure can be viewed through boundaries.

PRODUCT BOUNDARY
│
│  Acceptance Tests
│  (validate product requirements)
│
SYSTEM BOUNDARY
│
│  System Tests
│  (validate system specifications)
│
MODULE BOUNDARIES
│
│  Integration Tests
│  (validate vertical slice modules)
│
COMPONENT BOUNDARIES
│
│  Component Tests
│  (validate components using dependency injection)
│
CODE
│
│  Unit Tests

---

# Core Principle

Artifacts describe what the system must do.

Tests validate that the implementation satisfies those artifacts.

Design → produces artifacts
Tests → validate artifacts

Flow:

Product Design
    ↓
Product Requirements
    ↓
System Specifications
    ↓
Module Specifications
    ↓
Component Specifications
    ↓
Implementation

Extend with the double-V critics at each layer

## Response:
Your model is already very clean. The only thing missing is making **verification (review) explicit alongside validation (tests)** at every artifact level. That produces the **double-V critics** you mentioned earlier: one critic checking **structure vs the artifact**, the other checking **behavior vs the artifact**.

Below is the same structure extended with the **two critics at each layer**.

* * *

Design Artifacts and Double-V Critics
=====================================

(Hexagonal / Vertical Slice Model)

Principles:

```
Design → produces artifacts
Implementation → realizes artifacts
Verification → reviews artifacts against engineering rules
Validation → tests implementation against artifacts
```

So each layer has:

```
artifact
implementation below
verification critic
validation critic
```

* * *

Artifact Generation Flow
========================

```
Product Design
      │
      ▼
Product Requirements (artifact)
      │
      ▼
System Design
      │
      ▼
System Specifications (artifact)
      │
      ▼
Module Design (vertical slices)
      │
      ▼
Module Specifications (artifact)
      │
      ▼
Component Design
      │
      ▼
Component Specifications (artifact)
      │
      ▼
Code Generation / Implementation
```

* * *

Double-V Validation / Verification Mapping
==========================================

Each layer has two critics:

```
artifact reviewed by verification
artifact validated by tests below
```

Mapping:

```
Product Requirements
    verification → Product Review
    validation   → Acceptance Tests

System Specifications
    verification → Architecture Review (ADR decisions)
    validation   → System Tests

Module Specifications
    verification → Module Design Review
    validation   → Integration Tests

Component Specifications
    verification → Component Design Review
    validation   → Component Tests

Code
    verification → Code Review / Static Analysis
    validation   → Unit Tests
```

* * *

Product Requirements (artifact)
===============================

Produced by:

```
product design
```

Defines what the product must achieve.

Examples:

```
user journeys
workflows
business capabilities
UX expectations
API usage patterns
```

### Verification critic

```
Product Review
```

Checks:

```
requirements clarity
testability
consistency
feasibility
```

### Validation critic

```
Acceptance Tests
```

Example:

```
Scenario: run evaluation on a dataset

Given a dataset with scenarios
When a user runs an evaluation
Then results appear in the dashboard
```

* * *

System Specifications (artifact)
================================

Produced by:

```
system design
```

Defines the runtime structure of the system.

Examples:

```
services
APIs
data models
protocols
runtime topology
```

### Verification critic

```
Architecture Review
```

Includes:

```
ADR creation
ADR updates
design tradeoffs
security review
scalability review
```

ADRs belong primarily at this layer.

### Validation critic

```
System Tests
```

System tests validate the running system through:

```
public APIs
external interfaces
user workflows
```

* * *

Module Specifications (artifact)
================================

Produced by:

```
module design
```

Modules correspond to **vertical slices** using hexagonal architecture.

Structure:

```
domain logic
application services
ports
adapters
```

Properties:

```
isolated responsibility
clear boundaries
dependency injection
```

### Verification critic

```
Module Design Review
```

Checks:

```
ports correctness
dependency boundaries
data ownership
service responsibilities
```

### Validation critic

```
Integration Tests
```

Integration tests verify interactions with:

```
databases
message brokers
external services
infrastructure adapters
```

* * *

Component Specifications (artifact)
===================================

Produced by:

```
component design
```

Components are internal elements inside modules.

Examples:

```
domain services
repositories
workflow handlers
adapters
```

### Verification critic

```
Component Review
```

Checks:

```
interface design
dependency injection wiring
responsibility separation
```

### Validation critic

```
Component Tests
```

Typically use:

```
mocks
fakes
stubs
```

* * *

Implementation (Code)
=====================

Produced by:

```
development / code generation
```

Examples:

```
functions
classes
algorithms
utilities
```

### Verification critic

```
Code Review
```

Often supported by:

```
linters
type systems
static analysis
security scanners
```

### Validation critic

```
Unit Tests
```

Unit tests verify the smallest executable elements.

* * *

Boundary Perspective with Double-V
==================================

```
PRODUCT BOUNDARY
│
│  Product Review
│  Acceptance Tests
│
SYSTEM BOUNDARY
│
│  Architecture Review (ADR)
│  System Tests
│
MODULE BOUNDARIES
│
│  Module Design Review
│  Integration Tests
│
COMPONENT BOUNDARIES
│
│  Component Review
│  Component Tests
│
CODE
│
│  Code Review
│  Unit Tests
```

* * *

Summary
=======

At every artifact layer:

```
Design → produces artifact
Implementation → realizes artifact
Verification → reviews structure against artifact
Validation → tests behavior against artifact
```

So the full pattern becomes:

```
artifact
   ↓
implementation
   ↙        ↘
verification  validation
(review)      (tests)
```

And this repeats for:

```
product
system
module
component
code
```

* * *

If you'd like, the next useful refinement is to connect this structure to **vertical slice development**, showing how a **single feature dagger moves through these artifact layers while only touching a small part of the system knowledge base.**

## Prompt:
Organising skills, rules, prompts, sub-agents, tools, knowledge, and platform files

1. Core conceptual model

A clean model is:
	•	knowledge = what the agent should know or be able to retrieve
	•	policy / rules = how the agent should behave
	•	procedures = how recurring tasks should be executed
	•	actors = who is responsible for what kind of work
	•	capabilities = what the agent can do through tools
	•	enforcement = what is applied deterministically regardless of model judgment

Equivalent phrasing:
	•	skill = procedure / playbook / method
	•	agent = actor / worker / role
	•	sub-agent = delegated actor inside a larger actor/system

⸻

2. Skills vs agents vs sub-agents

Skills

A skill is a reusable way of doing something.

A skill usually contains:
	•	when to use it
	•	required inputs
	•	steps
	•	checks
	•	expected output

Examples:
	•	review a migration
	•	summarize a PR
	•	investigate a failing CI run
	•	prepare release notes

So a skill answers:

How should this task be done?

A skill is usually:
	•	narrower
	•	more deterministic
	•	more procedural
	•	easier to reuse across different actors
	•	often stateless
	•	usually does not own responsibility

Good shorthand:
	•	skill = playbook
	•	skill = method
	•	skill = recipe

⸻

Agents

An agent is an entity with a role.

It usually has:
	•	a purpose or mandate
	•	a scope
	•	available tools
	•	memory/context
	•	decision authority
	•	sometimes a persona or optimization target

Examples:
	•	code reviewer
	•	security auditor
	•	release manager
	•	SRE triager
	•	researcher

So an agent answers:

Who is responsible for this kind of work, and how do they operate overall?

An agent may use many skills.

Good shorthand:
	•	agent = worker
	•	agent = role
	•	agent = the cook

⸻

Sub-agents

A sub-agent is an agent that exists under another agent or orchestration layer.

So the difference is mostly relative, not ontological.

An agent becomes a sub-agent when:
	•	it is invoked by another agent
	•	it has a narrower delegated scope
	•	it usually works with reduced context
	•	it often has restricted tools or permissions
	•	it returns its result back to the parent agent

So:
	•	agent = top-level or independently considered actor
	•	sub-agent = delegated specialized actor inside a bigger workflow

Example:

A top-level implementation agent receives:

“Investigate why production latency increased after the last deploy.”

It may delegate to sub-agents:
	•	logs sub-agent
	•	metrics sub-agent
	•	git diff sub-agent
	•	database sub-agent

Each sub-agent does a focused part, then reports back.

Analogy:
	•	agent = head chef
	•	sub-agent = pastry chef helping the head chef

⸻

3. Practical test for distinguishing them

Ask these questions:

1. Is this mainly answering “how to do X”?

Then it is probably a skill.

2. Is this mainly answering “who handles this category of work”?

Then it is probably an agent.

3. Is this specialist invoked by another agent rather than directly owning the whole task?

Then it is probably a sub-agent.

⸻

4. Concrete examples

Example 1: SQL migration review
	•	Skill: “Review a SQL migration for locks, table rewrites, backfill risk, rollback safety.”
	•	Agent: “Database reviewer.”
	•	Sub-agent: “Lock-risk analyzer” called by the database reviewer.

Example 2: Documentation
	•	Skill: “Generate a Diátaxis-style how-to guide.”
	•	Agent: “Docs writer.”
	•	Sub-agent: “Reference-doc normalizer” used by the docs writer.

Example 3: Incident response
	•	Skill: “Triage a 500-rate spike.”
	•	Agent: “SRE incident responder.”
	•	Sub-agent: “Logs investigator” and “metrics investigator.”

⸻

5. What defines an agent in practical terms

Yes — in practical terms, an agent is largely defined by its operating envelope.

That usually includes:
	•	instructions / mandate — what it is supposed to do
	•	scope / responsibility — what kinds of tasks it owns
	•	knowledge / context — what it knows or can access
	•	skills / procedures — how it tends to perform recurring tasks
	•	tools / capabilities — what it can actually do
	•	hooks / guardrails / policies — what constrains or shapes its behavior
	•	memory / state — what it retains across steps or sessions
	•	authority / permissions — what it is allowed to decide or change

A refined phrasing is:

an actor with a mandate, operating under a specific context, capability set, and constraint set

Or more concretely:

An agent is what you get when you take a model and give it a job, some context, some tools, some playbooks, and some boundaries.

A compact decomposition:
agent =
  mandate
+ instructions
+ accessible knowledge
+ available skills
+ available tools
+ constraints / hooks / policies
+ memory / state
+ permissions

Not all of these are equally important in every system, but that is the practical shape.

⸻

6. Important nuance about hooks and policies

It is more accurate to say:
	•	skills are part of the agent’s usable repertoire
	•	tools are part of the agent’s capability surface
	•	knowledge is part of the agent’s context surface
	•	hooks are part of the environment’s enforcement surface around the agent

So hooks help define the practical behavior of the agent, but they are often external constraints, not intrinsic agent content.

Similarly:
	•	some instructions are inside the agent definition
	•	some policies are outside and apply to all agents in the environment

So in practice the agent is defined partly by itself and partly by its runtime environment.

A clean formulation:

An agent is a role-bearing execution unit defined by its mandate, context, capabilities, procedures, and constraints.

⸻

Knowledge is a missing category

A flat taxonomy of:
	•	instructions
	•	prompts
	•	skills
	•	sub-agents
	•	tools
	•	hooks

is incomplete.

What is missing is knowledge / grounding.

A cleaner model is:
	1.	Knowledge — what the agent should know or retrieve
	2.	Policy — how the agent should behave
	3.	Procedures — how the agent should execute repeatable tasks
	4.	Actors — which specialist does what
	5.	Capabilities — what external tools the agent can use
	6.	Enforcement — what happens deterministically regardless of model judgment

This missing knowledge layer includes things like:
	•	repo map
	•	architecture docs
	•	ADRs
	•	coding examples
	•	API schemas / OpenAPI / GraphQL schema
	•	database schema and migrations
	•	glossary
	•	runbooks
	•	product specs
	•	domain rules
	•	incident history
	•	examples of good PRs / tests / modules

⸻

7. Better overall grouping

A cleaner umbrella is:

1. Knowledge

What the agent should know.
	•	docs
	•	examples
	•	schemas
	•	specs
	•	repo map
	•	ADRs
	•	indexed context
	•	memory

2. Behavior

How the agent should act.
	•	instructions
	•	policies
	•	style/rules
	•	safety/approval rules

3. Execution

How work gets done.
	•	prompts
	•	skills
	•	agents/subagents
	•	tools/MCP
	•	hooks

This is cleaner than treating all primitives as peers.

⸻

Diátaxis and how it fits

8. What Diátaxis is useful for

Diátaxis helps by forcing you to separate different kinds of AI guidance by user need, instead of dumping everything into one giant “agent instructions” bucket.

Its core distinction is between four forms of documentation:
	•	tutorials
	•	how-to guides
	•	reference
	•	explanation

Applied here, it means you should separate:
	•	what is true
	•	how to do something
	•	why the system is designed this way
	•	how a newcomer learns it

⸻

9. Where Diátaxis applies

Diátaxis applies directly to textual guidance or structured knowledge, not to runtime primitives.
	•	It applies to content like docs, policies, procedures, agent specs, tool docs, hook docs.
	•	It does not apply to the runtime mechanisms like tools, hooks, MCP servers, or agent orchestration themselves.

So you should apply Diátaxis to the documents around these things, not to the things themselves.

⸻

10. Differences between Diátaxis and agent taxonomy

They operate at different levels:
	•	The taxonomy of AI system primitives (knowledge, policy, procedures, actors, capabilities, enforcement) is about what the thing is.
	•	Diátaxis is about how to write and organize the documentation/content for those things (tutorial, how-to, reference, explanation).

Therefore, Diátaxis should sit across the taxonomy, not replace it. Use your own taxonomy for system design; use Diátaxis for structuring the written materials.

⸻

11. Practical mapping with Diátaxis

You can map the taxonomy to Diátaxis:
	•	Knowledge → Documented using reference and explanation.
	•	Policy / rules → Documented as reference.
	•	Procedures / skills → Documented as how-to.
	•	Actors / agents → Documented with reference (scope, permissions, inputs, outputs) and explanation (role rationale, tradeoffs).
	•	Tools and hooks → Documented as reference (catalogues and interfaces); how-to for usage; explanation for rationale and patterns; tutorials for onboarding.

Be careful not to confuse the tool or hook itself (which is a runtime mechanism) with its documentation. The documentation is where Diátaxis applies.

⸻

12. Summary
	•	Skill: A reusable procedure (playbook) answering “How to do X?”.
	•	Agent: An actor with a role (worker) answering “Who handles X?”.
	•	Sub-agent: A delegated actor under an agent answering a narrower part of a task.
	•	Knowledge: The context and reference materials needed by agents and skills.
	•	Policy / rules: Always-on behavioral constraints that apply to agents.
	•	Procedures: Repeatable workflows captured in skills.
	•	Actors: Specialized agents responsible for categories of tasks.
	•	Capabilities: Tools that agents can use to perform tasks.
	•	Enforcement: Hooks and policies that deterministically constrain agent behavior.
	•	Diátaxis: A documentation framework to organize knowledge, procedures, policies, and explanations into four categories: tutorials, how-to guides, reference, and explanation. It helps separate what is true, how to do something, why it is done that way, and how to learn it.
	•	Apply Diátaxis to the documentation and guidance around agents, skills, knowledge, tools, and policies. Do not apply it to the runtime mechanisms themselves.

## Response:
Your model is already strong. The only thing that helps in practice is to **separate three planes clearly**:

1.  **Runtime plane** (what executes)
2.  **Configuration plane** (how the system is wired)
3.  **Knowledge plane** (what agents know and how humans understand it)

Right now your taxonomy mixes them slightly. If we separate them, organizing files and systems becomes much easier.

Below is a refined structure that keeps your ideas but makes them easier to apply in real repositories and platforms.

* * *

1\. Three planes of an agentic system
=====================================

### Runtime plane

Things that **execute during agent runs**.

```
agents
sub-agents
skills
tools
```

These define **who does work and how work is performed**.

* * *

### Configuration plane

Things that **control agent behavior or enforce constraints**.

```
instructions
policies
permissions
hooks
routing
orchestration
```

These define **how the system behaves regardless of the model**.

* * *

### Knowledge plane

Things that provide **context and grounding**.

```
documentation
schemas
examples
architecture
ADRs
repo map
domain rules
```

These define **what the system knows**.

* * *

2\. Mapping your taxonomy to these planes
=========================================

Your categories fit very naturally into this model.

| Your category | Plane | Meaning |
| --- | --- | --- |
| knowledge | knowledge | grounding and reference |
| policy / rules | configuration | behavioral constraints |
| procedures (skills) | runtime | reusable task methods |
| actors (agents) | runtime | role-bearing workers |
| capabilities (tools) | runtime | external actions |
| enforcement | configuration | deterministic control |

This is very close to your formulation but makes it clearer **what executes vs what constrains vs what informs**.

* * *

3\. Runtime structure
=====================

The runtime layer becomes:

```
agent
  ├── mandate
  ├── accessible knowledge
  ├── available skills
  ├── available tools
  └── permissions
```

Execution typically looks like:

```
agent
  → uses skill
  → calls tools
  → may delegate to sub-agent
```

Example:

```
code-review-agent
  skills:
    - review_pr
    - analyze_diff
  tools:
    - git
    - repo_map
    - CI logs
```

* * *

4\. Skills as reusable procedures
=================================

A skill should contain something like:

```
skill
  purpose
  trigger conditions
  required inputs
  steps
  checks
  output format
```

Example:

```
skill: review_sql_migration

when_to_use:
  - PR modifies migration files

inputs:
  - SQL diff

steps:
  - check table rewrites
  - check lock risks
  - check rollback strategy

checks:
  - long-running operations
  - irreversible changes

output:
  migration review report
```

Skills are usually:

```
stateless
narrow
procedural
reusable
```

* * *

5\. Agents as roles
===================

Agents answer:

```
Who owns this category of work?
```

Example:

```
agent: database-reviewer

mandate:
  review schema changes and migrations

skills:
  - review_sql_migration
  - analyze_index_changes

tools:
  - schema explorer
  - migration history
```

Agents combine:

```
role
context
skills
tools
authority
```

* * *

6\. Sub-agents as delegation
============================

Sub-agents are simply **agents with restricted scope**.

Example hierarchy:

```
incident-agent
  ├── logs-agent
  ├── metrics-agent
  └── deployment-agent
```

Typical properties:

```
smaller context
restricted permissions
narrow responsibility
shorter execution horizon
```

* * *

7\. Knowledge layer
===================

Knowledge is the **most commonly missing category**, as you noted.

Typical sources:

```
repo map
architecture docs
ADRs
OpenAPI schemas
database schema
runbooks
glossary
domain rules
examples
incident history
```

This knowledge should ideally be:

```
indexed
structured
versioned
discoverable
```

This is what enables agents to **reason about the system**.

* * *

8\. Configuration layer (rules and enforcement)
===============================================

This layer ensures that agents behave safely and consistently.

Examples:

```
policies
approval rules
security constraints
rate limits
tool access restrictions
execution hooks
```

Example policy:

```
deployment changes require human approval
```

Example hook:

```
after generating code
  → run static analysis
```

Hooks belong to the **environment**, not the agent.

* * *

9\. Platform files in practice
==============================

A practical repository structure might look like:

```
/agents
    code-review-agent.yaml
    sre-agent.yaml

/skills
    review_sql_migration.md
    investigate_ci_failure.md

/tools
    git.yaml
    logs.yaml
    metrics.yaml

/policies
    deployment_rules.md
    security_constraints.md

/knowledge
    architecture/
    ADRs/
    schemas/
    runbooks/
    repo_map.md
```

This separation makes it easy to maintain.

* * *

10\. Where prompts and instructions fit
=======================================

Prompts are usually **part of skills or agents**, not a top-level category.

Example:

```
skill
  instructions
  examples
  steps
```

or

```
agent
  system prompt
  role definition
```

So prompts belong to **execution configuration**, not to knowledge.

* * *

11\. Diátaxis placement
=======================

You correctly noted that Diátaxis applies to **documentation**, not runtime.

Mapping looks like this:

| Diátaxis | Used for |
| --- | --- |
| tutorial | onboarding new engineers |
| how-to | skills and procedures |
| reference | schemas, APIs, tools |
| explanation | ADRs and architecture rationale |

So Diátaxis applies mostly to:

```
knowledge
policies
skills
agent documentation
```

Not to runtime primitives themselves.

* * *

12\. Clean final model
======================

A concise final model becomes:

```
knowledge
policy
procedures
actors
capabilities
enforcement
```

Or structurally:

```
knowledge plane
configuration plane
runtime plane
```

Where:

```
runtime = agents + skills + tools
configuration = policies + hooks + permissions
knowledge = docs + schemas + examples
```

* * *

13\. One final observation
==========================

The structure you’re describing is very close to what many mature agent systems converge toward:

```
process layer
agent layer
skill layer
tool layer
knowledge layer
policy layer
```

In other words:

**agents are just orchestrators of procedures operating over knowledge through tools under policies.**

## Prompt:
Now if you were to dump ALL the information in this thread in a series of files, without any loss of information or overly compact summation, what would the sections be ?

## Response:
Below is a **structured file layout** that preserves essentially everything discussed in the thread without collapsing concepts too aggressively.  
The goal is **separation of concerns**, not brevity.  
This structure allows each idea to live in a **dedicated document** while keeping the relationships between them clear.

The top-level structure mirrors the major conceptual areas we covered:

```
/concepts
/engineering-model
/agent-systems
/process-systems
/product-agents
/scientific-systems
/autonomy
/interfaces
/knowledge-management
/documentation
```

Within these, the files would look like the following.

* * *

Root Overview
=============

```
README.md
```

Sections:

```
Purpose of this knowledge base
Overview of the three domains where agents operate
    engineering systems
    operational processes
    product-integrated agents

Overview of the main conceptual axes discussed
    agent sophistication
    interface evolution
    autonomy levels
    process loops
    system knowledge integration

Relationship between engineering processes and agentic systems
```

* * *

Concepts
========

```
/concepts/core-model.md
```

Sections:

```
The core conceptual model of agent systems

Knowledge
Policy / rules
Procedures
Actors
Capabilities
Enforcement

Alternative phrasing
    skill
    agent
    sub-agent

Equivalent conceptual mappings

Relationship between runtime systems and documentation systems
```

* * *

```
/concepts/runtime-vs-knowledge-vs-configuration.md
```

Sections:

```
Three planes of an agentic system

Runtime plane
Configuration plane
Knowledge plane

Runtime primitives
    agents
    sub-agents
    skills
    tools

Configuration primitives
    policies
    instructions
    hooks
    routing
    permissions

Knowledge primitives
    documentation
    schemas
    examples
    ADRs
    architecture docs
    repo maps
    runbooks
```

* * *

Engineering Model
=================

```
/engineering-model/engineering-loops.md
```

Sections:

```
Engineering as nested loops

Micro-loops
    development
    review
    testing
    research

Macro-loop
    delivery and system evolution

Actor / critic structure

Artifacts as the edges of the system
```

* * *

```
/engineering-model/v-model.md
```

Sections:

```
Classical V-model explanation

Left side: construction
Right side: verification and validation

Requirements
System design
Architecture design
Module design
Implementation

Unit tests
Integration tests
System tests
Acceptance tests
```

* * *

```
/engineering-model/double-v-model.md
```

Sections:

```
Verification vs validation

Verification
    did we build the thing right

Validation
    did we build the right thing

Parallel nature of review and tests

Review as structural verification
Testing as behavioral validation
```

* * *

```
/engineering-model/artifact-based-v-model.md
```

Sections:

```
Artifacts instead of runtime layers

Design activities produce artifacts

Product requirements
System specifications
Module specifications
Component specifications
Code
```

* * *

```
/engineering-model/design-artifacts-and-test-validation.md
```

Sections:

```
Artifact generation flow

Product design
System design
Module design
Component design
Implementation

Validation mapping

Acceptance tests
System tests
Integration tests
Component tests
Unit tests
```

* * *

```
/engineering-model/double-v-critics.md
```

Sections:

```
Verification critics and validation critics

Product requirements
    product review
    acceptance tests

System specifications
    architecture review
    system tests

Module specifications
    module design review
    integration tests

Component specifications
    component review
    component tests

Code
    code review
    unit tests
```

* * *

```
/engineering-model/definition-of-ready.md
```

Sections:

```
Three input types for a layer

Construction specification
Verification criteria
Validation scenarios

Role of layer N-1 in defining inputs
```

* * *

```
/engineering-model/vertical-slices.md
```

## Prompt:
Do it in /Users/junaway/Agenta/github/sandbox/agentic_engineering/...

## Response:
I cannot write directly to `/Users/junaway/...`, but I can give you **a ready-to-run script + the full file structure and contents** so you can paste it into a terminal and it will generate the files exactly there.

Below is a **single shell script** that:

*   creates the directory tree
*   writes each document with the sections we discussed

You can paste it directly into your terminal.

* * *

1\. Create the directory and files
==================================

```
BASE="/Users/junaway/Agenta/github/sandbox/agentic_engineering"

mkdir -p $BASE/{concepts,engineering_model,agent_systems,process_systems,product_agents,scientific_systems,autonomy,interfaces,knowledge_management,documentation}

cat > $BASE/README.md << 'EOF'
# Agentic Engineering Knowledge Base

This repository captures the conceptual model developed in this discussion.

The material organizes the ideas into several domains:

1. Engineering systems (software development)
2. Operational processes (business workflows)
3. Product-embedded agents
4. Scientific experimentation systems

It also defines several cross-cutting axes:

- agent sophistication
- interface evolution
- autonomy levels
- process loops
- knowledge integration
- artifact-based engineering

The goal is to provide a structured representation of:

- how engineering systems work
- how agents interact with processes
- how skills, policies, and knowledge should be organized
- how artifacts flow through the V-model
EOF
```

* * *

2\. Core conceptual model
=========================

```
cat > $BASE/concepts/core_model.md << 'EOF'
# Core Conceptual Model

A clean conceptual model for agent systems includes six major categories.

1. Knowledge  
2. Policy / Rules  
3. Procedures  
4. Actors  
5. Capabilities  
6. Enforcement

## Knowledge

Knowledge represents what the system should know or retrieve.

Examples:

- architecture documentation
- ADRs
- API schemas
- database schemas
- domain rules
- product specifications
- runbooks
- repo maps
- examples of good code
- incident history

## Policy / Rules

Rules define behavioral constraints.

Examples:

- coding standards
- security policies
- deployment restrictions
- review requirements

Policies may be:

- global
- environment-enforced
- agent-specific

## Procedures

Procedures are repeatable methods for executing tasks.

These correspond to:

skills
playbooks
methods
recipes

Examples:

- review a SQL migration
- summarize a pull request
- investigate a failing CI run

## Actors

Actors correspond to agents or roles.

Examples:

- code reviewer
- security auditor
- SRE responder
- documentation writer

Actors answer:

Who is responsible for this class of work?

## Capabilities

Capabilities are the tools agents can use.

Examples:

- git access
- log analysis tools
- metrics systems
- database explorers
- CI systems

## Enforcement

Enforcement mechanisms apply deterministically regardless of model reasoning.

Examples:

- hooks
- policy gates
- approval workflows
- sandbox restrictions
EOF
```

* * *

3\. Runtime vs configuration vs knowledge
=========================================

```
cat > $BASE/concepts/runtime_configuration_knowledge_planes.md << 'EOF'
# Runtime vs Configuration vs Knowledge

Agent systems naturally separate into three planes.

## Runtime plane

Runtime primitives execute during an agent run.

Examples:

- agents
- sub-agents
- skills
- tools

## Configuration plane

Configuration controls system behavior.

Examples:

- policies
- permissions
- hooks
- orchestration rules
- routing

## Knowledge plane

Knowledge provides grounding and context.

Examples:

- documentation
- architecture descriptions
- schemas
- ADRs
- runbooks
- examples
EOF
```

* * *

4\. Engineering loops
=====================

```
cat > $BASE/engineering_model/engineering_loops.md << 'EOF'
# Engineering Loops

Engineering processes can be described as nested loops.

## Micro loops

Development loop  
Review loop  
Testing loop  
Research loop  

## Macro loop

Delivery loop.

Intent → design → implementation → review → testing → release

Each loop includes:

actor
critic
artifact
evaluation rule

Artifacts form the edges of the system.
EOF
```

* * *

5\. V-model
===========

```
cat > $BASE/engineering_model/v_model.md << 'EOF'
# The V Model

The V-model describes the relationship between system construction and system validation.

Left side: construction

Requirements  
System design  
Architecture design  
Module design  
Implementation

Right side: verification and validation

Unit tests  
Integration tests  
System tests  
Acceptance tests

Each level on the left corresponds to a validation level on the right.
EOF
```

* * *

6\. Double-V critics
====================

```
cat > $BASE/engineering_model/double_v_critics.md << 'EOF'
# Double-V Critics

Engineering includes two parallel forms of critique.

Verification
Did we build the thing right?

Validation
Did we build the right thing?

Verification mechanisms:

- code review
- architecture review
- design review

Validation mechanisms:

- unit tests
- integration tests
- system tests
- acceptance tests
EOF
```

* * *

7\. Artifact-based engineering model
====================================

```
cat > $BASE/engineering_model/artifact_based_model.md << 'EOF'
# Artifact Based Engineering

Design activities produce artifacts.

Product design → product requirements

System design → system specifications

Module design → module specifications

Component design → component specifications

Implementation produces code.

Tests validate artifacts.

Acceptance tests validate product requirements.  
System tests validate system specifications.  
Integration tests validate module specifications.  
Component tests validate component specifications.  
Unit tests validate code behavior.
EOF
```

* * *

8\. Vertical slice model
========================

```
cat > $BASE/engineering_model/vertical_slices.md << 'EOF'
# Vertical Slice Architecture

Modules correspond to vertical slices built with hexagonal architecture.

Key concepts:

ports  
adapters  
dependency injection  

Each slice contains:

domain logic  
application services  
infrastructure adapters

Slices allow development work to run a local V-loop without touching the whole system.
EOF
```

* * *

9\. Agent systems
=================

```
cat > $BASE/agent_systems/agents_skills_tools.md << 'EOF'
# Agents, Skills, and Tools

## Skills

A skill is a reusable method.

A skill usually contains:

when to use it  
required inputs  
steps  
checks  
expected outputs  

Examples:

review a migration  
summarize a PR  
investigate CI failure

## Agents

Agents represent actors with responsibility.

An agent usually includes:

mandate  
context  
skills  
tools  
permissions

## Sub-agents

Sub-agents are delegated agents invoked by a parent agent.

Example:

incident responder agent  
    logs agent  
    metrics agent  
    deployment agent
EOF
```

* * *

10\. Process systems
====================

```
cat > $BASE/process_systems/process_agents.md << 'EOF'
# Process Agents

Agents can operate inside business workflows.

Example process:

lead discovery  
qualification  
outreach  
conversation  
proposal  
closing

Agents may perform tasks such as:

lead research  
drafting outreach  
CRM updates  
meeting summaries
EOF
```

* * *

11\. Product-embedded agents
============================

```
cat > $BASE/product_agents/product_agents.md << 'EOF'
# Product Embedded Agents

Agents can also exist as runtime product features.

Examples:

chat assistants  
coding copilots  
search agents  
automation assistants

Runtime loop:

user request  
agent reasoning  
tool usage  
response
EOF
```

* * *

12\. Scientific systems
=======================

```
cat > $BASE/scientific_systems/scientific_loops.md << 'EOF'
# Scientific Loops

Scientific work follows a structured process.

Hypothesis  
Literature review  
Experiment design  
Experiment execution  
Analysis  
Validation  
Publication

Agents can assist in computational steps such as:

literature synthesis  
simulation generation  
data analysis
EOF
```

* * *

13\. Autonomy levels
====================

```
cat > $BASE/autonomy/autonomy_levels.md << 'EOF'
# Autonomy Levels

AI usage can be categorized in levels similar to autonomous driving.

Level 0  
No AI usage.

Level 1  
AI assistance.

Level 2  
AI performs tasks.

Level 3  
AI executes tasks under supervision.

Level 4  
Autonomous loops with oversight.

Level 5  
Fully autonomous processes.
EOF
```

* * *

14\. Interface evolution
========================

```
cat > $BASE/interfaces/interface_evolution.md << 'EOF'
# Interface Evolution

Software interfaces evolved in three stages.

Human interfaces

Graphical UIs designed for manual interaction.

Programmatic interfaces

APIs used by software.

Agent interfaces

Structured tool interfaces designed for reasoning systems.
EOF
```

* * *

15\. Knowledge integration
==========================

```
cat > $BASE/knowledge_management/system_knowledge.md << 'EOF'
# System Knowledge Integration

Each feature or bug fix runs a small V-loop.

However the knowledge generated must be merged into the system knowledge base.

Examples of central knowledge:

product requirements  
system architecture  
API specifications  
test suites  
ADRs  
runbooks
EOF
```

* * *

16\. Documentation structure (Diátaxis)
=======================================

```
cat > $BASE/documentation/diataxis.md << 'EOF'
# Diátaxis Documentation Model

Diátaxis divides documentation into four categories.

Tutorials  
Guided learning experiences.

How-to guides  
Practical procedures.

Reference  
Technical facts and specifications.

Explanation  
Conceptual discussions and rationale.
EOF
```

* * *

Resulting folder structure
==========================

```
/Users/junaway/Agenta/github/sandbox/agentic_engineering

README.md

concepts/
    core_model.md
    runtime_configuration_knowledge_planes.md

engineering_model/
    engineering_loops.md
    v_model.md
    double_v_critics.md
    artifact_based_model.md
    vertical_slices.md

agent_systems/
    agents_skills_tools.md

process_systems/
    process_agents.md

product_agents/
    product_agents.md

scientific_systems/
    scientific_loops.md

autonomy/
    autonomy_levels.md

interfaces/
    interface_evolution.md

knowledge_management/
    system_knowledge.md

documentation/
    diataxis.md
```

* * *

If you want, I can also produce a **second script that turns this into a proper Git repo with diagrams (Mermaid) and cross-links**, which makes navigating this much easier.

## Prompt:
jp@agenta ~ % /Users/junaway/Agenta/github/sandbox/agentic_engineering

README.md

concepts/
    core_model.md
    runtime_configuration_knowledge_planes.md

engineering_model/
    engineering_loops.md
    v_model.md
    double_v_critics.md
    artifact_based_model.md
    vertical_slices.md

agent_systems/
    agents_skills_tools.md

process_systems/
    process_agents.md

product_agents/
    product_agents.md

scientific_systems/
    scientific_loops.md

autonomy/
    autonomy_levels.md

interfaces/
    interface_evolution.md

knowledge_management/
    system_knowledge.md

documentation/
    diataxis.md
zsh: permission denied: /Users/junaway/Agenta/github/sandbox/agentic_engineering
zsh: command not found: README.md
zsh: no such file or directory: concepts/
zsh: command not found: core_model.md
zsh: command not found: runtime_configuration_knowledge_planes.md
zsh: no such file or directory: engineering_model/
zsh: command not found: engineering_loops.md
zsh: command not found: v_model.md
zsh: command not found: double_v_critics.md
zsh: command not found: artifact_based_model.md
zsh: command not found: vertical_slices.md
zsh: no such file or directory: agent_systems/
zsh: command not found: agents_skills_tools.md
zsh: no such file or directory: process_systems/
zsh: command not found: process_agents.md
zsh: no such file or directory: product_agents/
zsh: command not found: product_agents.md
zsh: no such file or directory: scientific_systems/
zsh: command not found: scientific_loops.md
zsh: no such file or directory: autonomy/
zsh: command not found: autonomy_levels.md
zsh: no such file or directory: interfaces/
zsh: command not found: interface_evolution.md
zsh: no such file or directory: knowledge_management/
zsh: command not found: system_knowledge.md
zsh: no such file or directory: documentation/
zsh: command not found: diataxis.md
jp@agenta ~ %

## Response:
You pasted the **directory tree preview** as shell commands, so zsh tried to execute lines like `README.md` and `concepts/`.

Use this instead.

```
BASE="/Users/junaway/Agenta/github/sandbox/agentic_engineering"

mkdir -p \
  "$BASE/concepts" \
  "$BASE/engineering_model" \
  "$BASE/agent_systems" \
  "$BASE/process_systems" \
  "$BASE/product_agents" \
  "$BASE/scientific_systems" \
  "$BASE/autonomy" \
  "$BASE/interfaces" \
  "$BASE/knowledge_management" \
  "$BASE/documentation"

touch \
  "$BASE/README.md" \
  "$BASE/concepts/core_model.md" \
  "$BASE/concepts/runtime_configuration_knowledge_planes.md" \
  "$BASE/engineering_model/engineering_loops.md" \
  "$BASE/engineering_model/v_model.md" \
  "$BASE/engineering_model/double_v_critics.md" \
  "$BASE/engineering_model/artifact_based_model.md" \
  "$BASE/engineering_model/vertical_slices.md" \
  "$BASE/agent_systems/agents_skills_tools.md" \
  "$BASE/process_systems/process_agents.md" \
  "$BASE/product_agents/product_agents.md" \
  "$BASE/scientific_systems/scientific_loops.md" \
  "$BASE/autonomy/autonomy_levels.md" \
  "$BASE/interfaces/interface_evolution.md" \
  "$BASE/knowledge_management/system_knowledge.md" \
  "$BASE/documentation/diataxis.md"

find "$BASE" | sort
```

If you want the files **filled with content**, paste this one instead:

```
BASE="/Users/junaway/Agenta/github/sandbox/agentic_engineering"

mkdir -p \
  "$BASE/concepts" \
  "$BASE/engineering_model" \
  "$BASE/agent_systems" \
  "$BASE/process_systems" \
  "$BASE/product_agents" \
  "$BASE/scientific_systems" \
  "$BASE/autonomy" \
  "$BASE/interfaces" \
  "$BASE/knowledge_management" \
  "$BASE/documentation"

cat > "$BASE/README.md" <<'EOF'
# Agentic Engineering Knowledge Base

This repository captures the conceptual model developed in this discussion.

It covers:

- engineering systems
- operational processes
- product-embedded agents
- scientific systems
- autonomy levels
- interfaces
- knowledge management
- documentation structure
EOF

cat > "$BASE/concepts/core_model.md" <<'EOF'
# Core Conceptual Model

A clean model is:

- knowledge = what the agent should know or be able to retrieve
- policy / rules = how the agent should behave
- procedures = how recurring tasks should be executed
- actors = who is responsible for what kind of work
- capabilities = what the agent can do through tools
- enforcement = what is applied deterministically regardless of model judgment
EOF

cat > "$BASE/concepts/runtime_configuration_knowledge_planes.md" <<'EOF'
# Runtime vs Configuration vs Knowledge

Three planes:

## Runtime plane
- agents
- sub-agents
- skills
- tools

## Configuration plane
- instructions
- policies
- permissions
- hooks
- routing
- orchestration

## Knowledge plane
- documentation
- schemas
- examples
- architecture
- ADRs
- repo map
- runbooks
EOF

cat > "$BASE/engineering_model/engineering_loops.md" <<'EOF'
# Engineering Loops

Engineering can be modeled as nested loops.

## Micro-loops
- development
- review
- testing
- research

## Macro-loop
- delivery

Artifacts are the edges between loops.
EOF

cat > "$BASE/engineering_model/v_model.md" <<'EOF'
# V Model

Left side:
- requirements
- system design
- architecture / module design
- implementation

Right side:
- unit tests
- integration tests
- system tests
- acceptance tests
EOF

cat > "$BASE/engineering_model/double_v_critics.md" <<'EOF'
# Double-V Critics

Verification:
Did we build the thing right?

Validation:
Did we build the right thing?

Verification examples:
- requirement review
- architecture review
- module design review
- code review

Validation examples:
- acceptance tests
- system tests
- integration tests
- unit tests
EOF

cat > "$BASE/engineering_model/artifact_based_model.md" <<'EOF'
# Artifact-Based Engineering Model

Design produces artifacts:

- product requirements
- system specifications
- module specifications
- component specifications

Tests validate the artifact immediately above them.
EOF

cat > "$BASE/engineering_model/vertical_slices.md" <<'EOF'
# Vertical Slices

Modules correspond to vertical slices built with hexagonal architecture.

Typical concepts:
- ports
- adapters
- dependency injection
- domain logic
- application services
EOF

cat > "$BASE/agent_systems/agents_skills_tools.md" <<'EOF'
# Agents, Skills, and Tools

## Skill
A reusable procedure answering: how to do X?

## Agent
A role-bearing worker answering: who handles X?

## Sub-agent
A delegated specialist used by another agent.

## Tool
A capability surface the agent can use.
EOF

cat > "$BASE/process_systems/process_agents.md" <<'EOF'
# Process Agents

Agents can automate business workflows such as:
- legal
- support
- sales
- marketing
- internal operations

They operate inside process graphs.
EOF

cat > "$BASE/product_agents/product_agents.md" <<'EOF'
# Product Agents

Agents can also be embedded into products as runtime features.

Examples:
- chat assistants
- coding copilots
- search agents
- automation assistants
EOF

cat > "$BASE/scientific_systems/scientific_loops.md" <<'EOF'
# Scientific Loops

A scientific loop often looks like:

- hypothesis
- literature review
- experiment design
- execution
- analysis
- validation

Agents help mostly on computable parts.
EOF

cat > "$BASE/autonomy/autonomy_levels.md" <<'EOF'
# Autonomy Levels

- L0: no AI
- L1: assistance
- L2: task execution
- L3: supervised autonomy
- L4: autonomous loops
- L5: largely automated process
EOF

cat > "$BASE/interfaces/interface_evolution.md" <<'EOF'
# Interface Evolution

Interfaces evolve from:
- human UI
- programmatic API
- agent interface

Agent-ready interfaces need more than raw APIs.
EOF

cat > "$BASE/knowledge_management/system_knowledge.md" <<'EOF'
# System Knowledge

Each feature or bug runs a local V-loop.

Its outputs should update global knowledge such as:
- product requirements
- architecture
- specs
- tests
- ADRs
- runbooks
EOF

cat > "$BASE/documentation/diataxis.md" <<'EOF'
# Diátaxis

Documentation categories:
- tutorial
- how-to
- reference
- explanation

Apply Diátaxis to documentation around agents, skills, tools, and policies.
EOF

find "$BASE" | sort
```

The important bit is: only paste **actual shell commands**, not the rendered tree.

## Prompt:
Feels like most of the discussion is lost in these artefacts with are short and almost bullet points...

## Response:
Yes — that version was far too compressed.

What you asked for was not “a starter skeleton,” but a **lossless decomposition of the thread into files**, with enough separation that the full reasoning survives. The previous structure was too thin, too flattened, and too close to notes.

What you want is closer to a **small internal handbook / knowledge base**, with:

*   conceptual docs,
*   cross-cutting docs,
*   comparative docs,
*   framework docs,
*   and a few synthesis docs that preserve the thread’s actual reasoning.

A better structure is below.

Better top-level split
======================

```
agentic_engineering/
  README.md

  00_overview/
  01_foundations/
  02_engineering_loops/
  03_v_model_and_double_v/
  04_vertical_slices_and_hexagonal/
  05_artifacts_and_knowledge_flow/
  06_agents_skills_tools_policies/
  07_process_agents/
  08_product_embedded_agents/
  09_scientific_and_research_loops/
  10_interfaces_and_agent_readiness/
  11_autonomy_and_adoption_levels/
  12_platform_and_environment/
  13_documentation_and_diataxis/
  14_synthesis/
```

That split is better because it separates:

*   the **core ontology**
*   the **engineering model**
*   the **other families of agentic systems**
*   the **operational/platform implications**
*   and the **final synthesis**

* * *

00\_overview
============

`00_overview/README.md`
-----------------------

Sections:

*   Purpose of this knowledge base
*   Scope of the discussion
*   Why this is not only about coding



---
Powered by [ChatGPT Exporter](https://www.chatgptexporter.com)