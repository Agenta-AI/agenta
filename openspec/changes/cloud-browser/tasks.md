# Tasks

Nothing is implemented. **Implementing agent: start with [HANDOFF.md](HANDOFF.md).** Estimates are engineer-days for one engineer who knows the runner and the API, unit and security tests included; see [design.md](design.md#estimate) for the basis. Re-estimate Phases 1–8 after Phase 0.

## Readiness gates

Phase 1 starts only when all four gates are checked. [HANDOFF.md](HANDOFF.md) defines each gate and who does what.

- [ ] G1 Prerequisites available (runbook prerequisites table).
- [ ] G2 Checks 0.1–0.8 have results in `spike.md`; 0.9 and 0.11 repeated inside a Daytona browser sandbox.
- [ ] G3 Failed or partial checks have accepted design changes; Phases 1–8 re-estimated (0.10).
- [ ] G4 A reviewer approved the "Design" decisions (D2 start, D11–D18); name and date recorded in `design.md`.

## 0. Spike (time-box 5–8 days, throwaway code)

Follow [spike-runbook.md](spike-runbook.md) for prerequisites, steps, and what to record. Each check records a measured result in `spike.md` in this folder. A failed check changes the design before Phase 1; it is not worked around silently.

- [ ] 0.1 Start a second Daytona sandbox from the existing agent snapshot, start Chrome with remote debugging and no automation flags, and measure the time from the create call to the first loaded page.
- [ ] 0.2 Connect the runner to Chrome's CDP WebSocket through the Daytona preview proxy. If the proxy does not carry it, test a small relay process inside the browser sandbox and record which works.
- [ ] 0.3 Run one handler-mode op (`navigate`, then `read_page`) and the `wait_for_user` client tool end to end from Pi (`inprocess`), Claude (`daytona`), and Codex. Record the `read_page` result size on the Codecov repository list and the Umami dashboard against the 100 KB cap.
- [ ] 0.4 Stream a CDP screencast with CDP input through a test WebSocket route on the API to a phone browser, through the cloud ingress, authenticated by the session cookie in the route. Record frames per second, input delay, and any ingress idle timeout.
- [ ] 0.5 Log in to Codecov ("Sign in with GitHub") and to Umami Cloud (email) through that live view, save the session state, start a new browser sandbox, load it, and confirm the login holds. Record the egress IP of each sandbox and any bot-detection block.
- [ ] 0.6 Pause a turn on `wait_for_user`, keep the browser sandbox running, resume, and confirm the same page is still open. Do it twice: in a chat session, and in a session started by a schedule, answered later from the session screen.
- [ ] 0.7 From the agent sandbox's shell, try to reach the browser sandbox (network and preview URL without its token) and confirm it fails.
- [ ] 0.8 With two runner replicas, route browser calls and the live view by session ID to the replica that owns the agent session, and confirm that a call arriving at the other replica reaches the same page and that the turn-end save runs on the owning replica.
- [x] 0.9 (local Chromium, 2026-10-09: 7/7 blocked; repeat in a Daytona sandbox during 0.1; DNS rebinding open as F-027) Confirm that CDP request interception blocks an iframe, a popup, and a download on a host not on the list, an IP literal, and a host name that resolves to a private address.
- [x] 0.11 (local Chromium, 2026-10-09: 8/8 request kinds through the proxy, rebinding refused, no UDP with the corrected WebRTC flag; repeat in a Daytona sandbox during 0.1) Run Chrome with `--proxy-server` to a test proxy that resolves, checks, and connects in one step (D26). Confirm that every request kind goes through it (navigation, iframe, popup, download, `fetch`, WebSocket, `sendBeacon`), that a name resolving to a private address is refused, and that WebRTC sends no UDP outside it.
- [ ] 0.10 Write `spike.md`, update design.md where a check failed, and re-estimate Phases 1–8.

## 1. Profiles domain (8–12 days)

- [ ] 1.1 Add the `allow_browser` organization flag (default `false`) where organization flag defaults are set (`db_manager.py`, `commoners.py`) and to the organization flags reference; only the organization owner may change it, exempt from the `ACCESS` entitlement.
- [ ] 1.2 Add the admin check (D21): organization owner, or project member role `owner` or `admin`, read directly and not through the non-RBAC allow-all path.
- [ ] 1.3 Add RBAC permissions for browser profiles in `api/oss/src/core/access/`.
- [ ] 1.4 Add the `browser_session_state` secret kind, excluded from every vault list and read route for every principal.
- [ ] 1.5 Add the `browser_profiles` domain (`apis/fastapi`, `core`, `dbs/postgres`): owner, name, allowlist, confirmed sign-in hosts, state, generation, session-state secret reference; one `core_oss` migration.
- [ ] 1.6 Endpoints: create, query, retrieve, log-in start and finish (with sign-in host confirmation), archive (hard-deleting session state and downloads, stopping sandboxes).
- [ ] 1.7 Refuse an agent commit that sets the profile reference to a profile the committer does not own.
- [ ] 1.8 Membership check at browser start, and a reconcile job that deletes the profiles of users who are no longer organization members.
- [ ] 1.9 Tests: a run token cannot list or read `browser_session_state`; non-owners cannot read profiles; the admin check refuses an editor on a plan without RBAC; every member-removal path (workspace removal, membership delete, user delete, account delete) makes the profiles unavailable; the reconcile job deletes them.

## 2. Tools and handlers (9–14 days)

- [ ] 2.1 SDK: add the `browser.profile` agent config field; when it is set, the resolver adds the ten handler-mode ops and the `wait_for_user` client tool; fail with a configuration error when platform handlers are off.
- [ ] 2.2 Add the ten ops to the platform op catalog in handler mode, with `default_permission` `allow` for eight and `ask` for `pay` and `delete` (D17), and a `timeout_ms` sized from check 0.1.
- [ ] 2.3 Add the API handlers: flag, owner, revision-author, linked-sender, state, and plan-limit checks; profile resolution from run context; the error envelope codes.
- [ ] 2.4 Add the API client for the runner's `/browser/*` routes, routed by session ID to the replica that owns the session (D19).
- [ ] 2.5 Write a step-log entry per call, with password values redacted (D24); redact the same values in the transcript and traces.
- [ ] 2.5b Channel inbox: record on the run that its identity is a fallback; bind the marker into the browser ops (D13).
- [ ] 2.5c Session interaction route and channel inbox: accept answers to browser-tool approvals and `wait_for_user` only from the profile owner (D25).
- [ ] 2.6 Add the agent instructions for `pay`, `delete`, Google sign-in, `login_required`, `user_in_control`, and `wait_for_user`.
- [ ] 2.7 Tests: refusals for a non-owner run, a revision committed by another user, and an unlinked channel sender; refusal of an approval or wait answer from another member in the web app and in a channel; the configuration error; redaction in all three places; permission defaults under `allow_reads` and under `ask`.

## 3. Runner browser sessions (16–23 days)

- [ ] 3.1 `/browser/*` routes with the runner token, served by the replica that owns the agent session.
- [ ] 3.2 Browser sandbox lifecycle: start on first call, 5-minute warm reuse, 30-minute wait, delete; stop on profile archive.
- [ ] 3.3 Chrome start settings (no automation flags, desktop viewport, user agent, timezone, locale); debugging port open to the runner only.
- [ ] 3.4 CDP actions for the ten ops; `read_page` and `find` with element references and a size bound under the 100 KB cap.
- [ ] 3.5 Load session state at start; post it at turn end to a new API save route that applies the generation and archive rules (D14).
- [ ] 3.6 Allowlist and confirmed sign-in hosts on every target with auto-attach; refuse IP literals, `localhost`, and private or link-local resolution (reuse the SSRF guard rules); `login_required` detection (D18).
- [ ] 3.6b In-sandbox forward proxy (D26): upload and start it with the browser sandbox; resolve once, refuse private, link-local, and loopback addresses, connect to the checked address; Chrome flags `--proxy-server`, `--proxy-bypass-list=<-loopback>`, `--webrtc-ip-handling-policy=disable_non_proxied_udp` (not `--force-webrtc-ip-handling-policy`, which check 0.11 showed has no effect).
- [ ] 3.7 Uploads from session files only; downloads to profile-owned storage.
- [ ] 3.8 Meter every second of browser sandbox time to the profile owner's payer (D20).
- [ ] 3.9 Tests: allowlist bypass attempts (iframe, popup, download, IP literal, private resolution); DNS rebinding through the proxy; WebSocket and WebRTC traffic; generation race; save refused after archive; replica routing; metering of warm and wait time.

## 4. Waiting for the user (5–7 days)

- [ ] 4.1 `wait_for_user` client tool with reason and message; render hint for the chat card.
- [ ] 4.2 `user_in_control` while a user holds control; `login_required` from 3.6.
- [ ] 4.3 Resume reattaches to the same browser sandbox and page.
- [ ] 4.4 After 30 minutes: fail the run and delete the sandbox; set `needs_login` only after a `login_required` wait (D18).
- [ ] 4.5 Tests: chat and scheduled-session pause and resume; timeout with and without a proven logout.

## 5. Live view backend (6–9 days)

- [ ] 5.1 API WebSocket route: in-route auth, `Origin` check, owner or admin check, close on session expiry.
- [ ] 5.2 Runner relay between the API WebSocket and the CDP screencast and input, on the owning replica.
- [ ] 5.3 Stream only while a viewer is connected; control hand-off between the agent and the user.
- [ ] 5.4 Record opens and control hand-offs for the owner (R42).
- [ ] 5.5 Login sessions: allowlist with redirect-chain sign-in host proposals, 30-minute limit, one per user.
- [ ] 5.6 Tests: cross-origin refusal, non-admin refusal, close on expiry, login-session limits, audit entries.

## 6. Storage, records, and limits (7–10 days)

- [ ] 6.1 Profile-owned download storage with owner checks; the `read_download` op copies one file into the session files.
- [ ] 6.2 Screenshot storage, readable by the owner and admins.
- [ ] 6.3 Job that deletes screenshots older than 30 days.
- [ ] 6.4 Plan limit for browser time (values from Q1); refuse with `browser_limit_reached`.
- [ ] 6.5 Step-log and audit query endpoints.
- [ ] 6.6 Tests: another member cannot read downloads or screenshots; the deletion job; the limit refusal.

## 7. Frontend (17–25 days)

- [ ] 7.1 Fern client update and the `@agenta/entities/browserProfile` entity (1–2).
- [ ] 7.2 Live view component in a shared package: canvas frames, input mapping, phone keyboard, zoom, take and give back control, all four states (5–7).
- [ ] 7.3 Settings: Browser logins tab with sign-in host confirmation, and the organization owner switch (2–3).
- [ ] 7.4 Agent config: Browser section with an owner-only profile picker and a notice when the current revision's author is not the owner (2–3).
- [ ] 7.5 Chat: `wait_for_user` dock card, "Watch browser" button, readable tool rows, screenshots in tool rows for the owner and admins, and a notice that members who open the session see what the agent read (4–6).
- [ ] 7.6 Session list badge for running and waiting browsers (1).
- [ ] 7.7 Owner audit view and downloads list on the profile (2–3).

## 8. Verification (4–6 days, plus 5 calendar days)

- [ ] 8.1 Release-gate scenarios for the browser tools on Pi, Claude, and Codex.
- [ ] 8.2 User docs page.
- [ ] 8.3 R15 acceptance: log in once on a phone, then a scheduled run completes a task on that site on 5 days in a row with no new login.
