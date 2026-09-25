# Credits, sandbox allowances and managed tools

Status: draft OpenSpec package, written 2026-09-22, moved into the repository 2026-09-25. **New to this work? Read [HANDOFF.md](HANDOFF.md) first.** Mahmoud approved documenting included sandbox usage and the managed-tool structure, and updating the backlog. This is not approval of every requirement, commercial term, implementation, merge or rollout.

## Start here

1. Read this index for the change boundaries.
2. Read [the source map](source-map.md) for implemented versus planned behavior.
3. Read [the decision register](decision-register.md) for all 22 original questions and newer refinements.
4. Open each proposal, then its design, requirements and unchecked tasks.
5. Use [the next-step plan](next-steps.md) to choose one implementation slice.

## Changes

| OpenSpec change | Status | Backlog card |
| --- | --- | --- |
| [Document wallet foundation](openspec/changes/document-wallet-foundation/proposal.md) | Describes implemented code on unmerged #6050; no production acceptance claimed | 2 |
| [Connect model gateway and wallet](openspec/changes/connect-model-gateway-wallet/proposal.md) | JP's planned second phase; not implemented | 4, 9 |
| [Harden production billing](openspec/changes/harden-wallet-production-billing/proposal.md) | Original open questions plus explicitly identified safety refinements | 1, 3, 4, 8 |
| [Independent credit funding](openspec/changes/add-independent-credit-funding/proposal.md) | Confirmed lifetime purchase requirement; implementation pending | 1, 5 |
| [Include sandbox usage](openspec/changes/include-sandbox-usage/proposal.md) | Agreed approach; implementation pending; quantities and overage policy unselected | 10 (new) |
| [Managed tool actions](openspec/changes/add-managed-tool-actions/proposal.md) | Agreed structure; implementation pending; first provider/action unselected | 6 |
| [Usage visibility and release scope](openspec/changes/explain-usage-and-release-scope/proposal.md) | Proposed implementation and acceptance requirements | 7, 8 |

All changes use `schema: spec-driven` and contain proposal.md, design.md, tasks.md and capability requirement deltas. No change has been archived into a shipped specification. Task checkboxes are deliberately unchecked, including verification of the branch baseline.

## Terms

An entitlement is permission or a plan limit. A meter counts resource usage in a defined period. Included sandbox usage is a quantity of covered compute, not money. A wallet holds spendable monetary credit. A sandbox is the compute environment running agent work. A managed action uses an Agenta-controlled provider route with explicit funding rules. The gateway accepts requests and enforces routing and policy. MCP means Model Context Protocol. Composio is one provider of integration execution, not the billing authority.

## Boundaries

One organization wallet remains authoritative. Included usage and general-purpose credit are different benefits. An active Stripe subscription is not necessary for lifetime entitlements, monthly included usage or one-time top-ups. Free offers may also include compute and optional credits. No default free-plan ban on funded actions is approved. General-purpose allowance and purchased lots need not have different spending eligibility. Restricted credits remain an optional original design question.

This is a standalone OpenSpec root, separate from the repository's top-level `openspec/` folder, whose config is scoped to the agent-template feature. Keep it separate until the wallet changes are accepted; then move the change directories into the top-level folder without replacing unrelated config or specs. Backlog card numbers refer to a private tracking board; everything a card says is in these files.

## Validation

Run OpenSpec 1.13.1 from this package root:

```sh
openspec validate --all --strict --no-interactive
```

Structural validation does not run runtime tests. [Validation results](validation.md) record the actual check.
