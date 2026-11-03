# Tasks

Start after M1 merges. One release. Tasks name the scenarios they make pass. Run `ruff format` and `ruff check --fix` in `api/` before each commit.

## 1. Access core and producers

One implementation PR with ordered commits. A signature change lands with all of its callers in the same commit; there is no temporary fallback.

- [ ] 1.1 DTOs in `core/access/dtos.py` (every `Optional` field defaults to `None`; round-trip through the real cache serializer), exceptions in `core/access/types.py`, helpers in `core/access/principals.py`, `RequestAccess` context. Scenario: "Deleted API key".
- [ ] 1.2 `PrincipalsDAO` with `dbs/postgres/access/mappings.py`; an API key whose creator has no `users` row is inactive. Scenario: "API key whose creator is not a user".
- [ ] 1.3 `resolve_membership` cache in `MembershipsService.resolve` with the fixed key `membership`, caching absence as `CachedMembership(membership=None)`; project-wide invalidation is one pattern call per project. Scenarios: "Membership removal is seen by the next decision with a warm membership cache", "Repeated denied requests read Redis, not Postgres".
- [ ] 1.4 `decide`, `check_eligibility`, `check_request`, `check_human`, `require` (explicit `project_id`; any non-null agent restriction refused; key expiry checked on every call). Scenarios: `access-decision`.
- [ ] 1.5 Principal and membership invalidation on key deletion (both paths), binding and connection changes (including `is_active` edits and reinstall), and user deletion.
- [ ] 1.6 Revisions `oss000000046` (columns, indexes, short `lock_timeout`) and `oss000000047` (batched backfill with changed-value predicates, environment precedence, project-scoped lookups); run `uv run api/scripts/migration_gate.py`. Scenario: "Schedule bound by variant".
- [ ] 1.7 Middleware state and claims, `request_run_envelope`. Scenarios: "API key request", "Run credential of a human run".
- [ ] 1.8 Required `envelope` on every mint and invoke with all callers; producers write envelopes, principals and turn columns (completion fills attribution as one group); consumers refuse rows without stored authority. Scenarios: `turn-attribution`, "Invoke under a key", "Runner refresh", "Create by a human", "Headless invoke creates its session", "Item queued before the deploy".

## 2. Consumers and enforcement

- [ ] 2.1 Rechecks before queued, resumed, channel, child and template work; refusals are terminal settlements, not transport retries; an approval without an envelope is cancelled in a committed transaction before the 409. Scenarios: "Queued API send", "Principal lost access while queued", "Linked Slack user", "Unlinked Slack user uses the creator role", "Agent as a tool", "API key run approved by a human", "Original principal removed", "Resumed turn".
- [ ] 2.2 Strict wrapper; delete the `check_action_access` and `check_permissions` caches; the exchange and the gateway credential route decide with the authenticated project; `connect_callback` uses `check_human`; `channel_adapters.py` uses `decide`. Scenarios: "Key deleted with warm caches", "Gateway credential for a deleted key", "Handler under a run credential", "Check for another user without the explicit helper".
- [ ] 2.3 Dispatcher: target resolution, recheck before the claim, `refuse_delivery` (record and pause in one transaction), pause on archive. Scenarios: `schedule-principal`.
- [ ] 2.4 Evaluation start, rerun and worker rules. Scenarios: "Evaluation started by an API key", "Edit keeps the evaluation principal".
- [ ] 2.5 Access-decision statement counts with request-scoped instrumentation, OSS and EE (real entitlements adapter); endpoint statements reported separately.
- [ ] 2.6 Denial and pause logs with ids only (design D10).

## 3. Docs and config

- [ ] 3.1 Update `docs/design/sharing-program/interfaces/m2/` to match the merged code.
- [ ] 3.2 Add the "Access layer invariants" section to `api/AGENTS.md` (technical design section 6).
- [ ] 3.3 Regenerate the Fern client from an EE spec.
- [ ] 3.4 Confirm no change is needed in `api/oss/src/utils/env.py`, `hosting/docker-compose/*/env.*.example`, `hosting/kubernetes` values and Helm charts; write the release note (cancelled queued work, paused schedules).

## 4. QA matrix (real boundaries, not DTO round trips)

| Case | How |
| --- | --- |
| Every mint | Human, key and installation runs: `_prepare_invoke`, refresh, gateway and MCP credentials keep the principal, with warm caches. |
| Revocation | Key deletion, membership removal and role change with warm middleware, principal and membership caches: the next refresh and the next checked route deny. |
| Installation authority | Admin binding creator and linked viewer: the viewer's turn uses the viewer role, an unlinked user's turn uses the creator role, both store principal `installation`. |
| Schedules, evaluations | Bob's edit keeps Alice as principal; Bob's start sets Bob; a deleted key or an archived agent pauses; an environment moved to another agent is checked against the new agent. |
| Pre-deploy work | On a genuine pre-M2 database (restored dump): a command and an approval queued on the old image are cancelled with `missing_envelope` as terminal states and start no run. |
| Sender | Alice and Bob alternate; a resume keeps the sender and records the approving principal. |
| Local stack | `run.sh --oss --dev`, `--ee --dev`: web, schedule, approval, key and Slack mock turns, and the `/w` playground and evaluations; check the rows and the denial logs. |
