# Python agent review — orchestration plan

Date: 2026-07-06 (run 2026-07-07). Orchestrator: this session. Prompt: `REVIEW-PROMPT.md`.

## Status

- [x] Scout: inventory re-verified 2026-07-07 (service 611 lines, SDK 10,897 lines — matches
  section 5 of the prompt exactly). Runner executive summary read.
- [x] Wave 1: eight reviewers launched in parallel — all eight findings files delivered.
  Totals: 0 blocker / 21 high / 42 medium / 33 low.
- [x] Wave 2: reduce — all eight findings files read; `reports/00-executive-summary.md` written
  (8 cross-cutting themes; must-gate-launch list of 10; runner A-10/A-2/Theme-6 refuted here).
- [x] Wave 3: committed on lane `docs/python-agent-review-2026-07-06`, draft PR #5100 based on
  `big-agents` (11 files, verified).

## Lane table

| Lane | Area | Model / effort | Findings file | Status |
|---|---|---|---|---|
| A | Architecture, boundaries, orchestration | Fable, high | `findings/arch-boundaries.md` | done (0/3/6/3) |
| B | Wire contract and DTOs | Fable, high | `findings/wire-contract-dtos.md` | done (0/4/8/4) |
| C | Tools, connections, secrets, MCP (security) | Fable, high | `findings/tools-secrets-security.md` | done (0/2/5/8) |
| D | Vercel stream adapter | Fable, high | `findings/vercel-stream.md` | done (0/3/5/3) |
| E | Service config, schemas, tracing | Sonnet, medium | `findings/service-config-tracing.md` | done (0/2/3/3) |
| F | Harness and platform adapters | Sonnet, medium | `findings/harness-adapters.md` | done (0/1/3/3) |
| G | Tests and QA (runs the suite) | Sonnet, medium | `findings/tests-qa.md` | done (0/3/3/4, suite green 540+4) |
| H | Python idioms and code quality | Fable, high | `findings/python-idioms-quality.md` | done (0/3/9/5) |

## Reconciliation cross-references (runner review → these lanes)

- A-14 duplicated orchestration seam → lane A
- A-1/A-2 credential + API base smuggled through telemetry → lanes B, E
- A-7 no /health probe, deprecated /run alias → lane B
- A-9 three-mirror contract at its ceiling → lane B
- A-10 policy default owned by wrong side → lane C
- A-4 harness knowledge should be one table → lane F
- Security F1/F2/F9 caller bearer + provider keys reach agent env → lane C
