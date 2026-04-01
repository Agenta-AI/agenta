# instructions.md – How to Conduct a Code Review

This is a **how‑to guide**.  It assumes you are a competent reviewer ready to perform a structured code review.  Follow steps in order.  Branch on conditions as indicated.  Do not modify this file during a review.

For artifact definitions and mutability rules, see `guidelines.md`.  For output formats and severity levels, see `deliverables.md`.

---

## Before you start

1. Read `scope.md`.  Confirm the scope is clear and complete.  If it is missing, ambiguous, or contradictory, record a blocking question in `questions.md` and pause until resolved.
2. Select the rubric(s) from `rubrics/` that match the review type stated in the scope (e.g., `security.md`, `performance.md`).  If no rubric applies, proceed with `general.md` and note the absence in `plan.md`.
3. Read `deliverables.md` to confirm which outputs are mandatory for this run.

---

## Phase 1 – Plan

**Goal:** Produce `plan.md` before touching any code.

1. Identify the riskiest modules or files based on the scope's stated goals and constraints.
2. Order your review passes by risk: highest‑risk areas first.
3. List automated checks that should run before your passes (linting, secret scanning, static analysis).  Mark them as prerequisites in the plan.
4. For each pass, note the rubric category it maps to and the time budget.
5. If the changeset exceeds ~400 lines of meaningful logic, split it into smaller sub‑reviews and note this in `plan.md`.
6. Record your plan in `plan.md` using the template from `templates/plan.md`.

---

## Phase 2 – Execute

**Goal:** Produce notes and evidence; update `progress.md` as you go.

### Setting up progress tracking

1. Initialise `progress.md` from `templates/progress.md`.
2. Add one row per planned pass or file group.

### Reviewing code

For each file or module in your plan:

1. Open the file and read it in full before writing anything down.
2. Apply the selected rubric criteria in order.
3. If you observe something noteworthy:
   - Write a brief provisional note in `notes/` (one file per concern area or pass).
   - Capture the supporting code snippet, log, or reproduction steps in `evidence/` (one file per finding or reviewed file group).
4. If you are uncertain whether an observation is a defect or an intended design:
   - Record it as a provisional note, not a finding.
   - Add a question to `questions.md` if external clarification is needed.
5. After completing each file or module, mark the corresponding row in `progress.md` as done.

### Handling edge cases

- **If you reach the time budget before finishing a pass:** Mark remaining items as `deferred` in `progress.md`.  Note the deferral and its reason in `plan.md`.
- **If you discover a critical vulnerability:** Promote it immediately to `findings.md` with all available evidence before continuing.
- **If a file is out of scope:** Skip it and note the exclusion in `progress.md`.

---

## Phase 3 – Promote outputs

**Goal:** Move confirmed conclusions from working memory into the three output files.

### Promoting to `findings.md`

For each observation in `notes/` that you have verified with evidence:

1. Confirm it is a genuine defect (not a false positive or a question for the author).
2. Add a new entry to `findings.md` using the structure from `templates/findings.md`.  For each entry include:
   - **Criteria:** which standard, rule, or requirement was violated (link to the rubric).
   - **Condition:** what was found (quote or reference the code).
   - **Cause:** why it occurred.
   - **Consequence:** the potential impact.
   - **Severity:** one of `critical`, `high`, `medium`, `low` (see `deliverables.md` for definitions).
   - **Evidence:** link(s) to the relevant file(s) in `evidence/`.
   - **Remediation:** at least one concrete option; provide two or more when trade‑offs exist.
3. Do not include suspicions, rhetorical observations, or style preferences unless they violate a stated rubric criterion.

### Promoting to `risks.md`

For each systemic concern that is not a direct defect:

1. Add an entry using `templates/risks.md`.  Include category, description, likelihood, impact, evidence references, and one or more mitigation options.
2. If a concern escalates to a confirmed defect during the review, move it to `findings.md` and remove or mark the risk entry as promoted.

### Updating `questions.md`

1. Verify that every open question still needs an external answer.
2. If a question was resolved internally, record the resolution and close it.
3. If a question has been answered by the author, record the decision and update any related findings or risks.

---

## Phase 4 – Synthesise

**Goal:** Produce `summary.md` and, if required, `scorecard.md`.

Do this only after all findings, risks, and questions are finalised.

### Writing `summary.md`

1. State what was reviewed (scope), the review goals, and any constraints.
2. Summarise the key findings by theme or severity group — do not copy the full findings table.
3. List the most important risks.
4. Note any open questions and their impact on conclusions.
5. State the overall health assessment: one of `pass`, `pass with conditions`, `fail`.
6. List the top three recommended next steps.

### Writing `scorecard.md`

1. Populate the metrics table from `templates/scorecard.md`.
2. Derive counts directly from `findings.md` and `risks.md`.
3. Include: findings by severity, open questions count, review coverage (%), review duration, and overall verdict.
4. Pair each metric with a one‑line interpretation only when the metric alone is ambiguous.

---

## Phase 5 – Wrap up

1. Update `metadata.json` with final counts, timestamps, and the completion flag.
2. Verify that every mandatory deliverable listed in `deliverables.md` is present.
3. Mark `progress.md` as complete.
4. If any mandatory deliverable is missing, resolve the gap before closing the review.

---

## Conventions

- Write finding and risk IDs as `F‑001`, `F‑002`, … and `R‑001`, `R‑002`, …
- Write question IDs as `Q‑001`, `Q‑002`, …
- Link between artifacts using relative paths (e.g., `evidence/auth.md#L12`).
- Use neutral, factual language in all output files.  Never attribute intent or blame.
- Severity definitions: see `deliverables.md § Severity levels`.
- Rubric categories: see the relevant file in `rubrics/`.
