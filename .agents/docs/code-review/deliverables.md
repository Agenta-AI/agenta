# deliverables.md – Required Outputs

This is a **reference** file.  It lists every artifact the agent must or may produce, the format of each, and the criteria by which each is judged complete.  For step‑by‑step instructions on when and how to produce these artifacts, see `instructions.md`.

---

## Mandatory deliverables

These must be present before a review is closed.

| Deliverable | File | Format | Complete when… |
|---|---|---|---|
| Review plan | `plan.md` | Markdown prose + list | All passes named, risk order stated, time budgets set |
| Progress log | `progress.md` | Markdown checklist / table | All planned tasks marked done or deferred with reason |
| Findings | `findings.md` | Markdown table or table‑list | Every confirmed defect has severity, evidence ref, and ≥ 1 remediation option |
| Summary | `summary.md` | Markdown prose | Health verdict, top findings, top risks, next steps |
| Metadata | `metadata.json` | JSON | Completion flag is `true`; counts match `findings.md` |

---

## Conditional deliverables

Produce these only when the condition is met.

| Deliverable | File | Condition |
|---|---|---|
| Risks | `risks.md` | One or more systemic concerns identified |
| Questions | `questions.md` | One or more clarifications needed from author or requester |
| Evidence | `evidence/` | One or more non‑trivial findings exist |
| Scorecard | `scorecard.md` | Scope or stakeholders require quantitative summary |

---

## Severity levels

Use these definitions consistently in `findings.md`.

| Severity | Definition | Example |
|---|---|---|
| **Critical** | Exploitable or data‑loss risk in production; blocks release. | Remote code execution, plaintext password storage |
| **High** | Significant functional or security defect; should fix before release. | Broken authentication check, uncaught exception on main path |
| **Medium** | Defect with limited or mitigated impact; fix before next sprint. | Missing input validation on internal endpoint, error message leaking stack trace |
| **Low** | Minor quality or style issue; fix opportunistically. | Unused import, inconsistent naming convention |
| **Info** | Observation or positive note; no action required. | Well‑structured module, good test coverage |

---

## Risk categories

Use these in `risks.md` for the `Category` column.

| Category | Covers |
|---|---|
| Security | Auth, injection, secrets, cryptography, permissions |
| Performance | Algorithmic complexity, N+1 queries, blocking I/O |
| Maintainability | Coupling, dead code, readability, test coverage |
| Architecture | Dependency direction, service boundaries, scalability |
| Compliance | Licence, data‑privacy regulation, audit trail |
| Reliability | Error handling, retry logic, circuit breakers |

---

## Scorecard metrics

Populate `scorecard.md` with the following.  Use only those that apply.

| Metric | Source |
|---|---|
| Critical findings | Count of `severity = critical` rows in `findings.md` |
| High findings | Count of `severity = high` rows |
| Medium findings | Count of `severity = medium` rows |
| Low findings | Count of `severity = low` rows |
| Open risks | Count of open rows in `risks.md` |
| Open questions | Count of open rows in `questions.md` |
| Files reviewed | Count from `metadata.json` |
| Review coverage (%) | `files_reviewed / files_in_scope × 100` |
| Review duration (min) | From `metadata.json` timestamps |
| Overall verdict | `pass` / `pass with conditions` / `fail` |

Limit the scorecard to 10–15 metrics.

---

## Format requirements

### Findings table columns

`ID` · `Severity` · `Location` · `Criteria` · `Condition` · `Cause` · `Consequence` · `Evidence` · `Remediation`

Alternatively, use a table‑list layout with each finding as a subsection (`### F‑001 …`) containing those fields as subheadings.  Use the table‑list layout when remediation options or consequences are verbose.

### Risks table columns

`ID` · `Category` · `Description` · `Likelihood` · `Impact` · `Evidence` · `Mitigation` · `Status`

### Questions table columns

`ID` · `Question` · `Context / Evidence` · `Provisional suggestions` · `Status`

### Evidence files

- Name: `evidence/<concern-slug>.md` (e.g., `evidence/auth-bypass.md`).
- Begin each file with the finding or risk ID it supports.
- Include: file path, line range, a code snippet (use a fenced block), and a one‑sentence explanation of relevance.

### Metadata schema

See `templates/metadata.json` for the canonical field list.  Required fields: `review_id`, `created_at`, `updated_at`, `scope_ref`, `reviewed_files`, `finding_counts`, `complete`.

---

## Rubric references

For the universal criteria dimensions and the coverage matrix, see `criteria.md`.

**Domain rubrics** (apply all 10 criteria in a functional context):
- `rubrics/general.md` – code quality, logic, style (default baseline pass)
- `rubrics/web.md` – XSS, accessibility, client-side performance, browser security
- `rubrics/api.md` – contracts, versioning, error codes, backward compatibility
- `rubrics/databases.md` – schema, migrations, query safety, data integrity
- `rubrics/sdk.md` – API ergonomics, backward compatibility, consumer DX (libraries and packages)
- `rubrics/services.md` – lifecycle, resilience, messaging, deployment safety (backend services)

**Specialist rubrics** (full deep-dive on one criterion; escalate from any domain rubric):
- `rubrics/security.md` – criterion 6: OWASP Top 10, auth, injection, secrets
- `rubrics/performance.md` – criterion 7: complexity, I/O, caching, resource use
- `rubrics/architecture.md` – criterion 8: service boundaries, coupling, scalability, ADRs
- `rubrics/testability.md` – criterion 9: dependency injection, seams, isolation
- `rubrics/observability.md` – criterion 10: logging, metrics, tracing, operability
