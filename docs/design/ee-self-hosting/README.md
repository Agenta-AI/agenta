# EE Self-Hosting

## Overview

Decouple the Enterprise Edition from cloud-only concerns (billing, Stripe, reverse trials) so that self-hosted customers get enterprise features (RBAC, entitlements, org management) without cloud dependencies.

## Problem

Today "EE" ≈ "Cloud". It bundles:
- Features needed for self-hosting (RBAC, entitlements, org management)
- Features only relevant to cloud (billing, Stripe integration, reverse trials, metering)

Self-hosted enterprise customers need the first set but not the second. There is also missing functionality for self-hosting scenarios: configuring org entitlements, default entitlements, and controlling who can create organizations.

## Documents

| File | Description |
|------|-------------|
| `context.md` | Background, motivation, goals, and non-goals |
| `research.md` | Comprehensive analysis of the current EE codebase: plans, entitlements, billing, RBAC, org lifecycle, meters, throttling, frontend gating, env vars, and identified gaps |
| `rfc-0.md` | RFC: Self-hosted EE — Stripe as differentiator, enterprise plan, billing UI hidden |
| `rfc-1.md` | RFC: Org creation restriction — `AGENTA_ORG_CREATORS` allowlist |
| `plan.md` | Execution plan with milestones and stacked PRs |
| `doc-0.md` | Draft: documentation changes needed for self-hosted EE |
| `doc-1.md` | Draft: documentation changes needed for org creation restriction |
| `status.md` | Living progress tracker — current state, decisions, blockers |
