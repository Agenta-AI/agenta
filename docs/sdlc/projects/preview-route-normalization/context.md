# Context

## Background

The API currently exposes many domain routers under `/preview/*`. Some domains already have canonical non-preview mounts (for example tracing), while others do not. We want to normalize public API paths so that OpenAPI shows canonical non-preview endpoints, while old preview paths remain available for a transition window.

## Problem statement

- API consumers currently depend on preview paths across both frontend and SDK.
- If we switch paths abruptly, we risk breaking runtime behavior.
- If we expose both preview and non-preview paths in OpenAPI at the same time, we risk duplicate operations and confusing generated clients.

## Goals

- Add canonical non-preview mounts where safe.
- Keep preview mounts live during migration.
- Expose only canonical paths in OpenAPI.
- Track migration status for frontend and SDK before removing preview mounts.

## Non-goals

- Removing preview mounts in the same change.
- Rewriting route internals or service logic.
- Full endpoint redesign.

## Constraints

- Existing clients must remain functional during migration.
- OpenAPI should avoid duplicated endpoint surfaces for the same handlers.
- Legacy routers in `api/oss/src/routers/*` still coexist with new fastapi routers in `api/oss/src/apis/fastapi/*`.
