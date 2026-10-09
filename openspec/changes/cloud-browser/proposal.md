# Proposal

## Why

An agent can only act on tools that Agenta connects to. Many sites have no connector: HR portals, vendor portals, internal SaaS tools, and our own app under test. A person does this work by hand in a browser.

Agenta sandboxes already ship Chromium, and agents already run on schedules with no person present. What is missing is a browser the agent can drive safely, a way for the user to log in to a site once, a way to keep that login for later runs, and a way to watch and take control while the agent works.

Status: Requirements and decisions were confirmed by Ashraf between 2026-10-07 and 2026-10-09, including the triage of the scan [findings](findings.md). Nothing is implemented. Phase 0 (a spike) runs before any build work, and the estimate is re-checked after it. An implementing agent starts with [HANDOFF.md](HANDOFF.md), which sets the readiness gates. Each decision, with the person or reason behind it, is in [design.md](design.md).

## What Changes

- Add **browser profiles**. A profile is one saved browser identity (cookies and site storage) that belongs to one user. It holds logins to all the sites on its allowlist. Agenta never stores a password or a 2FA secret, and no vault route returns the stored session state.
- The user logs in to sites **themselves**, in a **live view** of a cloud browser, on a phone or a desktop. The owner confirms the single sign-on hosts the login passed through.
- An agent config names one profile. Runs of that agent, in chat or from a schedule or trigger, open a cloud browser with that profile already logged in. A run uses the profile only when the run's user is the owner, the owner committed the agent revision, and, for a channel run, the sender is a linked account.
- The browser runs in its **own Daytona sandbox, separate from the agent's sandbox**, with no agent shell. The agent drives it only through browser tools. The agent cannot read the cookies.
- Browser tools follow the shape of Anthropic's browser toolset (`navigate`, `read_page`, `find`, `form_input`, `left_click`, `type`, `upload`) and act by element reference, never by screen coordinates. `read_download` copies a download into the session. `pay` and `delete` ask for approval under the default permission mode. `wait_for_user` pauses the run for a login, 2FA, or CAPTCHA. The model works from page text; screenshots are for the user only. Pi, Claude, and Codex all get the same tools.
- The profile owner and admins (the organization owner, or a project `owner` or `admin`) can open the live view of a running browser session, including a scheduled run, watch it, and take control. While a user has control, the agent waits. The owner can see who watched or took control.
- After a turn, the browser stays warm for 5 minutes, so a quick follow-up in chat keeps the open page.
- When a site asks for a login or 2FA during a run, the run pauses for up to 30 minutes so the owner can finish it in the live view. After that the run fails. The profile is marked `needs_login` only when the run proved the session is logged out.
- The browser can only load sites on the profile's allowlist, in every page, frame, and popup, and never internal addresses.
- Each browser step is logged with a screenshot. Screenshots are kept for 30 days. The owner and admins can read the log. Values typed into password fields are redacted everywhere. Members who can open a session see the page text the agent read.
- Downloaded files are stored with the profile and readable only by the owner. The agent can upload files that are already in the session.
- Every second a browser sandbox runs is billed to the profile owner's payer, with a plan limit.
- The organization owner turns the feature on, on every plan. Then any member can create profiles.

## Capabilities

### New Capabilities

- `browser-profiles`: Creating, logging in to, and deleting browser profiles; ownership; the allowlist; profile state; organization gating; retention.
- `browser-sessions`: The browser sandbox for one agent session; who may use the profile; loading and saving it; waiting for the user; downloads and uploads; the allowlist; metering; the step log and redaction.
- `browser-agent-tools`: The tools the agent uses, how they reach each harness, approvals, and errors.
- `browser-live-view`: Watching a browser session and taking control, on a phone or a desktop; WebSocket security; login sessions; the owner's audit.

### Modified Capabilities

None. No existing behavior changes. Agents without a browser profile run exactly as today.

## Out of Scope (v1)

- Sharing a profile with other members or with the project (deferred to v2).
- Notifications when a run waits for a login (deferred).
- Self-hosted OSS and EE deployments (Agenta Cloud only in v1).
- Sites that are not on the public internet (VPN or IP-allowlisted intranets).
- Google Workspace through the browser. Gmail, Calendar, and Drive use the existing connectors.
- A paid browser provider (Browserbase, Steel, and similar). The browser is built on Daytona.
- WebRTC video for the live view.
- A fixed egress IP proxy, unless Phase 0 shows that it is needed (see design D3).

## Impact

- API (`api/oss`): a new `browser_profiles` domain (router, service, DAO, one `core_oss` migration), a `browser_session_state` secret kind excluded from every vault route, an admin check, RBAC permissions, an `allow_browser` organization flag, platform tool handlers, a session-state save route, one WebSocket route for the live view, profile-owned download storage, a screenshot retention job, a membership reconcile job, and plan-limit enforcement.
- SDK (`sdks/python`): a `browser.profile` agent config field, tool injection, the ten platform ops, and the `wait_for_user` client tool.
- Runner (`services/runner`): new `/browser/*` routes that create and drive the browser sandbox over CDP, replica ownership in Redis, the allowlist on every target, session-state load and save, metering of all browser time, and the live-view relay.
- Frontend (`web/mobile` and `@agenta/*` packages): the live view component, a Settings tab for browser logins, a Browser section in the agent config, a wait card and a "Watch browser" button in chat, screenshots in tool rows, a session list badge, and the owner's audit and downloads views.
- No change to the Daytona snapshot. No change to mounts.
