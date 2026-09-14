# Wallet design: deferred scope

This document records intentional deferrals from the version-one wallet design. They are not
rejections: each needs product semantics or measured operational evidence before it becomes a table,
column, or processing path.

## Version-one baseline

The organization owns the shared wallet. `wallet_credits` are organization-owned. The transactional
projection has one general organization `wallet_balances` row and one available-value row per credit.
`measurements` attribute managed LLM/MCP/SBX use to a project, user, and agent; `wallet_debits`
apply independently delivered gateway charges and, when funded, point to their selected credit. Indexed
immutable measurements are the analytics journal.

## 1. Hierarchy-scoped wallet value and budgets

Deferred extensions:

- workspace-, project-, or user-owned credits and budgets;
- the corresponding scope columns on `wallet_credits`;
- workspace-, project-, or user-specific general `wallet_balances` rows;
- selection, debit, and `check(delta)` rules for spending scoped value before organization value; and
- presenting an enforceable workspace/project/user balance rather than project-attributed activity.

Project-attributed spend is not a project balance. For example, a project can have spent 10,000 `musd`
from a shared organization credit without owning any independently spendable remainder. Add scope
rows only when product policy defines who owns the value, which credits can fund a request, and how
the budget is enforced.

## 2. Denormalized organization and workspace IDs on measurements

The baseline measurement carries `project_id`, `user_id`, and `agent_id`. It obtains organization
and workspace through the project hierarchy when that hierarchy is local to the wallet transaction
database. Copy `organization_id` and `workspace_id` onto the record only if the hierarchy is in a
different database, a local join is unavailable at the required query boundary, or attribution must
remain frozen after hierarchy changes.

Organization, workspace, user, and agent IDs are validated logical identifiers, not foreign keys.
`project_id` is a real FK only if the project table is physically local in the same core database;
otherwise it too is validated without a database FK, following tracing records. This is a
physical-topology decision. It should be made when the wallet database placement and the
project-hierarchy access path are selected, not by adding duplicated identifiers speculatively.

The existing `meters.organization_id` FK/cascade is a separate legacy-schema cleanup candidate. It is
not the wallet rule and needs its own migration/retention review before removal.

## 3. Analytics rollups and historical balance snapshots

Version one creates no `gateway_rollups`, `wallet_credit_rollups`, `wallet_debit_rollups`, or
`wallet_balance_snapshots`. Raw measurements and immutable financial history are narrow, indexed
journal rows; the live general `wallet_balances` row answers the current wallet value.

Introduce a derived table only after a concrete report has measured latency, cost, freshness, or
retention requirements that raw journal queries cannot meet. Its grain must be specific to that
report—for example, daily gateway activity or an as-of organization-balance chart—and it must define
how late measurements and corrections rebuild it. Do not create a generic `wallet_rollups` table.

This deferral does not remove a future Class-B billing calculation. If an internal resource moves from
Stripe arrears to wallet prepaid, an idempotent periodic debit can be calculated from the existing
`meters` aggregate. That is a functional billing operation, not an analytics-rollup table.
