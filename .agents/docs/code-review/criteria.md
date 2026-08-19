# criteria.md – Universal Review Criteria

This file is a **harness reference**.  It defines the 10 criteria that every code review must assess, regardless of domain or review type.  It is the conceptual foundation that rubrics build on and that findings cite.

**Role:** Not a reviewer role.  No agent "runs" this file like a rubric.  Instead, agents consult it to anchor every review pass in shared vocabulary, and they use it to justify the **Criteria** field in `findings.md`.

**When to read:** Before every review, alongside `instructions.md`.

---

## Two-tier model

```
criteria.md  (universal — always apply all 10)
       │
       ├─ Domain rubrics: apply all criteria in a specific context
       │   general · web · api · databases · sdk · services
       │
       └─ Specialist rubrics: full deep-dive on one criterion
           security (6) · performance (7) · architecture (8)
           testability (9) · observability (10)
```

Every review applies all 10 criteria.  Criteria 1–5 (Correctness through Complexity) are covered at full depth by domain rubrics.  Criteria 6–10 (Security through Observability) are applied at baseline depth by domain rubrics and at full depth by specialist rubrics.  Use a domain rubric to scope the review; escalate to a specialist rubric when a criterion warrants deeper examination.

---

## The 10 criteria

### 1  Correctness

> Does the code do what it is supposed to do?

**Key questions:**
- Does the implementation match the stated requirement or spec?
- Does it produce the correct output for representative inputs?
- Are all conditional branches implemented and reachable?
- Are off-by-one errors, type coercions, and numeric edge cases handled?

---

### 2  Completeness

> Does the code handle all cases it should?

**Key questions:**
- Are all edge cases (empty, null, max, concurrent, failure) handled?
- Are all error conditions caught and resolved — not just the happy path?
- Are all required fields, validations, and side effects present?
- Does the implementation finish the feature end-to-end?

---

### 3  Consistency

> Does the code follow established patterns and conventions?

**Key questions:**
- Does naming follow the project's existing conventions?
- Is the same problem solved the same way as elsewhere in the codebase?
- Are error-handling patterns, return types, and API shapes consistent with peers?
- Are departures from conventions explained and justified?

---

### 4  Soundness

> Is the approach logically valid?

A piece of code can be correct for its current inputs and still rest on a flawed premise — a race condition, a false assumption about ordering, or an abstraction that does not generalise.

**Key questions:**
- Is the design reasoning valid under all realistic conditions, including concurrent access and partial failure?
- Does the implementation rely on assumptions that the system does not guarantee?
- Is the abstraction model coherent — does it avoid leaking implementation details?
- Could the approach silently produce wrong results under untested inputs?

**Escalate to `security.md` if:** soundness failures involve trust boundaries.
**Escalate to `architecture.md` if:** soundness failures involve service contracts or coupling.

---

### 5  Complexity

> Is complexity proportionate to the problem?

**Key questions:**
- Is cyclomatic complexity bounded? (Functions with > 10 branches warrant scrutiny.)
- Is cognitive complexity low enough that the logic can be held in mind at once?
- Does abstraction depth match the problem — neither over-engineered nor under-abstracted?
- Is duplication accidental and harmful, or intentional to avoid premature abstraction?

---

### 6  Security  *(baseline in all reviews; full depth → `security.md`)*

> Are trust boundaries respected and sensitive data protected?

**Baseline questions (apply in every review):**
- Is user-supplied input validated or parameterised before use in queries, commands, or templates?
- Are secrets absent from code, logs, and API responses?
- Is authorisation enforced on every action, not assumed from context?
- Is sensitive data in transit encrypted?

**Escalate to `security.md` when:** the change touches authentication, authorisation, user input, secret management, cryptography, or network-facing surfaces.

---

### 7  Performance  *(baseline in all reviews; full depth → `performance.md`)*

> Are there obvious efficiency problems under realistic load?

**Baseline questions (apply in every review):**
- Are there N+1 query patterns or unbounded loops over large collections?
- Are database queries filtered and indexed on the columns used?
- Are resources (connections, file handles, goroutines) released after use?
- Is expensive computation cached where the result is stable?

**Escalate to `performance.md` when:** the change is on a hot path, involves bulk data processing, or carries a latency SLO.

---

### 8  Architecture  *(baseline in all reviews; full depth → `architecture.md`)*

> Does the change fit the system design without introducing coupling or boundary violations?

**Baseline questions (apply in every review):**
- Does the change respect established dependency directions?
- Does it introduce cyclic dependencies between modules?
- Does it reach into another module's internals rather than its published interface?
- Does it create a new cross-service coupling without a compensation strategy?

**Escalate to `architecture.md` when:** the change crosses service or module boundaries, introduces a new dependency, or alters system topology.

---

### 9  Testability  *(baseline in all reviews; full depth → `testability.md`)*

> Can this code be tested in isolation, and is it designed to be?

**Baseline questions (apply in every review):**
- Are dependencies injected rather than obtained from global state?
- Is business logic separated from I/O and framework glue?
- Are external boundaries (network, file system, clock) isolated behind an interface?
- Are functions small enough to exercise one behaviour at a time?

**Escalate to `testability.md` when:** the change is in core business logic, the domain model, or any component where test isolation is architecturally important.

---

### 10  Observability  *(baseline in all reviews; full depth → `observability.md`)*

> Does the code emit sufficient signals to diagnose problems in production?

**Baseline questions (apply in every review):**
- Are errors logged with enough context (operation, IDs, message) to reconstruct the failure?
- Are logs structured — not free-form strings?
- Are latency and error-rate metrics emitted on changed paths?
- Are trace spans created for cross-service or cross-process calls?
- Is sensitive data absent from log output?

**Escalate to `observability.md` when:** the change introduces a new service, a background worker, a message consumer, or any path with an SLO.

---

## Criteria × rubric matrix

**Full** = the rubric's primary focus with an exhaustive checklist.
**Baseline** = the four baseline questions above applied in domain context.
**—** = out of scope for this rubric.

| Criterion | general | web | api | databases | sdk | services | security | performance | architecture | testability | observability |
|---|---|---|---|---|---|---|---|---|---|---|---|
| Correctness | Full | Full | Full | Full | Full | Full | — | — | — | — | — |
| Completeness | Full | Full | Full | Full | Full | Full | — | — | — | — | — |
| Consistency | Full | Full | Full | Full | Full | Full | — | — | — | — | — |
| Soundness | Full | Full | Full | Full | Full | Full | — | — | — | — | — |
| Complexity | Full | Full | Full | Full | Full | Full | — | — | — | — | — |
| Security | Baseline | Baseline | Baseline | Baseline | Baseline | Baseline | **Full** | — | Baseline | — | — |
| Performance | Baseline | Baseline | Baseline | Baseline | Baseline | Baseline | — | **Full** | Baseline | — | — |
| Architecture | Baseline | Baseline | Baseline | Baseline | Baseline | Baseline | — | — | **Full** | — | — |
| Testability | Baseline | Baseline | Baseline | Baseline | Baseline | Baseline | — | — | Baseline | **Full** | — |
| Observability | Baseline | Baseline | Baseline | Baseline | Baseline | Baseline | — | — | Baseline | — | **Full** |

---

## Citing criteria in findings

A finding may violate more than one criterion simultaneously.  List all that apply in the **Criteria** field, separated by commas.  Link each to the relevant section of this file and, when a specialist rubric check is involved, to the specific rubric item.

Examples:

- `[Correctness (1)](../criteria.md#1--correctness)` — logic does not match spec; single criterion.
- `[Security (6)](../criteria.md#6--security), [Soundness (4)](../criteria.md#4--soundness)` + `[security.md § S‑10](security.md#s-10)` — authorisation bypass that also rests on a flawed trust assumption; two criteria, one specialist check.
- `[Observability (10)](../criteria.md#10--observability), [Completeness (2)](../criteria.md#2--completeness)` + `[observability.md § O‑4](observability.md#o-4)` — errors silently swallowed on a required path; the omission is both incomplete handling and an observability gap.
- `[Complexity (5)](../criteria.md#5--complexity), [Testability (9)](../criteria.md#9--testability)` — a deeply nested function with no injection points; complexity and testability are both degraded.
