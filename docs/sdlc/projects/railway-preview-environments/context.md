# Context: Railway Preview Environments

## Background

Agenta OSS is currently self-hosted primarily through Docker Compose. We want a cloud-hosted path on Railway that is scriptable end-to-end and can later support ephemeral preview environments for pull requests.

The requested direction is to start with a programmatic OSS deployment first, then build toward preview environments.

## Problem Statement

We need a repeatable, automated deployment system on Railway that:

1. Works without manual dashboard configuration (beyond initial credentials/API token provisioning)
2. Preserves Agenta routing assumptions (`/`, `/api`, `/services`)
3. Supports environment lifecycle automation for PR previews

## Goals

1. Define and implement a CLI-first OSS deployment workflow on Railway.
2. Make deployment reproducible and idempotent.
3. Establish a safe migration path from baseline OSS deployment to PR preview environments.
4. Keep operational runbooks simple enough for CI usage.

## Non-Goals (for initial milestone)

1. EE deployment parity.
2. Full production SRE hardening (multi-region HA, advanced autoscaling).
3. UI-only setup instructions.

## Constraints

1. Agenta web/api/services must be exposed in a path-based layout.
2. Agenta API has root path/CORS assumptions that make split-domain deployments risky without code changes.
3. Railway staged changes and service config behavior must be handled consistently in scripts.
4. Database initialization and migrations must be automated and repeatable.

## Success Definition

1. A new Railway project can be bootstrapped from scripts only.
2. OSS stack is reachable and healthy through a single gateway domain.
3. CI can create/update/delete preview environments per PR with deterministic behavior.
