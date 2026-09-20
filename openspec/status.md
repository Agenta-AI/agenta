# Delivery status and review plan

Draft, 2026-09-20. This update authors documentation only. It does not implement the catalog or managed clients, register applications, change credentials, deploy new code, or merge a pull request.

## Proposed pull request boundaries

| Delivery | Contents | Dependency |
| --- | --- | --- |
| Current issue #6985 pull request | Existing manual registered-client implementation plus baseline and proposed OpenSpec documents. | Real-provider acceptance and remaining review checks are still open. |
| Catalog backend | Static definitions, authenticated list/detail, optional catalog selector, compatibility tests. | Existing fix. |
| Catalog frontend | Shared list-first journey, custom URL path, error/accessibility coverage. | Catalog backend. |
| Managed client backend and UI | Central environment configuration, setup decisions, pinned callback/refresh identity, UI rendering, self-hosting examples, guides. Split backend/UI if review size warrants it. | Catalog backend and existing fix. |
| Cloud delivery companion | API-only secret injection, environment references, operator runbook. | Managed client contracts; enable only after UI/docs are deployed. |

One OpenSpec change can span several implementation pull requests. Archive only when all its tasks are accepted. Do not mark proposed backend/frontend/deployment tasks done when the documentation pull request merges.

## What is done

The existing code at `c8e3cfd50359ddb4824a3972f0080ae6abd58318` adds unsupported-registration detection and manual clients. Earlier focused tests passed. The source audit, baseline specs, three change proposals/designs/task lists, and provider documentation draft are now written for review.

## What is not done

Managed configuration, catalog selection, provider registration, and production deployment are not implemented. Real GitHub/Slack application authorization and token fallback remain unverified. The existing isolated development deployment still represents the code-only commit; this documentation change does not update its images.

Specific review checks remain for manual registration isolation and cleanup. They are recorded in the existing fix's task list. Eight earlier acceptance tests could not set up the missing `ag_env` fixture.

## Validation for these documents

Run `openspec validate --all --strict --no-interactive`. Check proposal capability names against their delta paths, full modified requirement blocks against the baseline, Markdown links, secret-value absence, and whitespace. Test archive composition on a disposable copy only; keep the real changes active.

A successful OpenSpec status reports complete planning artifacts. It is not runtime or provider QA evidence. Keep public sources and source-code paths in [current-state.md](current-state.md); keep private deployment details in the durable operator appendix outside this public repository.

## Review responsibilities

### What I will do after approval

- Implement only the selected change or pull request slice.
- Run its focused and integration tests, then report exact-commit evidence.
- Ask separately before creating provider applications, changing live secrets, or enabling production.

### What Mahmoud needs to review now

- Confirm the catalog and managed-client experience in the two proposals.
- Review the proposed implementation choices in the README, especially scope policy and handling incomplete configuration.
- Choose the first implementation slice. No provider secrets are needed to review these documents.
