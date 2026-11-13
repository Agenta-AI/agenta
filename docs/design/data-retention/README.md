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

Spans and events are independent retention domains; each has its own admin
endpoint, its own cron, and its own Redis lock so the two flushes never block
each other.

Spans:

1. Cron calls the admin endpoint `/admin/spans/flush`.
2. The tracing service enumerates plans with finite `Counter.TRACES_INGESTED.retention`.
3. For each plan, it batches projects and deletes traces older than the cutoff.
4. Logs include per-plan and total deletion counts.

Events:

1. Cron calls the admin endpoint `/admin/events/flush`.
2. The events retention service enumerates plans with finite `Counter.EVENTS_INGESTED.retention`.
3. For each plan, it batches projects and deletes events older than the cutoff.
4. Logs include per-plan and total deletion counts.

## Operational notes
- Retention runs should be idempotent and safe to re-run.
- Deletions are limited per batch to keep runtime bounded.
