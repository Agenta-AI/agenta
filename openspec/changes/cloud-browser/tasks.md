# Tasks

Nothing is implemented. Estimates are engineer-days for one engineer who knows the runner and the API; see [design.md](design.md#estimate) for the basis. Re-estimate Phases 1–8 after Phase 0.

## 0. Spike (time-box 4–6 days, throwaway code)

Each check records a measured result in `findings.md` in this folder. A failed check changes the design before Phase 1; it is not worked around silently.

- [ ] 0.1 Start a second Daytona sandbox from the existing agent snapshot, start Chrome with remote debugging and no automation flags, and measure the time from the create call to the first loaded page.
- [ ] 0.2 Connect the runner to Chrome's CDP WebSocket through the Daytona preview proxy. If the proxy does not carry it, test a small relay process inside the browser sandbox and record which works.
- [ ] 0.3 Run one handler-mode browser `PlatformOp` (`navigate`, then `read_page`, then `screenshot`) end to end from Pi (`inprocess`) and from Claude (`daytona`). Record whether each harness gives the screenshot image to the model.
- [ ] 0.4 Stream a CDP screencast with CDP input through a test WebSocket route on the API to a phone browser, through the cloud ingress. Record frames per second, input delay, and any ingress idle timeout.
- [ ] 0.5 Log in to each R14 SaaS app (names from Q2) through that live view, save the session state, start a new browser sandbox, load it, and confirm the login holds. Record the egress IP of each sandbox.
- [ ] 0.6 Pause a turn on a test `wait_for_user` interaction, keep the browser sandbox running, resume, and confirm the same page is still open.
- [ ] 0.7 From the agent sandbox's shell, try to reach the browser sandbox (network and preview URL without its token) and confirm it fails.
- [ ] 0.8 Write `findings.md`, update design.md where a check failed, and re-estimate Phases 1–8.

## 1. Profiles domain (5–7 days)

- [ ] 1.1 Add `allow_browser` to `OrganizationFlags` and to the organization flags reference; admin-only change.
- [ ] 1.2 Add RBAC permissions for browser profiles in `api/oss/src/core/access/`.
- [ ] 1.3 Add the `browser_profiles` domain (`apis/fastapi`, `core`, `dbs/postgres`): owner, name, allowlist, sign-in hosts, state, generation, vault secret reference; one `core_oss` migration.
- [ ] 1.4 Endpoints: create, query, retrieve, log-in start and finish, archive (with vault secret hard delete).
- [ ] 1.5 Refuse an agent commit that sets the profile reference to a profile the committer does not own.
- [ ] 1.6 Delete a member's profiles when the member is removed from the organization.

## 2. Tools and handlers (5–8 days)

- [ ] 2.1 Add the eleven browser ops to the SDK platform op catalog in handler mode, with `pay` and `delete` defaulting to `ask`.
- [ ] 2.2 Add the API handlers: flag, RBAC, owner, state, and allowlist checks; profile resolution from run context; the error envelope codes.
- [ ] 2.3 Add the API client for the runner's `/browser/*` routes.
- [ ] 2.4 Write a step-log entry per call.
- [ ] 2.5 Add the agent instructions for `pay`, `delete`, Google sign-in, and `wait_for_user`.

## 3. Runner browser sessions (10–15 days)

- [ ] 3.1 `/browser/*` routes with the runner token.
- [ ] 3.2 Browser sandbox lifecycle: start on first call, 5-minute warm reuse, 30-minute wait, delete.
- [ ] 3.3 Chrome start settings (no automation flags, desktop viewport, user agent, timezone, locale).
- [ ] 3.4 CDP actions for the v1 tools; `read_page` and `find` with element references.
- [ ] 3.5 Load session state; read and return it at turn end for the generation check.
- [ ] 3.6 Allowlist and sign-in hosts through CDP request interception; record sign-in hosts during the owner's login.
- [ ] 3.7 Downloads to the per-user mount; uploads from session files only.
- [ ] 3.8 Report browser sandbox time to the existing sandbox metering.

## 4. Waiting for the user (4–6 days)

- [ ] 4.1 `wait_for_user` and take-control both park the turn on one client interaction.
- [ ] 4.2 Resume reattaches to the same browser sandbox and page.
- [ ] 4.3 After 30 minutes: fail the run, delete the sandbox, set the profile to `needs_login`.

## 5. Live view backend (4–6 days)

- [ ] 5.1 API WebSocket route with session auth; only the owner and organization admins.
- [ ] 5.2 Runner relay between the API WebSocket and the CDP screencast and input.
- [ ] 5.3 Stream only while a viewer is connected; control hand-off between the agent and the user.

## 6. Storage and records (5–7 days)

- [ ] 6.1 One named mount per (agent, user); sign it only for that user's runs.
- [ ] 6.2 Screenshot storage, readable by the owner and organization admins.
- [ ] 6.3 Job that deletes screenshots older than 30 days.
- [ ] 6.4 Step-log query endpoint.

## 7. Frontend (15–22 days)

- [ ] 7.1 Fern client update and the `@agenta/entities/browserProfile` entity.
- [ ] 7.2 Live view component in a shared package: canvas frames, input mapping, phone keyboard, zoom, take and give back control, all four states (5–7).
- [ ] 7.3 Settings: Browser logins tab and the organization admin switch (2–3).
- [ ] 7.4 Agent config: Browser section with an owner-only profile picker (2–3).
- [ ] 7.5 Chat: login dock card, "Watch browser" button, readable tool rows, screenshots in tool rows (4–6).
- [ ] 7.6 Session list badge for running and waiting browsers (1).

## 8. Verification (4–6 days, plus 5 calendar days)

- [ ] 8.1 Release-gate scenarios for the browser tools on Pi, Claude, and Codex.
- [ ] 8.2 User docs page.
- [ ] 8.3 R15 acceptance: log in once on a phone, then a scheduled run completes a task on that site on 5 days in a row with no new login.
