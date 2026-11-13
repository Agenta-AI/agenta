# Session coordination auth — use the invoke credentials, not an admin key

> **Status: design, NOT yet implemented.** Captures the decision + the full
> end-to-end trace so the change can be made deliberately across the SDK wire,
> the agent service, the runner, and the session API.

## The problem (observed)

The agent runner's session calls (heartbeat + record-persist) hit the
`/admin/sessions/*` endpoints with the global `AGENTA_AUTH_KEY` and a
**body `project_id`**. The runner has no real `project_id` (it's empty for the
chat lane) → the admin endpoints 422 on `project_id` validation → nothing
persists → the inspector panels are empty.

Patching the runner to *send* a `project_id` was rejected: in production the
project must never ride the request path (a runner/caller can't be trusted to
assert its own scope), and the runner shouldn't carry the global admin key.

## Decision: authenticate session calls AS the invoke caller

The runner calls the **normal (non-admin) session endpoints** using the
**credentials that invoke received**. The API resolves `project_id` (and the
rest of the scope) from those credentials' `AuthScope` server-side — exactly as
every other authenticated call already does. No admin key on the runner, no
`project_id` on the request path, no `/admin/*` for sessions.

### Why (the reasons that drove this)

1. **The admin key on the runner is a hazard** — a broad global credential in the
   runner is a worse blast radius than a scoped invoke credential.
2. **Custom-workflow parity** — a third party building a session-aware workflow
   only ever has the credentials invoke handed them. If sessions require an admin
   key, custom workflows can't use sessions. Using the invoke credential makes the
   **public** session API sufficient for anyone; a workflow can do only what its
   invoke credential is scoped to.
3. **Established precedent** — the SDK tracing path already caches per-invocation
   credentials (`ag.tracing.credentials.put(trace_id, context.credentials)`,
   `decorators/tracing.py:391`) and reuses them for the async OTLP push. The
   session path mirrors this: hold the invoke credential for the run, reuse it for
   the follow-on session writes.

## What's true today (the trace — verified)

- **`/invoke` requires valid Agenta credentials.** The auth middleware verifies
  them and already resolves the full scope: `AuthScope` =
  `{organization_id, workspace_id, project_id, user_id}`
  (`api/oss/src/utils/context.py:38-44`). The verify endpoint currently returns
  only `{"effect": "allow"}` — it does not return the scope.
- **The invoke `Authorization` header already reaches the runner.** The agent
  service captures it (`tracing.py:63: authorization=headers.get("Authorization")`)
  and sends it on the wire (`TraceContext.authorization`, `protocol.ts:134`).
  `toolCallback.authorization` already reuses "the run's authorization" for direct
  tool calls — so the credential is on the runner today, just typed as the OTLP
  exporter cred.
- **The runner session calls use the admin key** (`alive.ts`/`persist.ts`
  `adminAuth()` → `AGENTA_AUTH_KEY`) against `/admin/sessions/*`.
- **`session_id` is globally unique** (`uq_session_streams_session_id`, no project
  scope) — a session belongs to exactly one project. (Relevant if we ever needed
  server-side derivation; with Option B we don't — the credential carries scope.)

## The change (by layer)

1. **Wire / SDK — carry the invoke credential as a first-class run credential.**
   The run's Agenta `Authorization` should reach the runner as the credential the
   *session* calls use (today it rides `TraceContext.authorization`, semantically
   the OTLP cred). Either reuse that value for session calls or add an explicit
   run-credential field. Wire change ⇒ update `protocol.ts` + `wire.py` +
   `wire_models.py` + the golden fixtures + both contract tests in lockstep
   (per `services/agent/CLAUDE.md`).

2. **Runner — use the caller credential, drop the admin key + body project_id.**
   `alive.ts`/`persist.ts`: `authorization` = the run's invoke credential (not
   `AGENTA_AUTH_KEY`); remove `project_id` from the heartbeat/ingest bodies; call
   the **non-admin** session endpoints. The credential lives in the runner process
   only and is **never** handed to the harness/sandbox (the runner makes these
   calls itself — invariant to preserve).

3. **Session API — accept credential-authenticated session writes.**
   Provide non-admin, credential-authed heartbeat + record-ingest (or make the
   existing ones resolve scope from `request.state` auth like `set_session_stream`
   does at `router.py:204`). `project_id` comes from the verified `AuthScope`, not
   the body. The `/admin/*` variants + the global-admin-key path for sessions can
   be retired once the runner no longer uses them.

4. **(Optional) verify returns the scope.** Not strictly needed for B — the runner
   authenticates as the caller, so the *API* resolves scope on each session call.
   Only needed if some component must read the scope *before* a call.

## Credential lifetime + refresh — RESOLVED (code-verified)

The runner only ever holds the **ephemeral Secret token** (the services SDK auth
middleware reads `auth.get("credentials")` from `/check` = the minted Secret;
the original ApiKey/Bearer never reaches the runner — confirmed
`sdk/middlewares/routing/auth.py:228`). The Secret token's `exp` is **15 min**
(`_SECRET_EXP`, `api/oss/src/middlewares/auth.py:88`).

A session-owned run **survives client disconnect** and can outlive 15 min, so the
runner must **refresh** its Secret token. Verified behavior of the mint:

- **Bearer → Secret**: `verify_bearer_token` calls `sign_secret_token` → **fresh
  `exp`** (`auth.py:386,727`).
- **ApiKey → ApiKey**: `verify_apikey_token` **echoes the ApiKey** (no mint;
  `auth.py:796`).
- **Secret → Secret**: `verify_secret_token` **decodes + echoes the SAME token**
  (no re-sign; `auth.py:882`). So `/check` today returns a Secret input unchanged
  (same `exp`) — **it does not refresh.**

### Decision: B1 — short-lived → short-lived, refresh on a heartbeat divider, REUSING `/check`

Do **not** build a new refresh endpoint and do **not** give the runner a
long-lived credential. The one change that makes `/check` reusable as a refresh:

1. **`verify_secret_token` re-mints**: on a valid (non-expired) Secret token,
   re-sign a fresh-`exp` token from the decoded claims and set
   `request.state.credentials` to it (instead of echoing). It already decodes the
   exact six claims `sign_secret_token` needs (`user_id`, `user_email`,
   `project_id`, `workspace_id`, `organization_id`, `organization_name`) — verified
   one-to-one. `/check` then returns a **fresh** credential for a Secret input.
   - Optionally gate: re-mint only when within N min of expiry, to avoid re-signing
     on every authenticated Secret-token call platform-wide. (Behavior-scope call.)
2. **Runner refresh tick**: hold the Secret token; every **K heartbeats** (a divider
   over the heartbeat interval, ~5 min — comfortably inside the 15-min window) call
   `/check` and swap in the returned credential. Never a long-lived credential.
3. **Runner session calls** use that ephemeral credential (not `AGENTA_AUTH_KEY`)
   against the **non-admin** session endpoints; drop the body `project_id`.

Net: project scope comes from the credential's `AuthScope`, the runner stays on a
refreshing short-lived token, and the only server change is making the Secret path
re-mint (a one-function change that lets us reuse `/check`).

## Non-goal / rejected

- **Forwarding project_id on the request path** (FE query, body, or W3C baggage) —
  rejected; scope must come from the credential, server-side.
- **Server-side derivation by session_id** — unnecessary under B (the credential
  carries scope); keep as a fallback idea only.
- **Passing the credential into the sandbox** — never; the runner (Agenta-owned)
  makes the session calls itself.
