# Findings: cloud browser change

- Scan: `scan-codebase`, depth `deep`, 2026-10-09.
- Scope: `openspec/changes/cloud-browser/` (proposal, design, specs, tasks) on branch `claude/cloud-browser-agent-research-2og0yj`, checked against `main` at `fa8b8114e` plus this branch.
- Method: one fresh-context reviewer read the documents and the code independently; the author then re-checked the high-severity evidence in the code. "Verified" in a finding means the author re-read the cited code.
- No code was run. Testing findings are gaps found by reading `tasks.md`, not test results.

## Summary

23 findings: 7 × P1, 10 × P2, 6 × P3. F-001 to F-022 come from the independent reviewer; F-023 is the author's own. All 23 are fixed in the documents (resolve, 2026-10-09). "Fixed" means the design, specs, and tasks now say what the decision requires; nothing is implemented. The P1 findings must be resolved in the design before Phase 1. The largest themes:

1. The tool-kind model: `wait_for_user` cannot be a handler-mode op, and nothing lets "take control" pause a running turn (F-001, F-002).
2. Who may use a profile: admins, channel fallback identity, and editors of the agent all reach the owner's logins in ways the design does not block (F-003, F-004, F-005).
3. Where cookies and files live: the vault reveals write-only secrets to every run, and mounts have no owner (F-006, F-011).
4. Runner replicas: browser state in memory on one replica (F-007).

The estimate in `design.md` was 57–85 engineer-days before the scan. After resolve it is 74–109, including the spike.

## Open Questions

None. Triage on 2026-10-09 answered every question; each finding records its decision.

## Notes

### Triage plan (2026-10-09)

- Resolved with `resolve-findings priority=all` on 2026-10-09. Next step: Phase 0, after Q2 in `design.md` is answered.
- Original plan: `resolve-findings` with `priority=all`. Every finding is a document fix; there is no code yet, so `test-codebase` and `sync-findings` have nothing to act on.
- Requirement changes from triage: R26 (timeout fails the run only, F-020), R10 and D6 (downloads in profile-owned storage, F-011), R13 (bill all browser time, F-016), R27 (only the organization owner enables the flag, on every plan, F-003), R35 and R38 (admin defined, F-003), tool list (no model `screenshot`, new `read_download`, `wait_for_user` as a client tool, F-001, F-008, F-011).
- Resulting tool set: ten handler-mode ops, eight with `default_permission` `allow` (`navigate`, `read_page`, `find`, `form_input`, `left_click`, `type`, `upload`, `read_download`) and two with `ask` (`pay`, `delete`), plus the `wait_for_user` client tool.
- After the edits, re-estimate in `design.md`. Work added by triage: owner-committed revision check (F-005), dedicated secret kind (F-006), replica routing and the save route (F-007), profile-owned download storage (F-011, replaces the mount work), redaction (F-012), full-target allowlist with SSRF guard (F-013), login-session limits (F-014), membership reconcile (F-015), billing for all browser time and the plan limit (F-016), and per-phase tests (F-017).

## Open Findings

None.

## Closed Findings

### [CLOSED] F-001 `wait_for_user` cannot be a handler-mode op

- Origin: scan · Lens: verification · Severity: P1 · Confidence: high · Status: fixed (verified)
- Category: Consistency, Feasibility
- Summary: D12, D17, and task 2.1 make `wait_for_user` one of eleven handler-mode `PlatformOp`s that pauses the turn through the client-tool path. Handler mode always produces a callback tool; only a `client` tool pauses across a turn.
- Evidence: `services/runner/src/protocol.ts:167` (`kind?: "callback" | "code" | "client"`); `sdks/python/agenta/sdk/agents/platform/platform_tools.py:81,117-121` (handler ops become `CallbackToolSpec` with a `call_ref`); `sdks/python/agenta/sdk/agents/tools/models.py:683` (`ClientToolSpec` is separate).
- Files: `design.md` D12, D16, D17; `tasks.md` 2.1, 4.1; `specs/browser-agent-tools/spec.md`.
- Suggested Fix: Make `wait_for_user` a `client` tool with its own render hint, next to `request_secret` and `request_connection`. The handler-mode op count becomes ten (eight `allow`, two `ask`). Add the client widget to Phase 7.
- Decision (triage 2026-10-09): `wait_for_user` becomes a `client` tool with its own render hint. Handler-mode ops: see F-008 and F-011 for the final list.
- Resolution (2026-10-09): Fixed in the documents — design D11; agent-tools spec (Tool set, Same tools, Waiting for the user); tasks 2.1, 4.1.

### [CLOSED] F-002 Nothing lets "take control" pause a turn that is already running

- Origin: scan · Lens: verification · Severity: P1 · Confidence: high · Status: fixed
- Category: Feasibility
- Summary: The live-view spec says the agent's turn waits while a user has control. A turn pauses only when the harness itself calls a gated or client tool. No route injects an interaction into a running turn.
- Evidence: `services/runner/src/engines/sandbox_agent/pause.ts:1-9`; `services/runner/src/tools/client-tool-relay.ts:23-30`.
- Files: `design.md` D12; `specs/browser-live-view/spec.md` (Take control); `tasks.md` 4.1.
- Suggested Fix: While a user holds control, browser handlers fail with a new code `user_in_control` (`retryable: false`, `next_step`: call `wait_for_user`). The agent then parks itself. Add the code to the error list and a scenario to the spec.
- Decision (triage 2026-10-09): Accept the suggested fix: new error code `user_in_control` that tells the agent to call `wait_for_user`.
- Resolution (2026-10-09): Fixed in the documents — design D12; agent-tools spec (Waiting for the user); live-view spec (Take control); task 4.2.

### [CLOSED] F-003 "Organization admin" is undefined, and on some plans every member passes

- Origin: scan · Lens: verification · Severity: P1 · Confidence: high · Status: fixed (verified)
- Category: Security, Soundness
- Summary: R35 and R38 let admins read screenshots of, watch, and take control of any member's logged-in browser. The permission check returns `true` for every member when the organization is not entitled to RBAC. Only the organization owner is checked at organization level. Organization flags can be changed only by the owner and, on EE, need the `ACCESS` entitlement, which does not match R27.
- Evidence: `api/oss/src/core/access/permissions/service.py:328-338`; `api/oss/src/routers/organization_router.py:420-436`.
- Files: `design.md` access rules, R27, R35, R38; `specs/browser-live-view/spec.md`; `specs/browser-sessions/spec.md` (Step log); `specs/browser-profiles/spec.md` (Organization gate).
- Suggested Fix: Define "admin" explicitly. Either the organization owner only, or an organization-scope role checked without the RBAC-entitlement bypass. State how `allow_browser` is set on plans without `ACCESS`.
- Decision (triage 2026-10-09): Admin = the organization owner, plus members whose role is `owner` or `admin` in the session's project, checked on the member role directly and never through the non-RBAC allow-all bypass. Only the organization owner turns `allow_browser` on, on every plan (the flag is exempt from the `ACCESS` entitlement).
- Resolution (2026-10-09): Fixed in the documents — design D21, R27, R35, R38; profiles spec (Organization gate); sessions spec (Step log); live-view spec (Who can watch); tasks 1.1, 1.2.

### [CLOSED] F-004 Channel senders with no linked account can drive the owner's browser

- Origin: scan · Lens: verification · Severity: P1 · Confidence: high · Status: fixed
- Category: Security
- Summary: A channel run with no linked sender acts as the agent creator. `design.md` accepts this case, so any person who can message the agent in a connected Slack, Telegram, or WhatsApp space can use the owner's logins.
- Evidence: `api/oss/src/tasks/asyncio/channels/inbox.py:222,327` (`user_id or resolution.agent.created_by_id`); `design.md` access rules ("or have no linked account while the owner created the agent").
- Suggested Fix: Never resolve a profile for a fallback-identity channel run. Require a linked sender who is the owner. Add a refusal scenario and a test.
- Decision (triage 2026-10-09): Accept the suggested fix: never resolve a profile for a fallback-identity channel run.
- Resolution (2026-10-09): Fixed in the documents — design D13, R39; sessions spec (Who may use the profile, Unlinked channel sender); task 2.3.

### [CLOSED] F-005 Other editors of the agent control what the owner's logins are used for

- Origin: scan · Lens: verification · Severity: P1 · Confidence: high · Status: fixed
- Category: Security
- Summary: Task 1.5 refuses only a commit that sets the profile reference to someone else's profile. Another editor can change the prompt, tools, or schedule inputs of an agent that already names the owner's profile. The owner's scheduled runs then follow that editor's instructions with the owner's logins. Prompt injection from page content and data leaving through other tools are not discussed.
- Evidence: `tasks.md` 1.5; `api/oss/src/apis/fastapi/tools/router.py:1393-1402` (handlers take identity from the run credential); `api/oss/src/tasks/asyncio/triggers/dispatcher.py:250`.
- Suggested Fix (pick one): (a) bind the profile only to revisions the owner committed; (b) clear the binding on any commit by another user until the owner re-confirms; (c) refuse commits by other users while the binding exists. Add a threat-model section on prompt injection and exfiltration.
- Decision (triage 2026-10-09): A run uses the profile only if the agent revision it runs was committed by the profile owner. Otherwise the call fails with `profile_not_available`. Add a threat-model section.
- Resolution (2026-10-09): Fixed in the documents — design D13, R40, Threat model; sessions spec (Another editor changed the agent); profiles spec (Attach); tasks 2.3, 7.4.

### [CLOSED] F-006 A "write-only" vault secret is given in plaintext to every run

- Origin: scan · Lens: verification · Severity: P1 · Confidence: high (mechanism), medium (exact leak path) · Status: fixed (verified)
- Category: Security
- Summary: D5 stores cookies in a write-only vault secret. The vault reveals write-only values to any caller whose token has the `secret-resolve` grant, and every run gets that grant. Vault listing is project-wide, so other members' runs could receive the owner's cookies.
- Evidence: `api/oss/src/apis/fastapi/vault/router.py:233-245`; `api/oss/src/core/workflows/service.py:3099-3108`; `api/oss/src/apis/fastapi/vault/router.py:301-343`.
- Files: `design.md` D5, profile lifecycle; `specs/browser-profiles/spec.md` (Log in through the live view).
- Suggested Fix: Use a dedicated secret kind that every vault list and read route excludes for every principal, read only by the `browser_profiles` service. Add a test that a run token cannot list or read it.
- Decision (triage 2026-10-09): Accept the suggested fix: a dedicated secret kind that every vault route excludes for every principal.
- Resolution (2026-10-09): Fixed in the documents — design D5; profiles spec (Session state is never returned by the vault); task 1.4.

### [CLOSED] F-007 Browser state lives in one runner replica's memory

- Origin: scan · Lens: verification · Severity: P1 · Confidence: medium · Status: fixed
- Category: Feasibility
- Summary: The runner runs as several replicas and claims session ownership per replica. CDP sockets, the 5-minute warm timer, the screencast relay, and the turn-end cookie save are per-process state. The API reaches the runner through one internal URL, best effort. No API route receives the cookies the runner saves.
- Evidence: `services/runner/src/engines/sandbox_agent/runtime-policy.ts:342-345` (replica owner claim); `api/oss/src/core/sessions/streams/runner_client.py:1-15`.
- Files: `design.md` architecture and run lifecycle; `tasks.md` 2.3, 3.2, 3.5, 5.2.
- Suggested Fix: Route `/browser/*` calls and the live view to the owning replica, or keep a lease in Redis. Add the turn-end hook and an API write-back route with the generation guard. Add a Phase 0 check with two runner replicas.
- Decision (triage 2026-10-09): Record the owning runner replica of each browser session in Redis; the API and other replicas forward `/browser/*` and the live view to it. Add the turn-end save route with the generation guard.
- Resolution (2026-10-09): Fixed in the documents — design D19; sessions spec (One owning runner); tasks 0.8, 2.4, 3.1, 3.5.

### [CLOSED] F-008 Screenshots cannot reach the model through a handler-mode result

- Origin: scan · Lens: verification · Severity: P2 · Confidence: high · Status: fixed (verified)
- Category: Feasibility
- Summary: The design lists this as "not verified". The code shows it is not supported: the tool result is a string, and the runner truncates results at 100 KB. `read_page` output on large pages can also hit that limit.
- Evidence: `api/oss/src/core/tools/dtos.py:234-239` (`content: str`); `services/runner/src/tools/callback.ts:53` (`DEFAULT_GATEWAY_RESULT_BYTES = 100_000`).
- Files: `design.md` risks; `specs/browser-agent-tools/spec.md`; `tasks.md` 0.3.
- Suggested Fix: Either drop model-facing screenshots in v1 (keep them for the user only) and bound `read_page` output, or plan an image content-block contract across the API, the runner, Pi, and MCP, and re-estimate.
- Decision (triage 2026-10-09): Screenshots go to the user only (step log and UI). Remove `screenshot` from the model's tools. Bound `read_page` output under the result cap.
- Resolution (2026-10-09): Fixed in the documents — design D8, R43; agent-tools spec (Tool set, Bounded page text); task 3.4.

### [CLOSED] F-009 Nothing adds the browser tools when a profile is attached

- Origin: scan · Lens: verification · Severity: P2 · Confidence: high · Status: fixed
- Category: Completeness
- Summary: The spec says the tools appear when the agent config names a profile. Platform ops appear only when the author lists them. No task adds a profile field to the agent config schema or injects the tools. Turning platform handlers off drops the tools without an error.
- Evidence: `sdks/python/agenta/sdk/agents/tools/models.py:491-506`; `sdks/python/agenta/sdk/agents/platform/op_catalog.py:59-67`; `sdks/python/agenta/sdk/agents/platform/platform_tools.py:84-110`.
- Suggested Fix: Add SDK tasks for the config field, the tool injection, and a loud failure when handlers are disabled for an agent with a profile.
- Decision (triage 2026-10-09): Accept the suggested fix.
- Resolution (2026-10-09): Fixed in the documents — design D23; agent-tools spec (Platform handlers turned off); task 2.1.

### [CLOSED] F-010 A WebSocket route bypasses the API auth middleware

- Origin: scan · Lens: verification · Severity: P2 · Confidence: high · Status: fixed (verified)
- Category: Security
- Summary: Auth runs as HTTP middleware, which does not run for WebSocket connections. The web app authenticates with a session cookie, so a cookie-authenticated WebSocket is open to cross-site WebSocket hijacking unless the route checks the `Origin`.
- Evidence: `api/entrypoints/routers.py:619` (`app.middleware("http")(auth_middleware)`).
- Files: `design.md` D9; `tasks.md` 5.1.
- Suggested Fix: Authenticate inside the route, check `Origin`, and close the socket when the session ends. Add negative tests.
- Decision (triage 2026-10-09): Accept the suggested fix.
- Resolution (2026-10-09): Fixed in the documents — design D22; live-view spec (WebSocket security); task 5.1.

### [CLOSED] F-011 The per-user download mount is not private

- Origin: scan · Lens: verification · Severity: P2 · Confidence: high · Status: fixed (verified)
- Category: Security, Feasibility
- Summary: D6 relies on a mount "signed only for that user's runs". A mount has no user field, and every mount route checks only project permissions, so any project member can read the files.
- Evidence: `api/oss/src/core/mounts/dtos.py:25-35`; `api/oss/src/apis/fastapi/mounts/router.py` (project-level `VIEW_MOUNTS` / `EDIT_MOUNTS` / `USE_MOUNTS` checks).
- Files: `design.md` D6; `specs/browser-sessions/spec.md` (Downloads); `tasks.md` 6.1, 6.1b.
- Suggested Fix: Add owner enforcement to the mounts domain (D6 rejected this as a new scope type), or keep downloads in storage owned by `browser_profiles`. Re-estimate Phase 6.
- Decision (triage 2026-10-09): Downloads are stored by the `browser_profiles` domain with owner checks. A new handler op `read_download` copies one download into the session files. No change to mounts; D6 is replaced.
- Resolution (2026-10-09): Fixed in the documents — design D6, R10; sessions spec (Downloads); task 6.1.

### [CLOSED] F-012 Page content reaches members outside the owner and admins

- Origin: scan · Lens: verification · Severity: P2 · Confidence: medium · Status: fixed
- Category: Security
- Summary: R35 limits the step log to the owner and admins, but tool arguments and results also go into the session transcript and traces, which project members can read. Values the agent types into password fields would be stored, against R19.
- Files: `specs/browser-sessions/spec.md` (Step log); `specs/browser-live-view/spec.md` ("even if they can open the session").
- Suggested Fix: Redact values typed into password fields in the step log, the transcript, and the trace. State in the spec that the transcript is visible to project members, or restrict it.
- Decision (triage 2026-10-09): Redact values typed into password fields in the step log, transcript, and traces. Keep page text in the transcript and state in the spec and UI that members who can open the session see what the agent read.
- Resolution (2026-10-09): Fixed in the documents — design D24, R41; sessions spec (Redaction); tasks 2.5, 7.5.

### [CLOSED] F-013 The allowlist covers top-level pages only

- Origin: scan · Lens: verification · Severity: P2 · Confidence: medium · Status: fixed
- Category: Security
- Summary: The spec enforces the allowlist only on top-level navigation. It does not cover iframes, popups (`window.open`), downloads from other hosts, IP literals, `localhost` (including Chrome's own debug port), or DNS rebinding to private ranges.
- Files: `specs/browser-sessions/spec.md` (Allowlist); `tasks.md` 3.6.
- Suggested Fix: Intercept on all targets (auto-attach). Validate allowlist entries. Reuse `services/runner/src/tools/ssrf-guard.ts`. Restrict `--remote-allow-origins`. Add bypass tests.
- Decision (triage 2026-10-09): Accept the suggested fix.
- Resolution (2026-10-09): Fixed in the documents — design D7; sessions spec (Allowlist); tasks 0.9, 3.6.

### [CLOSED] F-014 D15 makes a login session an open browser

- Origin: scan · Lens: verification · Severity: P2 · Confidence: high · Status: fixed
- Category: Security
- Summary: D15 turns the allowlist off during the owner's login. Every host the owner visits, including trackers and CDNs, becomes a permanent sign-in host the agent may open. Any member can also use a login session as an unrestricted cloud browser.
- Files: `design.md` D15; `specs/browser-sessions/spec.md` (Allowlist).
- Suggested Fix: Record only hosts in redirect chains that start from allowlisted sites. Let the owner confirm them. Limit login-session length and rate.
- Decision (triage 2026-10-09): Accept the suggested fix.
- Resolution (2026-10-09): Fixed in the documents — design D15; live-view spec (Login sessions); task 5.5.

### [CLOSED] F-015 Owner removal has several code paths

- Origin: scan · Lens: verification · Severity: P2 · Confidence: high · Status: fixed
- Category: Completeness
- Summary: Task 1.6 assumes one removal hook. Membership is removed in several places. Running browser sandboxes are not stopped on profile delete, and an archived profile could still receive a cookie save.
- Evidence: `api/oss/src/services/db_manager.py:1145, 2913-2950, 3161`; `user_profile.py:107`; `accounts/router.py:449`.
- Suggested Fix: Check owner membership at run time and clean up in a reconcile job, or hook every path. Stop browser sandboxes on delete and refuse saves to an archived profile.
- Decision (triage 2026-10-09): Accept the suggested fix: check owner membership at run time, reconcile in a job, stop sandboxes on delete, refuse saves to archived profiles.
- Resolution (2026-10-09): Fixed in the documents — profiles spec (Delete, Owner leaves); sessions spec (Profile deleted during a run); tasks 1.6, 1.8.

### [CLOSED] F-016 Metering does not attach to a browser sandbox

- Origin: scan · Lens: verification · Severity: P2 · Confidence: medium · Status: fixed
- Category: Feasibility
- Summary: The sandbox meter is keyed to a run request credential and counts only while a turn runs. `/browser/*` calls carry no run request, live-view login sessions have no run at all, and waits of up to 30 minutes are never billed. No task enforces the R13 plan limit. Q1 says it blocks Phase 6, but metering is task 3.8.
- Evidence: `services/runner/src/metering/sandbox-usage.ts:16-18, 74-77`.
- Suggested Fix: Pass the run credential to `/browser/*`. Define who pays for login sessions and waits. Add a task for the limit and fix the Q1 cross-reference.
- Decision (triage 2026-10-09): Bill every second a browser sandbox runs (turns, warm time, waits, login sessions) to the profile owner's payer. Add the plan-limit task.
- Resolution (2026-10-09): Fixed in the documents — design D20, R13; sessions spec (Metering and limits); tasks 3.8, 6.4.

### [CLOSED] F-017 `tasks.md` has almost no tests

- Origin: scan · Lens: verification · Severity: P2 · Confidence: high · Status: fixed
- Category: Testing
- Summary: Only 8.1 (release gate) is a test task. Phase 0 check 0.3 skips Codex, which R24 requires.
- Missing: vault exclusion (F-006), WebSocket auth and `Origin` (F-010), non-owner and channel-fallback refusals (F-004, F-005), allowlist bypasses (F-013), generation race and save after archive (F-015), redaction (F-012), 30-day deletion job, member-removal paths, browser metering, Codex.
- Suggested Fix: Add a test task to each phase for these cases. Add Codex to check 0.3.
- Decision (triage 2026-10-09): Accept the suggested fix.
- Resolution (2026-10-09): Fixed in the documents — tasks: a test task in each of Phases 1–6; Codex added to check 0.3.

### [CLOSED] F-018 Two code citations are wrong

- Origin: scan · Lens: verification · Severity: P3 · Confidence: high · Status: fixed (verified)
- Category: Correctness
- Summary: `design.md` says the API "reads session streams" from the runner. `runner_client.py` says it is the direct API-to-runner hop "used only by `kill`"; everything else goes through Redis. `subscription_service.py:496` should be 495.
- Evidence: `api/oss/src/core/sessions/streams/runner_client.py:1-10`.
- Suggested Fix: Correct both rows. The subscription-login relay (`subscription_service.py:222-326`) remains a valid precedent for the API calling the runner.
- Decision (triage 2026-10-09): Accept the suggested fix.
- Resolution (2026-10-09): Fixed in the documents — design context rows (API calls the runner, Login state precedent).

### [CLOSED] F-019 D2 and the spec use different units

- Origin: scan · Lens: verification · Severity: P3 · Confidence: high · Status: fixed
- Category: Consistency
- Summary: D2 says "one browser sandbox per run". R37 and the sessions spec reuse it across turns of one session.
- Suggested Fix: Use one term ("per session, with a 5-minute warm reuse") in D2, the proposal, and the specs.
- Decision (triage 2026-10-09): Accept the suggested fix.
- Resolution (2026-10-09): Fixed in the documents — design D2; sessions spec (Start on first use) now say per agent session.

### [CLOSED] F-020 One missed `wait_for_user` disables a profile with no notice

- Origin: scan · Lens: verification · Severity: P3 · Confidence: medium · Status: fixed
- Category: Soundness
- Summary: A wrong `wait_for_user` in a scheduled run, or a take-control nobody finishes, sets `needs_login` after 30 minutes. R31 then fails every later run until the owner logs in again, and R25 sends no notice.
- Suggested Fix: Fail only the run on timeout, and set `needs_login` only when a later load shows the session is logged out. Or keep the rule and show the state clearly in the session list.
- Decision (triage 2026-10-09): On a 30-minute timeout, fail the run only. Set `needs_login` only when a later browser start shows the site logged out. This changes R26.
- Resolution (2026-10-09): Fixed in the documents — design D18, R26; sessions spec (Wait for the user); task 4.4.

### [CLOSED] F-021 The first browser call can time out

- Origin: scan · Lens: verification · Severity: P3 · Confidence: medium · Status: fixed
- Category: Feasibility
- Summary: The first browser call includes the sandbox cold start. Handler ops support `timeout_ms`, but the design does not set it, so the 30-second default applies.
- Evidence: `sdks/python/agenta/sdk/agents/platform/op_catalog.py:199`; `services/runner/src/tools/callback.ts:203-208`.
- Suggested Fix: Set an explicit `timeout_ms` on each browser op, sized from the Phase 0 check 0.1 result.
- Decision (triage 2026-10-09): Accept the suggested fix.
- Resolution (2026-10-09): Fixed in the documents — task 2.2 (`timeout_ms` sized from check 0.1).

### [CLOSED] F-022 Admin take-control leaves no record for the owner

- Origin: scan · Lens: verification · Severity: P3 · Confidence: high · Status: fixed
- Category: Security
- Summary: R38 lets an admin control a member's logged-in browser. The step log records only agent tool calls, not human actions in the live view, and the owner is not told.
- Suggested Fix: Log who opened the live view and who held control, with start and end times, in an audit the owner can read.
- Decision (triage 2026-10-09): Accept the suggested fix.
- Resolution (2026-10-09): Fixed in the documents — design R42; live-view spec (Owner sees who watched); tasks 5.4, 7.7.

### [CLOSED] F-023 The profile lifecycle text contradicts the spec

- Origin: scan · Lens: verification · Severity: P3 · Confidence: high · Status: fixed
- Category: Consistency
- Summary: `design.md` says choosing "Log in again" moves the profile to `needs_login`. The profiles spec says "Log in again" from any state, followed by Done, sets the profile to `ready`.
- Files: `design.md` profile lifecycle; `specs/browser-profiles/spec.md` (Log in again).
- Suggested Fix: Remove "Log in again" from the `needs_login` transition in `design.md`.
- Decision (triage 2026-10-09): Accept the suggested fix.
- Resolution (2026-10-09): Fixed in the documents — design profile lifecycle.
