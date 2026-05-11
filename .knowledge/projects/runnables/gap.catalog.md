# Gap Analysis: Catalog — Active Catalog Integration Backlog

> Status: active catalog backlog
> Date: 2026-03-31
> Companion: [gap-analysis.md](./gap-analysis.md), [gap.migrations.md](./gap.migrations.md), [plan.md](./plan.md)

This document tracks catalog-specific work that still belongs to the runnables rollout, especially where web/catalog integration has not been completed yet.

## Rules

- Catalog integration gaps belong here, not as open branch findings unless they are reproduced as concrete bugs.
- Missing consumer migration is not itself an active branch bug when the branch intentionally adopted the new catalog contract.
- Reopen a bug from this backlog only when active catalog integration work demonstrates a real failure.

## Active Catalog Scope

### C1. Evaluator Schema Key Consumer Alignment

**What:** The evaluator/catalog payload now uses the new key set. Consumer updates belong to the catalog integration backlog.

**Current state:**
- `ground_truth_key` was removed
- `advanced` was renamed to `x-ag-ui-advanced`
- known frontend code previously read the older keys

**Target state:**
- catalog/web consumers read the new contract
- any remaining use of `advanced` or `ground_truth_key` is removed or redesigned as part of active catalog integration
- no backward-compatibility emission of the old keys is added unless a later scoped bug explicitly justifies it

**Depends on:** active web/catalog integration work

### C2. Web Catalog Integration Validation

**What:** The web-side catalog integration still needs direct validation against the new runnable catalog contract.

**Current state:**
- API/catalog contract cleanup has moved ahead of complete web integration
- this branch is not keeping legacy catalog key compatibility as a blanket rule

**Target state:**
- web catalog flows validate against the new contract end-to-end
- any actual break is reopened as a concrete catalog/web bug with evidence
- gaps discovered during integration are tracked here first, then promoted to findings only when they are confirmed defects

**Depends on:** consumer work tracked in [gap.migrations.md](./gap.migrations.md)
