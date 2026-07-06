# Runner code review — 2026-07-05

Full-scope review of `services/runner/` (TS agent runner) before the agents launch next week.
Context: started as a POC, now near production. Primary author is a Python developer writing TS.

## Method (map-reduce)

Wave 1 — parallel reviewers, detailed findings in `findings/`:

- A `arch-boundaries` (Fable, deep): system architecture, responsibilities, boundaries, protocol design, extensibility/portability
- B `engine-sandbox-agent` (Fable, deep): engines/sandbox_agent/* — orchestration, run-plan, local vs Daytona, harness matrix, lifecycle, correctness
- C `tools-permissions-security` (Fable, deep): tools/*, permission-plan, Pi extension, secrets, MCP-disabled path, threat model
- D `entrypoints-sessions` (Sonnet): server/cli/entry/responder/sessions/*
- E `tracing-otel` (Sonnet): tracing/otel.ts state machine
- F `tests-qa` (Sonnet): test suite, coverage, gaps, goldens, QA
- G `ts-idioms-quality` (Fable, deep): idiomatic TS sweep, code organization per lgrammel / Mitchell Hashimoto principles

Wave 2 — synthesis into `reports/`: executive summary + per-area reports with short/medium/long-term actions.

## Status

- [x] Scout
- [x] Wave 1 — 7 findings files in findings/ (2 blocker, 36 high, 58 medium, 28 low)
- [x] Wave 2 — reports/00-executive-summary.md (cross-cutting themes + triaged roadmap)
