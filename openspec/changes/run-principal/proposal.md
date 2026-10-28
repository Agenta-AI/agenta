# Proposal: typed principal, run authority and sender per turn

## Why

A run credential carries only a user id. An API key run looks like its creator. A Slack turn does not record the installation or the linked user that sent it. A schedule runs as its creator with no recheck. The credential exchange can return a cached allow before it checks the caller. An approval resume runs as the answerer. A turn stores no sender. M3, M6 and M7 need the principal, its limits and the sender of each turn.

## What Changes

- The principal, authority and run context of CONTRACT.md section 3, carried through every mint, queue, child run and resume; `AccessService.decide` (section 6). `check_action_access` keeps its signature.
- Each turn stores its principal, original sender, run context and approver.
- **Behavior changes:**
  - API key runs stay `api_key` through queues, evaluations and resumes.
  - Channel turns record the installation as principal and the linked user as sender. Their authority does not change: the linked user's own role when the Slack user is linked, else the binding creator's role.
  - A schedule, a subscription or a live evaluation whose principal lost access does not run. An environment-bound trigger is checked against its current target before each run.
  - An approval resume runs with the asking run's authority and records the approving principal.
  - An evaluation's principal changes only on an explicit start or rerun, not on an edit.
  - No cache stores an access decision. `decide` runs on every call and reads membership from a per (user, project) cache that every M1 membership mutation invalidates. The credential exchange decides before it mints, and the gateway credential exchange checks that the principal is still active.
  - `check_action_access` no longer falls back to the named user when the request has no principal.
- One deploy and one implementation PR. Two revisions: a short schema expansion, then a lock-bounded backfill. A one-time backfill gives existing schedules, subscriptions and evaluation runs their creator as principal. Queued inputs, commands and parked approvals with no stored authority are cancelled with `missing_envelope`, and run tokens minted before the deploy are refused with `missing_principal`, so those runs fail once and the user retries.
- Docs and config: design docs, an "Access layer invariants" section in `api/AGENTS.md`, Fern client regeneration. No new environment variable.

## Capabilities

### New Capabilities

- `run-principal`: where requests and runs get their principal.
- `access-decision`: `decide`, the wrapper.
- `authority-propagation`: mints, durable work, child runs, resume.
- `turn-attribution`: per-turn sender, approver and context.
- `schedule-principal`: trigger principal, dispatch recheck.

### Modified Capabilities

None.

## Non-goals

- Service accounts and personal or service API keys (M6). API key scopes.
- The edit rule for schedules, subscriptions and evaluation runs. It ships in M7 (CONTRACT.md section 6). M2 keeps today's edit behavior.
- Organization-scoped decisions (M5).
- Cross-project execution and doors (M6).
- Installation restrictions (an operation list, bound agent only, no child agents). They are a later, additive change (CONTRACT.md section 4).
- Session ownership and visibility (M3). Credential bindings (M7).
