# guidelines.md – Code‑Review File Structure

This file is a **reference** for the code‑review agent's file system.  It answers: what exists, where it lives, what it contains, and whether it can be changed.  For step‑by‑step instructions on how to conduct a review, see `instructions.md`.  For output requirements, see `deliverables.md`.

---

## Documentation modes

This system follows the Diátaxis framework.  Each artifact belongs to exactly one mode:

| Mode | Question answered | Used when |
|---|---|---|
| **How‑to guide** | How do I accomplish X? | Reviewer is working |
| **Reference** | What is the complete list of Y? | Reviewer needs a fact |
| **Explanation** | Why does Z work this way? | Reviewer is studying |
| **Tutorial** | How do I learn to do W? | Reviewer is learning |

`instructions.md` is a how‑to guide.  `deliverables.md`, `criteria.md`, and `rubrics/` are reference.  `guidelines.md` (this file) is reference.  Do not mix modes within a single file.

---

## Artifact map

### Harness – fixed reference files

These files define the review process.  They are created by administrators and read before every run.  Agents must not write to harness files during a review.

| File / Folder | Type | Required? | Mutable? | Purpose |
|---|---|---|---|---|
| `guidelines.md` | File | Recommended | Yes (admin only) | This file – structure overview |
| `instructions.md` | File | **Required** | Yes (admin only) | Step‑by‑step review procedure |
| `deliverables.md` | File | **Required** | Yes (admin only) | Output requirements and severity definitions |
| `criteria.md` | File | **Required** | Yes (admin only) | Universal review criteria — the 10 criteria every review assesses |
| `templates/` | Folder | Optional | Static during run | Reusable starting‑point files |
| `rubrics/` | Folder | Optional | Static during run | Reviewer‑role rubrics — one file per domain or specialist area |

### Per‑run input

Created once per review by the requester before the agent starts.

| File | Type | Required? | Mutable? | Purpose |
|---|---|---|---|---|
| `scope.md` | File | **Required** | Immutable during run | What is being reviewed and why |

### Per‑run execution

Created and maintained by the agent during execution.

| File | Type | Required? | Mutable? | Purpose |
|---|---|---|---|---|
| `plan.md` | File | **Required** | Yes | Review strategy and pass order |
| `progress.md` | File | Usually required | Yes (checklist) | Task status and completion tracking |

### Per‑run working memory

Internal to the agent.  Not part of final deliverables.

| File / Folder | Type | Required? | Mutable? | Purpose |
|---|---|---|---|---|
| `notes/` | Folder | Optional | Yes | Provisional hypotheses and scratchpad |
| `evidence/` | Folder | Optional* | Yes | Supporting snippets, logs, reproduction steps |
| `metadata.json` | File | Optional | Yes | Machine‑readable state for tooling |

\* Required when non‑trivial findings exist.

### Per‑run promoted outputs

Conclusions drawn from working memory, intended for stakeholders.

| File | Type | Required? | Mutable? | Purpose |
|---|---|---|---|---|
| `findings.md` | File | If issues found | Yes (table) | Confirmed defects with remediation options |
| `risks.md` | File | Optional | Yes (table) | Systemic concerns not yet confirmed defects |
| `questions.md` | File | Optional | Yes (table) | Clarifications needed from author or requester |

### Per‑run synthesis

Produced last; intended for decision‑makers.

| File | Type | Required? | Mutable? | Purpose |
|---|---|---|---|---|
| `summary.md` | File | Usually required | Yes (until final) | Narrative overview for stakeholders |
| `scorecard.md` | File | Optional | Yes (until final) | Quantitative metrics and readiness verdict |

---

## Template and rubric index

### `templates/`

| Template file | Artifact it serves |
|---|---|
| `scope.md` | `scope.md` |
| `plan.md` | `plan.md` |
| `progress.md` | `progress.md` |
| `findings.md` | `findings.md` |
| `risks.md` | `risks.md` |
| `questions.md` | `questions.md` |
| `summary.md` | `summary.md` |
| `scorecard.md` | `scorecard.md` |
| `metadata.json` | `metadata.json` |

### `rubrics/`

Each rubric represents a **reviewer role**.  Select the rubric(s) that match the review type declared in `scope.md`.  All domain rubrics apply `criteria.md` in their specific context.  Specialist rubrics provide a full deep-dive on a single criterion.

**Domain rubrics** — apply all 10 universal criteria in a specific functional context:

| Rubric file | Domain |
|---|---|
| `general.md` | Code quality, logic, style (default baseline pass) |
| `web.md` | Browser UI — XSS, accessibility, client-side performance, browser security |
| `api.md` | HTTP / gRPC / GraphQL — contracts, versioning, error codes, backward compatibility |
| `databases.md` | Schema, migrations, query safety, data integrity |

**Domain rubrics (extended)** — same baseline model as above, for specific deployment forms:

| Rubric file | Domain |
|---|---|
| `sdk.md` | Libraries and packages — API ergonomics, backward compatibility, consumer DX |
| `services.md` | Backend services — lifecycle, resilience, messaging, deployment safety |

**Specialist rubrics** — full deep-dive on one criterion; escalate from any domain rubric when warranted:

| Rubric file | Criterion (from `criteria.md`) |
|---|---|
| `security.md` | Security (6) — OWASP Top 10, auth, injection, secrets |
| `performance.md` | Performance (7) — complexity, I/O, caching, resource use |
| `architecture.md` | Architecture (8) — service boundaries, coupling, scalability, ADRs |
| `testability.md` | Testability (9) — dependency injection, seams, isolation |
| `observability.md` | Observability (10) — logging, metrics, tracing, operability |

---

## Lifecycle sequence

```
Harness (read)
  └─ Scope defined
       └─ Plan drafted
            └─ Execution (notes, evidence, progress updated)
                 └─ Outputs promoted (findings, risks, questions)
                      └─ Synthesis produced (summary, scorecard)
```

---

## Mutability rules

- **Admin‑only mutable:** `guidelines.md`, `instructions.md`, `deliverables.md`, templates, rubrics.
- **Agent‑mutable:** all per‑run execution, working‑memory and output files.
- **Immutable during run:** `scope.md`.
- **Append‑preferred:** `evidence/` files — add or extend; do not delete evidence.
- **Final on delivery:** `summary.md`, `scorecard.md` — treat as static after the review is closed.

---

*Last updated: 2026-02-27.  Update this file whenever the artifact structure changes.*
