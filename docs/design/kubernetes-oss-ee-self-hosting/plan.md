# Plan

## Overview

We will split the Kubernetes self-hosting work into three focused PRs.

## PR 1 — Add missing Kubernetes workers

### Goal

Bring the Helm chart up to date with the current runtime topology.

### Scope

- Add `worker-webhooks`
- Add `worker-events`
- Follow the existing worker deployment pattern
- Keep this edition-agnostic
- Update Kubernetes docs to reflect the actual workload set
- Test OSS deployment on Kubernetes in an isolated namespace
- Open a dedicated PR

## PR 2 — Add generic env/secret extension points

### Goal

Support self-hosted configuration needs cleanly without hardcoding every env var into the chart.

### Scope

- Add generic Helm env/secret extension points using best practices
- Keep the mechanism edition-agnostic
- Document EE-relevant self-hosting envs, including:
  - access control / org management envs
  - SendGrid
  - Composio
  - New Relic
- Keep billing-related envs unset by default for self-hosted EE
- Keep Cloudflare Turnstile unset by default for self-hosted EE
- Open a dedicated PR

## PR 3 — Add unified OSS/EE switch

### Goal

Use one chart for OSS and EE with a clean user-facing setup path.

### Switch

- Use `AGENTA_LICENSE=oss|ee`

### Scope

- Make chart defaults derive from `AGENTA_LICENSE`
- Derive:
  - default image repositories
  - web runtime command/path
  - Alembic runner/config
  - bundled Postgres DB names
- Add curated example files:
  - `values-oss.example.yaml`
  - `values-ee.example.yaml`
- Test both OSS and EE installs in isolated namespaces
- Update Kubernetes docs for the unified OSS/EE path
- Open a dedicated PR

## Order

1. PR 1 — missing workers
2. PR 2 — env/secrets extension points
3. PR 3 — OSS/EE switch + docs/examples
