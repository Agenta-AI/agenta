# Extend interactions: tasks

Work in `vibes.worktrees/feat-extend-interactions` (branch `feat/extend-interactions`,
off `big-agents`). Read `specs.md` in this folder first.

## T1 — API: credentialed create_interaction

- File: `api/oss/src/apis/fastapi/sessions/router.py`, `create_interaction`.
- Replace the admin gate with the records-ingest model (`ingest_record_event` is the
  reference in the same file): `project_id = request.state.project_id`, gate on
  `check_action_access(user_uid=request.state.user_id, project_id=..., permission=
  Permission.RUN_SESSIONS)` -> `FORBIDDEN_EXCEPTION` on failure.
- File: `api/oss/src/apis/fastapi/sessions/models.py`,
  `SessionInteractionCreateRequest` / `core/sessions/interactions/dtos.py`
  `SessionInteractionCreate`: drop `project_id` from what the runner must send. Build the
  `SessionInteractionCreate` server-side with `project_id` + `created_by_id` from
  `request.state`. Keep `session_id`, `turn_id`, `token`, `kind`, `data`, `flags`.
- Idempotency: in `core/sessions/interactions/service.py` `create_interaction` (or the
  DAO), make create idempotent on `(project_id, session_id, token)` — if a row with that
  token exists for the session, return it instead of inserting a duplicate. Check the
  `session_interactions` DBE / migration `oss000000009` for an existing unique constraint;
  add one only if the design needs it (prefer an app-level get-or-create to avoid a new
  migration if a constraint is not already present).
- Verify: `ruff format` + `ruff check` in `api/`.

## T2 — Runner: interactions.ts client

- New file: `services/agent/src/sessions/interactions.ts`, structured like `persist.ts`.
- `createInteraction(sessionId, turnId, token, kind, data, auth)`: POST
  `${apiBase()}/sessions/interactions` with `{interaction: {session_id, turn_id, token,
  kind, data, flags: {delivered_in_band: true}}}`, header `authorization: auth()`. Bounded
  retry (3, linear backoff), log + swallow on final failure. Fire-and-forget (do not block
  the turn).
- Types: reuse the kind union (`user_approval` | `user_input` | `client_tool`) and a small
  `data.request` payload type. Keep `protocol.ts` untouched unless a wire field is needed.

## T3 — Runner: create on park (do both)

- File: `services/agent/src/engines/sandbox_agent.ts`, the `onPark` callback (~line 423)
  and the `attachPermissionResponder` wiring.
- When a gate parks (HITLResponder returns `"park"`), in addition to the existing
  messages-plane emission, call `createInteraction(...)` with `kind=user_approval`,
  `token` = the gated tool-call id, `data.request` = `{tool: <name>, args: <input>}`
  derived the same way `permissionRequestKeys` / `permissionToolName` do in `responder.ts`.
  The tool name + args are on the permission request `raw.toolCall`.
- Thread the run credential (`runCredential(request)` / the watchdog credential, same
  source `persist.ts` uses) into the engine so `createInteraction` can authenticate. Check
  how `sandbox_agent.ts` already receives the credential for alive/persist and reuse it.
- Headless (`hasHumanSurface === false`) and stored-decision paths must NOT create (they
  never park, so hooking `onPark` already gives this for free — confirm).

## T4 — Runner tests

- New: `services/agent/tests/unit/session-interactions.test.ts`, mirroring
  `session-persist.test.ts`. Assert: POST URL + body shape, auth header value, retry then
  give-up on repeated non-ok, and that a thrown/failed create does not reject the caller.
- Run `pnpm test` and `pnpm run typecheck` in `services/agent`.

## T5 — Inspector: Refresh on all five tabs

- Dir: `web/oss/src/components/SessionInspector/`.
- Add a Refresh affordance usable on Records, States, Streams, Interactions, Mounts.
  Streams already invalidates its own query; generalize so each tab can re-run its query.
  Simplest: a Refresh button in the drawer header (`SessionInspectorDrawer.tsx`) that
  invalidates the active tab's query key, OR a per-tab button. Each tab's query key is
  `["session-inspector", <tab>, projectId, sessionId]`.
- Keep using TanStack Query `invalidateQueries` (the tabs already do).

## T6 — Inspector: Interactions tab full info + respond

- File: `web/oss/src/components/SessionInspector/tabs/InteractionsTab.tsx`.
- Show full interaction: kind, status, token (monospace), turn_id, created_at,
  `data.request` (JSON block), and `data.resolution` when present.
- Respond shape is `{answer: {...}}` (object). For `user_approval`: Approve / Deny buttons
  sending `{answer: {decision: "allow"}}` / `{answer: {decision: "deny"}}`. For
  `user_input`: a text/JSON field -> `{answer: {input: <value>}}`. Confirm the exact
  decision key the respond/transition consumer expects (check
  `respond_interaction` handler + `core/sessions/interactions/service.py`); if it maps to
  a status transition, send what that path reads.
- Disable respond unless `status === pending`. After success, `invalidateQueries` the
  interactions key so status flips.
- `respondInteraction` already exists in `../api.ts` (signature `(interactionId, {answer},
  projectId)`); adjust the answer payload, do not re-plumb the client.
- Run `pnpm lint-fix` in `web/`.

## T7 — Verify

- `api/`: `ruff check` clean. `services/agent`: `pnpm test` + `pnpm run typecheck` green.
  `web/`: `pnpm lint-fix` clean (and `pnpm --filter @agenta/<pkg> build`/lint if a package
  was touched — none expected; this is app-layer).
- Manual QA per `specs.md`'s "What to QA" once redeployed.

## Notes / guardrails

- Strict layering in `api/` (Router -> Service -> DAO interface -> impl). Define any new
  exception in `core/sessions/interactions/types.py`; do not raise HTTPException from the
  service.
- Terse comments only (one line max; the repo enforces this).
- Do not touch the deferred items (client->callback rename, umbrella naming, dual-plane
  resolver).
- The inspector is app-layer (`web/oss`), not a package — no `@agenta/*` package changes
  expected.
