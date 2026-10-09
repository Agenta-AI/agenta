# Design

Status: Requirements (R) and decisions (D) marked "User" were confirmed by Ashraf between 2026-10-07 and 2026-10-09, including the triage of [findings.md](findings.md). Items marked "Design" are proposals in this document and need review before Phase 1. Nothing is implemented. The code facts below were read on `main` at `fa8b8114e`.

## Context

### What exists today

| Area | Fact | Source |
| --- | --- | --- |
| Chromium | Every sandbox image installs Playwright 1.62.0 and its Chromium build into `/opt/pw-browsers`. | `services/runner/images/sandbox/install-agent-tools.sh:22,154` |
| Agent prompt | The agent is told it has "`chromium` through Playwright (headless only)". | `sdks/python/agenta/sdk/agents/platform_instructions.py:163` |
| Sandbox providers | `local`, `daytona`, `inprocess`. `local` is "unconfined host bash, not a tenant boundary". | `services/runner/src/config/runner-config.ts:20`, `services/oss/src/agent/config.py:94` |
| Pi routing | A Pi run with a session and a run credential runs `inprocess`; its commands run in a Daytona command sandbox. The runner stops a command at its timeout, and a command never lives longer than the per-tool-call limit plus 60 seconds. | `services/runner/src/engines/sandbox_agent/sandbox-routing.ts:30-58`, `services/runner/src/engines/inprocess/sandbox/remote-command.ts:148-158` |
| Sandbox scope | One sandbox per session. Pool key is `projectId:sessionId`. | `services/runner/src/engines/sandbox_agent/session-identity.ts:899-907` |
| Sandbox lifetime | Warm for 2 minutes after a turn; Daytona auto-stop 15 minutes, auto-delete 30 minutes; clean turns park (stop) the sandbox. | `session-identity.ts:69`, `runner-config.ts:72-73`, `provider.ts:120-122`, `teardown.ts:50-52` |
| Runner replicas | The runner runs as several replicas and claims session ownership per replica. | `services/runner/src/engines/sandbox_agent/runtime-policy.ts:342-345` |
| Pause | An unanswered approval ends the turn and destroys the harness session. Only a `client` tool or a gated tool that the harness itself calls pauses a turn. | `services/runner/src/engines/sandbox_agent/pause.ts:1-9`, `services/runner/src/tools/client-tool-relay.ts:23-30` |
| Tool kinds | A resolved tool is `callback`, `code`, or `client`. | `services/runner/src/protocol.ts:167` |
| Tool timeout | A callback tool call times out after 30 seconds by default (`AGENTA_AGENT_TOOLS_TIMEOUT`); a `PlatformOp` can set its own `timeout_ms`. | `services/runner/src/tools/callback.ts:15-18,203-208`, `sdks/python/agenta/sdk/agents/platform/op_catalog.py:199` |
| Tool results | A tool result is one string; the runner caps a result at 100 KB. | `api/oss/src/core/tools/dtos.py:234-239`, `services/runner/src/tools/callback.ts:53` |
| Tool path | Callback tools POST to `/tools/call`; on Daytona the call is relayed through the runner. Handler-mode platform ops become callback tools with a `call_ref`. | `services/runner/src/tools/dispatch.ts:11-17`, `sdks/python/agenta/sdk/agents/platform/platform_tools.py:81,117-121` |
| Platform tools | A `PlatformOp` exposes an existing API endpoint (path mode) or a reserved `tools.agenta.*` handler (handler mode), with context bindings, a `read_only` hint, a `default_permission`, and a `timeout_ms`. It appears only when the author lists it in the agent config. | `sdks/python/agenta/sdk/agents/platform/op_catalog.py:154-200`, `api/oss/src/core/tools/platform_handlers.py:1-17`, `sdks/python/agenta/sdk/agents/tools/models.py:491-506` |
| Tool permissions | The default agent-wide mode is `allow_reads`. An explicit per-tool permission wins. Otherwise, under `allow_reads` a read-only tool runs and any other tool asks, and under another mode that mode applies. `PlatformOp.default_permission` applies only under `allow_reads`. | `sdks/python/agenta/sdk/agents/dtos.py:829`, `sdks/python/agenta/sdk/agents/tools/models.py:143-153`, `op_catalog.py:192-197` |
| API calls the runner | The API relays subscription logins to the runner. The only other direct API→runner call is `kill`; everything else goes through Redis. | `api/oss/src/core/secrets/subscription_service.py:222-326`, `api/oss/src/core/sessions/streams/runner_client.py:1-10` |
| Secrets | One encrypted `data` column (`pgp_sym_encrypt`), scoped by `project_id` or `organization_id`; `created_by_id` is audit only. Write-only values are returned in plaintext to any token with the `secret-resolve` grant, and every run gets that grant. | `api/oss/src/dbs/postgres/secrets/dbas.py:24-32`, `api/oss/src/apis/fastapi/vault/router.py:233-245`, `api/oss/src/core/workflows/service.py:3099-3108` |
| Connections | Composio connections use the project ID as the Composio user. | `api/oss/src/core/gateway/connections/service.py:174` |
| Login state precedent | Subscription logins have `pending_login` / `ready` / `needs_login` and a runner write-back with a generation guard. | `api/oss/src/core/secrets/subscription_service.py:495,554` |
| Run identity | Scheduled and triggered runs act as the schedule creator. Channel runs act as the sender's linked Agenta user, or the agent creator when there is none. | `api/oss/src/tasks/asyncio/triggers/dispatcher.py:250`, `api/oss/src/tasks/asyncio/channels/inbox.py:222,327` |
| Revision author | Every revision records its author. | `api/oss/src/dbs/postgres/shared/dbas.py:223-236` (`CommitDBA`) |
| Roles | Roles (`owner`, `admin`, `developer`, `editor`, `annotator`, `viewer`) are per project or workspace. At organization level only the owner is special. On EE plans without RBAC, the permission check returns `true` for every member. | `api/oss/src/core/access/permissions/service.py:314-338` |
| Organization flags | Flags are a JSON dict on the organization, with defaults set where an organization is created. Only the organization owner changes them, and on EE that needs the `ACCESS` entitlement. | `api/oss/src/services/db_manager.py:517`, `api/oss/src/services/commoners.py:127`, `api/oss/src/routers/organization_router.py:420-436` |
| Mounts | Mounts are generic (`project_id` + `mount_id`, optional `agent_id` and `session_id`) and have no owner; every mount route checks project permissions only. | `api/oss/src/core/mounts/dtos.py:25-35`, `api/oss/src/apis/fastapi/mounts/router.py` |
| Live frames | Text, reasoning, and tool events only; batches up to 64 KB. | `services/runner/src/sessions/live-frames.ts:5-8,84-170` |
| Tool output UI | Tool output renders as text in a `<pre>` block. | `web/packages/agenta-chat/src/components/ToolIOBlock.tsx:20-32` |
| WebSockets | The API runs `uvicorn[standard]`, which includes `websockets`, but no route uses WebSockets. Auth runs as HTTP middleware, which does not run for WebSocket connections. | `api/pyproject.toml:19`, `api/entrypoints/routers.py:619` |
| Metering | The runner reports sandbox seconds to the wallet while a turn runs, keyed to the run's credential, when `AGENTA_WALLETS_ENABLED` is on. | `services/runner/src/metering/sandbox-usage.ts:1-23` |
| SSRF guard | The runner already has an SSRF guard for outbound tool URLs. | `services/runner/src/tools/ssrf-guard.ts` |
| Google connectors | Gmail, Google Calendar, and Google Drive are available through Composio and used by agent templates. | `api/oss/src/core/agent_templates/catalog.py:42` |

### What is missing

- A browser tool the model can call. Today the agent can only write Playwright scripts with its shell.
- Saved logins. Nothing persists cookies between runs, and nothing is owned by one user.
- A visual channel. No image, video, or sandbox URL reaches the frontend.
- A safe place for cookies. Inside the agent sandbox, the agent can read them and send them anywhere; in the vault, every run token can read write-only values.

## Requirements register

"User" means Ashraf chose it. "Triage" means Ashraf chose it while triaging a finding (F-xxx).

| # | Requirement | Source | Spec |
| --- | --- | --- | --- |
| R1 | A profile belongs to one user. | User | browser-profiles |
| R2 | The agent config names one profile. Only its owner can set it. Only the owner's runs can use it. | User | browser-profiles, browser-sessions |
| R3 | Agenta Cloud only in v1. | User | proposal |
| R4 | The user logs in in a live view, on a phone or a desktop. | User | browser-live-view |
| R5 | Build on Daytona. No browser vendor. | User | design D1 |
| R6 | A login or 2FA prompt during a run pauses the run until the owner finishes it in the live view. | User | browser-sessions |
| R7 | Only payment and delete actions ask for approval by default. | User | browser-agent-tools |
| R8 | Each profile has an allowlist of sites. | User | browser-profiles, browser-sessions |
| R9 | Several runs can use one profile at the same time. | User | browser-sessions |
| R10 | Downloads are stored with the profile and readable only by the owner; the agent copies one into the session with `read_download`. | Triage F-011 | browser-sessions |
| R11 | The agent can upload files that are already in the session. | User | browser-sessions |
| R12 | A step log with screenshots is kept for 30 days. The owner can delete a profile at any time. | User | browser-sessions, browser-profiles |
| R13 | Every second a browser sandbox runs is billed to the profile owner's payer, with a plan limit. | Triage F-016; limit values open (Q1) | browser-sessions |
| R14 | v1 targets: QA of our own app, one public SaaS app behind SSO, one public SaaS app with Okta or email login. | User; app names open (Q2) | tasks |
| R15 | Done when the user logs in once on a phone and a scheduled run completes a task on that site 5 days in a row with no new login. | User | tasks |
| R16 | The user can watch live and take control at any time; the agent waits. | User | browser-live-view |
| R17 | The live stream runs only while someone watches. | User | browser-live-view |
| R18 | The user can open a running scheduled or triggered run and watch it. | User | browser-live-view |
| R19 | Store only session state (cookies and site storage). Never passwords or 2FA secrets. | User | browser-profiles |
| R20 | Public internet sites only. | User | browser-sessions |
| R21 | Results-only access for members a profile is shared with. | User; deferred to v2 with sharing | — |
| R22 | With parallel runs, the run that ends last saves the profile. | User | browser-sessions |
| R23 | Page-snapshot tools by element reference; never pixel coordinates. | User | browser-agent-tools |
| R24 | Pi, Claude, and Codex all support the browser. | User | browser-agent-tools |
| R25 | No notifications in v1. | User; deferred | — |
| R26 | A paused run waits 30 minutes, then fails. The profile becomes `needs_login` only when the run proved the session is logged out. | User; changed by triage F-020 | browser-sessions |
| R27 | The organization owner turns the feature on, on every plan; then any member can create profiles. | Triage F-003 | browser-profiles |
| R28 | `pay` and `delete` are dedicated tools that ask; best effort; every step is logged. | User | browser-agent-tools |
| R29 | The browser always uses a desktop viewport. | User | browser-live-view |
| R30 | One profile can hold logins to all the sites on its allowlist. | User | browser-profiles |
| R31 | A run whose profile is already `needs_login` fails at once without starting a browser. | User | browser-sessions |
| R32 | Agents never type a Google login. Google Workspace uses the existing connectors. | User | browser-agent-tools |
| R33 | Chrome starts without automation flags, with a desktop user agent and a matching timezone and locale. Detection hygiene only; v1 does not depend on it. | User | browser-sessions |
| R34 | When the owner leaves the organization, their profiles are deleted. | User | browser-profiles |
| R35 | Admins (D21) can see the step log and the screenshots of every browser run. | User; admin defined by triage F-003 | browser-sessions |
| R36 | Unused profiles are kept until the owner deletes them. | User | browser-profiles |
| R37 | After a turn ends, the browser sandbox stays warm for 5 minutes. The next turn of the same session in that time reuses it, with the open page. | User | browser-sessions |
| R38 | Admins (D21) can watch and take control of any browser session. | User; admin defined by triage F-003 | browser-live-view |
| R39 | A channel run without a linked sender never uses a profile. | Triage F-004 | browser-sessions |
| R40 | A run uses the profile only if the agent revision it runs was committed by the profile owner. | Triage F-005 | browser-sessions |
| R41 | Values typed into password fields are redacted in the step log, the transcript, and traces. Members who can open a session see the page text the agent read. | Triage F-012 | browser-sessions, browser-agent-tools |
| R42 | The owner can see who watched or took control of their browser sessions, and when. | Triage F-022 | browser-live-view |
| R43 | Screenshots are shown to the user only; the model works from page text. | Triage F-008 | browser-agent-tools |

## Decisions

| # | Decision | Source | Alternatives rejected |
| --- | --- | --- | --- |
| D1 | Chromium runs in a separate browser sandbox with no agent shell. The agent drives it only through browser tools. | User | Chromium in the agent sandbox (the agent can read cookies and reach the debug port; Pi in-process stops long-running commands; the browser dies when a turn pauses). A paid provider (R5). |
| D2 | One browser sandbox per agent session at a time. It starts on the session's first browser tool call. After a turn it stays warm for 5 minutes (R37), or up to 30 minutes while a wait is pending (R26), then it is deleted. Parallel runs are separate sessions, each with its own browser. | User (start on first call: Design) | One warm browser per profile (parallel runs would share one browser). Reopening the last URL, or a blank page, for chat follow-ups. |
| D3 | No egress proxy in v1. Add a fixed-IP proxy only if Phase 0 or the R15 acceptance run shows logins break because the egress IP changes. | User | A proxy fleet in v1. |
| D4 | Server code goes in `api/oss/src/{apis,core,dbs}/browser_profiles/`, gated by a new organization flag `allow_browser`. | User | `api/ee`: `api/AGENTS.md` keeps EE for billing, organizations, workspace, meters, subscriptions, and throttling. |
| D5 | A new `browser_profiles` domain holds owner, state, allowlist, and sign-in hosts. The session state lives in a dedicated secret kind, `browser_session_state`, that every vault route excludes for every principal, including run tokens. Only the `browser_profiles` service reads it. | User; secret kind by triage F-006 | A write-only vault secret (run tokens with `secret-resolve` receive it in plaintext). An owner column on every secret. |
| D6 | Downloads are stored by the `browser_profiles` domain in object storage, under the profile, readable only by the owner. The `read_download` op copies one download into the run's session files. Mounts do not change. | Triage F-011 | A per-user mount (mounts have no owner and every route checks project permissions only). Session files directly (not private). |
| D7 | The allowlist is enforced in the browser sandbox through CDP on every target (pages, iframes, popups, workers, downloads) with auto-attach. Navigation to IP literals, `localhost`, and private or link-local ranges is refused, reusing the runner's SSRF guard rules. Chrome's debugging port accepts connections only from the runner. | User; full coverage by triage F-013 | Top-level pages only. An egress proxy with a second layer (D3). |
| D8 | Tool names and inputs follow Anthropic's browser toolset where a tool of the same name exists, limited to the v1 set, by element reference only, plus `pay`, `delete`, `read_download`, and `wait_for_user`. No model-facing `screenshot`. | User; screenshot removed by triage F-008 | Playwright MCP names. A fully custom set. All 27 toolset tools. |
| D9 | The live view is a CDP screencast plus CDP input events over one WebSocket: browser ⇄ runner ⇄ API ⇄ web app. | User | WebRTC desktop stream (adds WebRTC, possibly TURN, Xvfb, and a snapshot change). |
| D10 | The browser sandbox uses the existing agent snapshot, which already has Chromium. No snapshot change. | User | A new browser-only snapshot. |
| D11 | Ten browser tools are `PlatformOp` entries in handler mode (`tools.agenta.browser_*`). The API handler checks access and calls the runner's `/browser/*` routes. `wait_for_user` is a `client` tool with its own render hint, because only a client tool pauses a turn. | Design; `wait_for_user` kind by triage F-001 | Path mode on public REST endpoints. A runner-local executor kind (does not exist). `wait_for_user` in handler mode (cannot pause). |
| D12 | A login, 2FA, or CAPTCHA prompt pauses the turn when the agent calls `wait_for_user`. When a user takes control in the live view, every browser op fails with `user_in_control`, whose `next_step` tells the agent to call `wait_for_user`. The browser sandbox keeps running during the pause because it is separate from the agent session. | Design; take-control by triage F-002 | A tool call that blocks for 30 minutes (tool calls time out). Injecting an interaction into a running turn (no such path exists). |
| D13 | The profile is resolved on the server from the run's agent revision and the run's user. The model never passes a profile ID. The handler refuses when the run's user is not the owner, when the revision's author is not the owner (R40), and when a channel run has no linked sender (R39). | Design; checks by triage F-004, F-005 | The model passes a profile ID. Clearing or locking the binding on another user's commit. |
| D14 | Re-login bumps a profile generation. A run may save session state only if the generation it loaded is still current and the profile is not archived. Among runs on the same generation, the last save wins. | Design | Plain last-writer-wins (a stale run could overwrite a fresh re-login). |
| D15 | During a live-view login, the allowlist still applies, except that the browser may follow redirects that start on an allowlisted site. Hosts in those redirect chains are proposed as sign-in hosts; the owner confirms them before they are saved. A login session ends after 30 minutes, and a user can have one login session open at a time. | Design; restricted by triage F-014 | An open browser during login (every visited host becomes allowed; an unrestricted cloud browser for any member). A fixed list of known identity providers. |
| D16 | The agent reports a login, 2FA, or CAPTCHA prompt by calling `wait_for_user` with a reason. Agenta does not detect login pages, except as D18 says. | Design | Automatic login-page detection (unreliable across sites). |
| D17 | Eight ops set `default_permission` `allow` (`navigate`, `read_page`, `find`, `form_input`, `left_click`, `type`, `upload`, `read_download`) and two set `ask` (`pay`, `delete`). Under the default `allow_reads` mode this gives R7. When an author picks another agent-wide mode or a per-tool permission, that choice applies, as for every tool. | Design | Writing explicit per-tool permissions when a profile is attached (would override an author who chose `ask` for everything). |
| D18 | A run proves the session is logged out when a navigation to an allowlisted site lands on a confirmed sign-in host. The op then fails with `login_required`, and the agent calls `wait_for_user`. If that wait times out, the run fails and the profile becomes `needs_login`. Any other wait that times out fails only the run. | Design; implements triage F-020 | Marking `needs_login` on every timed-out wait (one false alarm blocks every later run). |
| D19 | Redis records the runner replica that owns each browser session. The API and other replicas forward `/browser/*` calls and the live view to that replica. At turn end the runner posts the session state to a new API route, which applies D14. | Triage F-007 | Stateless reattach on every call (timers and the screencast would move to shared jobs). |
| D20 | The runner meters every second a browser sandbox runs (turns, warm time, waits, login sessions) to the profile owner's payer, using the run credential or, for a login session, the owner's credential. The API refuses to start a browser sandbox when the payer's plan limit is reached. | Triage F-016 | Billing turn time only. |
| D21 | "Admin" means the organization owner, or a member whose role is `owner` or `admin` in the session's project. The check reads the member role directly and does not use the non-RBAC allow-all path. Only the organization owner changes `allow_browser`, and that flag is exempt from the `ACCESS` entitlement. | Triage F-003 | Any member who passes the RBAC check (every member on plans without RBAC). |
| D22 | The live-view WebSocket route authenticates inside the route (session cookie or API key), checks the `Origin` header against the web app's origins, checks D21 or ownership, and closes when the session expires. | Triage F-010 | Relying on the HTTP auth middleware (it does not run for WebSockets). |
| D23 | The SDK adds a `browser.profile` field to the agent config. When it is set, the resolver adds the browser tools; when platform handlers are turned off, an agent with a profile fails with a clear configuration error instead of losing the tools silently. | Triage F-009 | Authors listing the eleven tools by hand. |
| D24 | Redaction: the runner marks values typed into password fields, and the API stores `"[redacted]"` for them in the step log, the tool arguments in the transcript, and traces. | Triage F-012 | Hiding all browser tool input and output from non-owners (new filtering in sessions and tracing). |

## Architecture

```
Agent harness (Pi / Claude / Codex)
  → tool call tools.agenta.browser_<op>            (PlatformOp, handler mode)
  → API POST /tools/call → browser handler
      checks: allow_browser, run user == owner, revision author == owner,
              linked channel sender, profile state, plan limit; step log; redaction
  → owning runner replica /browser/*               (internal, runner token; Redis routing)
  → browser sandbox (Daytona, existing snapshot, no agent shell)
      Chrome over CDP: allowlist on every target; session state loaded and saved through the API

wait_for_user                                       (client tool → turn pauses; browser keeps running)

Web app ⇄ API WebSocket (in-route auth, Origin) ⇄ owning runner ⇄ CDP screencast + input
```

### Profile lifecycle

`pending_login` → (the owner logs in through the live view, confirms the sign-in hosts, presses Done; the runner reads the session state; the API stores it as `browser_session_state` and bumps the generation) → `ready` → (a run proves a logout and its wait times out, D18) → `needs_login` → `ready` after a new login. "Log in again" works from any state and ends in `ready`. Deleting a profile archives the row, hard-deletes its session state and downloads, and stops its running browser sandboxes.

### Run lifecycle

1. The first browser tool call of a session reaches the API handler. The handler resolves the profile and runs the D13 checks. If the profile is `needs_login`, the call fails with `profile_needs_login` and no sandbox starts (R31). If the payer's plan limit is reached, the call fails with `browser_limit_reached`.
2. The API asks a runner to start a browser sandbox and records the owning replica (D19). The runner creates it from the existing snapshot, starts Chrome (R33), loads the session state, and installs the allowlist on every target (D7).
3. Each tool call runs one CDP action and writes one step-log entry with a screenshot (redacted per D24). The model gets text results only (R43).
4. A prompt the agent cannot pass leads it to call `wait_for_user`, which pauses the turn. A user taking control makes browser ops fail with `user_in_control` until control is given back. The browser keeps running for up to 30 minutes. When the user is done, the turn resumes on the same page.
5. When a turn ends, the runner posts the session state to the API, which saves it under D14. The sandbox stays warm for 5 minutes (R37) or until a pending wait ends, then the runner deletes it. Metering covers the whole lifetime (D20).

### Access rules (v1)

- Use a profile in a run: the run's user is the owner, the revision's author is the owner, and a channel run has a linked sender (D13).
- Watch or take control of a browser session: the owner and admins (D21). Every open and every control hand-off is recorded for the owner (R42).
- Read step logs and screenshots: the owner and admins.
- Read downloads: the owner (D6). A download copied into a session is visible to members who can open that session.
- Read transcript and traces: members who can open the session, with password values redacted (D24).
- Manage profiles: the owner. Change `allow_browser`: the organization owner.

## Threat model

| Threat | Mitigation | Residual risk |
| --- | --- | --- |
| The agent reads the cookies (prompt injection or a bad author). | Separate browser sandbox (D1); session state in a secret kind no vault route returns (D5); CDP methods that read cookies are never exposed as tools. | None known. |
| Another member uses the owner's logins. | Owner, revision-author, and linked-sender checks (D13). | An admin can take control (R38); every such session is recorded for the owner (R42). |
| Page content tells the agent to act (prompt injection). | Allowlist on every target (D7); `pay` and `delete` ask (D17); only owner-committed revisions run with the profile (R40); every step is logged. | The agent can still act on allowlisted sites and can pass page text to its other tools, such as a Slack send. The owner accepts this when they attach a profile to an agent with such tools. |
| The browser is used to reach internal hosts (SSRF). | IP literal, `localhost`, private, and link-local refusal (D7); Chrome debugging port closed to everyone but the runner. | DNS rebinding is checked by Phase 0 check 0.9. |
| The live view is hijacked from another site. | In-route auth and `Origin` check; close on session expiry (D22). | None known. |
| Login sessions are used as a free open browser. | Allowlist applies during login (D15); one session per user; 30-minute limit; billing (D20). | None known. |
| Secrets leak through logs. | Redaction of password fields (D24); the step log is visible to the owner and admins only. | Text the agent types into fields that are not password fields is stored as typed. |

## Risks and unknowns

Each item has a Phase 0 check in [tasks.md](tasks.md). None of them is assumed to pass.

| Risk | Why it matters | Check |
| --- | --- | --- |
| Browser sandbox start time | Each session starts a second sandbox. A slow start delays the first browser step and sets the first op's `timeout_ms`. | 0.1 |
| CDP over the Daytona preview proxy | CDP is a WebSocket. No WebSocket traffic has been tested through the preview proxy. If it fails, a small relay process inside the browser sandbox is needed. | 0.2 |
| Tools in each harness | The handler-mode ops and the `wait_for_user` client tool must work in Pi, Claude, and Codex, and `read_page` must fit under the 100 KB result cap on real pages. | 0.3 |
| WebSockets through the cloud ingress | No API route uses WebSockets today. Ingress idle timeouts can cut a live view; cookie auth must work on the WebSocket handshake. | 0.4 |
| Changing egress IPs and bot detection | Some sites end a session when the IP changes or block automation. This decides D3. | 0.5, acceptance |
| A pending interaction in a scheduled run | R6 and R18 need a scheduled run to park on `wait_for_user` and be answered later from the session screen. No code path shows this works for trigger-origin sessions. | 0.6 |
| Agent sandbox reaching the browser sandbox | D1 depends on the agent having no network path or credential to the browser sandbox. | 0.7 |
| Two runner replicas | D19 routing must hold the CDP socket, timers, and live view on the owning replica. | 0.8 |
| DNS rebinding and private ranges | D7 must refuse a public host name that resolves to a private address. | 0.9 |

## Estimate

Basis: one engineer who knows the runner and the API, working days, unit and security tests included (F-017), review wait time excluded. Ranges, not points. Re-estimate after Phase 0; the first four risks can each add work.

| Phase | Work | Engineer-days |
| --- | --- | --- |
| 0 | Spike (time-boxed, nine checks) | 5–7 |
| 1 | API domain, migration, RBAC, admin check (D21), organization flag, `browser_session_state` secret kind, states, revision-author check, membership reconcile | 8–12 |
| 2 | SDK config field and tool injection (D23), ten platform ops, API handlers, API→runner client with replica routing, checks, step log, redaction, error envelopes, approval defaults | 8–12 |
| 3 | Runner `/browser/*`: replica ownership, sandbox lifecycle, Chrome launch, CDP actions, `read_page` and `find` with references and size bounds, session-state load and save route, allowlist on every target and SSRF refusal, uploads, downloads to profile storage, metering of all browser time | 14–21 |
| 4 | `wait_for_user` client tool, `user_in_control`, `login_required` (D18), pause and reattach, 30-minute expiry | 5–7 |
| 5 | Live view backend: WebSocket route with in-route auth and `Origin`, runner relay, input mapping, control hand-off, open/control audit, login-session limits | 6–9 |
| 6 | Profile-owned download storage and `read_download`; screenshot storage and 30-day deletion job; step-log query; plan limit enforcement | 7–10 |
| 7 | Frontend: live view 5–7, Settings tab 2–3, agent config section 2–3, chat dock (wait card), watch button, tool rows and screenshots 4–6, session badge 1, Fern client and entity 1–2, owner audit view and downloads list 2–3 | 17–25 |
| 8 | Release-gate scenarios on Pi, Claude, and Codex; docs page; the R15 acceptance run (5 calendar days elapsed) | 4–6 |
| | **Total** | **74–109** |

The total rose from 57–85 after the scan. Triage added work in Phases 1–7: the dedicated secret kind, the revision-author check, membership reconcile, tool injection, replica routing, allowlist coverage, redaction, billing of all browser time, the audit, and tests per phase. Profile-owned download storage replaced the mount work.

Not included: plan pricing and limit values (Q1), Daytona quota changes, a fixed egress proxy if D3 triggers it, and v2 items (sharing, notifications, self-hosted).

## Open questions

| # | Question | Owner | Blocks |
| --- | --- | --- | --- |
| Q1 | Browser-minute limit per plan (R13). | Product | Task 6.4 limit values, not the build |
| Q2 | The two SaaS apps for R14. | Ashraf | Phase 0 check 0.5 |

## Corrections made during planning

These earlier statements were wrong and are fixed above. They are kept so a reviewer can see what changed.

- "No Xvfb or VNC exists": `sandbox-agent@0.4.2` has a `/v1/desktop/*` API with Xvfb, screenshots, and a WebRTC stream. It is unused, and D9 does not need it.
- "CDP screencast is watch-only": CDP input events allow control too. This made D9 possible.
- "Secrets have no user column": they have audit columns (`created_by_id`) but no owner.
- "The broker lives in the runner and serves tools itself": all harnesses already meet at `/tools/call` (D11).
- "Code goes in `api/ee`": contradicts `api/AGENTS.md` (D4).
- "A one-day spike": the honest range is 5–7 engineer-days for nine checks.
- Second review against the code: the Pi kill rule was stated too broadly; organization flags are not typed by `OrganizationFlags`; `pay`/`delete` asking depends on the agent-wide permission mode (D17); a paused scheduled run is unverified; channel-run identity added.
- Scan and triage ([findings.md](findings.md)): `wait_for_user` must be a client tool; take-control needs `user_in_control`; a write-only secret is readable by every run; mounts have no owner; screenshots cannot reach the model; WebSocket routes skip the auth middleware; "the API reads session streams from the runner" was wrong (only `kill` and subscription logins call it directly).
