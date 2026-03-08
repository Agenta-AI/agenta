# Execution Plan: Railway OSS -> Preview Environments

## Overview

Implement Railway adoption in three stages:

1. Programmatic OSS baseline deployment
2. Deployment hardening and CI codification
3. Automated per-PR preview environments

---

## Phase 0: Planning and Design Freeze -- COMPLETE

Goal: align architecture and delivery scope before implementation.

Tasks:
- [x] Confirm CLI-first feasibility
- [x] Define gateway-first topology
- [x] Document phased rollout plan and success criteria
- [x] Review plan with stakeholders and lock Phase 1 scope

Deliverables:
- Planning workspace under `docs/design/railway-preview-environments/`

---

## Phase 1: Programmatic OSS Baseline -- COMPLETE

Goal: deploy Agenta OSS on Railway end-to-end using scripts only.

### 1.1 Bootstrap Script

Tasks:
- [x] Create bootstrap script for project and service creation
- [x] Create services: gateway, web, api, services, worker-evaluations, worker-tracing, cron, supertokens, postgres, redis
- [x] Add domain to gateway service
- [x] Guard against duplicate volume creation

### 1.2 Configuration Script

Tasks:
- [x] Apply shared and service-specific environment variables
- [x] Configure internal service endpoints and public URLs
- [x] Configure healthcheck paths and startup commands

### 1.3 Database Init and Migration

Tasks:
- [x] Programmatically initialize required OSS databases
- [x] Run migration runner in controlled order
- [x] Use correct venv python path for alembic image

Notes:
- We now use three logical databases (`agenta_oss_core`, `agenta_oss_tracing`, `agenta_oss_supertokens`).
- This resolved Alembic revision conflicts from shared-database setup.

### 1.4 Validation and Smoke Tests

Tasks:
- [x] Implement smoke script for `/w`, `/api/health`, `/services/health`
- [x] Verify workers and cron deployment status via CLI
- [x] Produce CI-friendly success/failure output
- [x] Default smoke to no-autorepair for clean pass/fail signals

Notes:
- `worker-tracing` is running and confirmed to write spans.
- `worker-evaluations` is running and listening on Taskiq broker.
- `cron` is running and logging scheduled executions.

### 1.5 Gateway Nginx

Tasks:
- [x] Configure Railway IPv6 DNS resolver (`[fd12::10]`)
- [x] Use variable-based proxy_pass for dynamic DNS re-resolution
- [x] Add rewrite rules for path prefix stripping
- [x] Set proper connect/read/send timeouts

Milestone exit criteria:
- A fresh Railway project reaches healthy OSS state through scripts only. **VERIFIED 2026-02-19.**

---

## Phase 2: CI Integration -- IN PROGRESS

Goal: wire GitHub Actions to build images and deploy/destroy preview environments.

### 2.1 Build and Push PR-Tagged Images

Tasks:
- [x] Create GitHub Actions workflow that builds `api`, `web`, `services` images on PR open/sync
- [x] Tag images as `pr-<number>-<short-sha>`
- [x] Push to GHCR under `ghcr.io/agenta-ai/`
- [x] Use Docker Buildx with GHA cache for faster builds

Workflow: `.github/workflows/06-railway-preview-build.yml`
Trigger: `pull_request` (opened, synchronize, reopened) + `workflow_dispatch`.

### 2.2 Deploy Preview Environment

Tasks:
- [x] Create GitHub Actions workflow that calls `preview-create-or-update.sh`
- [x] Pass `PR_NUMBER` and `IMAGE_TAG` from the build step
- [x] Extract preview URL from script output
- [x] Post preview URL as a PR comment (create or update)
- [x] Update comment on failure with link to workflow run logs

Workflow: `.github/workflows/07-railway-preview-deploy.yml`
Trigger: called by 06 after build completes (reusable `workflow_call`) + `workflow_dispatch`.

Dependencies:
- `RAILWAY_TOKEN` as a GitHub Actions secret
- GHCR read access from Railway (images are in the same org, should work if public or with token)

### 2.3 Destroy Preview on PR Close + Stale Cleanup

Tasks:
- [x] Create GitHub Actions workflow that calls `preview-destroy.sh` on PR close
- [x] Pass `PR_NUMBER` to derive project name
- [x] Update PR comment to show "Destroyed" status
- [x] Add daily cron job that calls `preview-cleanup-stale.sh`
- [x] Support manual dispatch with dry-run mode

Workflow: `.github/workflows/08-railway-preview-cleanup.yml`
Trigger: `pull_request` (closed) + `schedule` (daily 06:00 UTC) + `workflow_dispatch`.

### 2.4 Script Reliability (ongoing)

Tasks:
- [x] Make bootstrap idempotent (volume guard, service creation guard)
- [x] Make deploy-from-images retry-safe (alembic retry loop)
- [ ] Add structured logging and clear error messages
- [ ] Add dry-run mode for configuration steps

Milestone exit criteria:
- PR open/update/close automatically manages preview environment lifecycle via CI.

---

## Phase 3: Hardening and Polish

Goal: production-grade preview environment lifecycle.

### 3.1 Stability

Tasks:
- [ ] Add scheduled cleanup for stale preview projects (no PR activity for N days)
- [ ] Track Railway usage/cost to prevent resource leakage
- [ ] Add rollback helper (redeploy previous stable image tag)

### 3.2 Config Standardization

Tasks:
- [ ] Document canonical variable matrix per service
- [ ] Standardize service naming and tagging conventions

### 3.3 Validation

Tasks:
- [ ] Add OTLP end-to-end check (write test span, verify in DB)
- [ ] Add evaluation end-to-end check (submit eval, check completion)

Milestone exit criteria:
- Preview environments are reliable, cost-controlled, and self-cleaning.

---

## Dependencies

1. `RAILWAY_TOKEN` as a GitHub Actions secret.
2. GHCR credentials for pushing images (already available via `GITHUB_TOKEN` in Actions).
3. Railway CLI available in CI runner (install step or pre-built action).

## Resolved Decisions

1. Deploy strategy for previews: prebuilt images per service (PR-tagged).
2. Redis topology: single Redis instance for both volatile and durable.
3. Migration execution: dedicated migration job step (`alembic` service).
4. DNS resolution: Railway IPv6 resolver with variable-based proxy_pass.
