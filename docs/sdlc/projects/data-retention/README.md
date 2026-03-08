# Data Retention

## Overview
Data retention defines how long trace data is kept per plan. Retention windows are
enforced by a scheduled job that deletes traces older than the configured window
for each plan.

## Goals
- Enforce plan-based retention windows for traces.
- Keep deletion workloads bounded with batching.
- Provide a safe administrative endpoint for on-demand retention runs.

## Architecture
- Retention windows are configured in plan entitlements.
- A tracing DAO deletes root traces and their spans before a cutoff.
- A cron triggers the retention job via the admin billing endpoint.

## Runtime flow
1. Cron calls the admin endpoint `/admin/billing/usage/flush`.
2. The tracing service enumerates plans with finite retention.
3. For each plan, it batches projects and deletes traces older than the cutoff.
4. Logs include per-plan and total deletion counts.

## Operational notes
- Retention runs should be idempotent and safe to re-run.
- Deletions are limited per batch to keep runtime bounded.
