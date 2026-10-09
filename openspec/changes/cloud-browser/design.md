# Design

Status: Requirements (R) and decisions (D) marked "User" were confirmed by Ashraf between 2026-10-07 and 2026-10-09. Items marked "Design" are proposals in this document and need review before Phase 1. Nothing is implemented. The code facts below were read on `main` at `fa8b8114e`.

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
| Pause | An unanswered approval ends the turn and destroys the harness session. | `services/runner/src/engines/sandbox_agent/pause.ts:4` |
| Tool timeout | A callback tool call times out after 30 seconds by default (`AGENTA_AGENT_TOOLS_TIMEOUT`). | `services/runner/src/tools/callback.ts:15-18` |
| Tool path | Callback tools POST to `/tools/call`; on Daytona the call is relayed through the runner. | `services/runner/src/tools/dispatch.ts:11-17` |
| Platform tools | `PlatformOp` entries expose either an existing API endpoint (path mode) or a reserved `tools.agenta.*` handler (handler mode). They support context bindings, a `read_only` hint, a `default_permission`, and a per-op `timeout_ms`. | `sdks/python/agenta/sdk/agents/platform/op_catalog.py:154-200`, `api/oss/src/core/tools/platform_handlers.py:1-17` |
| API calls the runner | The API already relays subscription logins to the runner and reads session streams from it. | `api/oss/src/apis/fastapi/vault/router.py:188-217`, `api/oss/src/core/sessions/streams/runner_client.py` |
| Secrets | One encrypted `data` column (`pgp_sym_encrypt`); scoped by `project_id` or `organization_id`; `created_by_id` is audit only, not an owner. | `api/oss/src/dbs/postgres/secrets/dbas.py:24-32`, `api/oss/src/dbs/postgres/shared/dbas.py` (`LifecycleDBA`) |
| Connections | Composio connections use the project ID as the Composio user. | `api/oss/src/core/gateway/connections/service.py:174` |
| Login state precedent | Subscription logins have `pending_login` / `ready` / `needs_login` and a runner write-back with a generation guard. | `api/oss/src/core/secrets/subscription_service.py:496,554` |
| Run identity | Scheduled and triggered runs act as the schedule creator. Channel runs act as the sender's linked Agenta user, or the agent creator when there is none. | `api/oss/src/tasks/asyncio/triggers/dispatcher.py:250`, `api/oss/src/tasks/asyncio/channels/inbox.py:222,327` |
| Tool permissions | The default agent-wide mode is `allow_reads`. An explicit per-tool permission wins. Otherwise, under `allow_reads` a read-only tool runs and any other tool asks, and under another mode that mode applies. A `PlatformOp.default_permission` applies only under `allow_reads`. | `sdks/python/agenta/sdk/agents/dtos.py:829`, `sdks/python/agenta/sdk/agents/tools/models.py:143-153`, `sdks/python/agenta/sdk/agents/platform/op_catalog.py:192-197` |
| Mounts | Mounts are generic: `project_id` + `mount_id`, optional `agent_id` and `session_id`, with a file upload route. The agent mount is shared by every session of the agent. The runner mounts only the session folder and the agent mount into a sandbox today. | `api/oss/src/core/mounts/dtos.py:25-56`, `api/oss/src/apis/fastapi/mounts/router.py` (`/{mount_id}/files/upload`), `services/runner/src/engines/sandbox_agent/agent-mount.ts:24-29`, `services/runner/src/environment/mount-lifecycle.ts:177` |
| Live frames | Text, reasoning, and tool events only; batches up to 64 KB. | `services/runner/src/sessions/live-frames.ts:5-8,84-170` |
| Tool output UI | Tool output renders as text in a `<pre>` block. | `web/packages/agenta-chat/src/components/ToolIOBlock.tsx:20-32` |
| WebSockets | The API runs `uvicorn[standard]`, which includes `websockets`, but no route uses WebSockets today. | `api/pyproject.toml:19`, `api/oss/src/middlewares/prefix.py:36` |
| Metering | The runner reports sandbox seconds per interval to the wallet when `AGENTA_WALLETS_ENABLED` is on. | `services/runner/src/metering/sandbox-usage.ts:1-23` |
| Organization flags | Flags are a JSON dict on the organization. Defaults are set where an organization is created; the `OrganizationFlags` model types only `is_demo`. | `api/oss/src/services/db_manager.py:517`, `api/oss/src/services/commoners.py:127`, `api/oss/src/models/shared_models.py:6-7`, `docs/design/organization flags/ORGANIZATION_FLAGS.md` |
| Google connectors | Gmail, Google Calendar, and Google Drive are available through Composio and used by agent templates. | `api/oss/src/core/agent_templates/catalog.py:42` |

### What is missing

- A browser tool the model can call. Today the agent can only write Playwright scripts with its shell.
- Saved logins. Nothing persists cookies between runs, and nothing is owned by one user.
- A visual channel. No image, video, or sandbox URL reaches the frontend.
- A safe place for cookies. Inside the agent sandbox, the agent can read them and send them anywhere.

## Requirements register

"Source: User" means Ashraf chose it. "Derived" means it follows directly from a user decision, and the decision is named.

| # | Requirement | Source | Spec |
| --- | --- | --- | --- |
| R1 | A profile belongs to one user. | User | browser-profiles |
| R2 | The agent config names one profile. Only its owner can attach it. Only the owner's runs can use it. | User (R2 + sharing deferred) | browser-profiles, browser-sessions |
| R3 | Agenta Cloud only in v1. | User | proposal |
| R4 | The user logs in in a live view, on a phone or a desktop. | User | browser-live-view |
| R5 | Build on Daytona. No browser vendor. | User | design D1 |
| R6 | A login or 2FA prompt during a run pauses the run until the owner finishes it in the live view. | User | browser-sessions |
| R7 | Only payment and delete actions ask for approval by default. | User | browser-agent-tools |
| R8 | Each profile has an allowlist of sites. | User | browser-profiles, browser-sessions |
| R9 | Several runs can use one profile at the same time. | User | browser-sessions |
| R10 | Downloads go to a folder only the run's user can read. | User | browser-sessions |
| R11 | The agent can upload files that are already in the session. | User | browser-sessions |
| R12 | A step log with screenshots is kept for 30 days. The owner can delete a profile at any time. | User | browser-sessions, browser-profiles |
| R13 | Browser sandbox time is metered with the existing sandbox metering, with a plan limit. | User; limit values open (Q1) | browser-sessions |
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
| R26 | A paused run waits 30 minutes, then fails and marks the profile `needs_login`. | User | browser-sessions |
| R27 | An organization admin turns the feature on; then any member can create profiles. | User | browser-profiles |
| R28 | `pay` and `delete` are dedicated tools that ask; best effort; every step is logged. | User | browser-agent-tools |
| R29 | The browser always uses a desktop viewport. | User | browser-live-view |
| R30 | One profile can hold logins to all the sites on its allowlist. | User | browser-profiles |
| R31 | A run whose profile is already `needs_login` fails at once without starting a browser. | User | browser-sessions |
| R32 | Agents never type a Google login. Google Workspace uses the existing connectors. | User | browser-agent-tools |
| R33 | Chrome starts without automation flags, with a desktop user agent and a matching timezone and locale. Detection hygiene only; v1 does not depend on it. | User | browser-sessions |
| R34 | When the owner leaves the organization, their profiles are deleted. | User | browser-profiles |
| R35 | Organization admins can see the step log and the screenshots of every browser run. | User | browser-sessions |
| R36 | Unused profiles are kept until the owner deletes them. | User | browser-profiles |
| R37 | After a turn ends, the browser sandbox stays warm for 5 minutes. The next turn of the same session in that time reuses it, with the open page. | User | browser-sessions |
| R38 | Organization admins can watch and take control of any browser session. | User | browser-live-view |

## Decisions

| # | Decision | Source | Alternatives rejected |
| --- | --- | --- | --- |
| D1 | Chromium runs in a separate browser sandbox with no agent shell. The agent drives it only through browser tools. | User | Chromium in the agent sandbox (agent can read cookies and reach the debug port; Pi in-process kills long-lived processes; the browser dies when a turn pauses). A paid provider (R5). |
| D2 | One browser sandbox per run. It starts on the run's first browser tool call. After the turn ends it stays warm for 5 minutes (R37), or up to 30 minutes while a wait is pending (R26), then it is deleted. | User (start on first call: Design) | One warm browser per profile (parallel runs would share one browser; higher cost). Reopen the last URL in a new sandbox, or start blank (both offered for chat follow-ups; the user chose 5 minutes warm). |
| D3 | No egress proxy in v1. Add a fixed-IP proxy only if Phase 0 or the R15 acceptance run shows logins break because the egress IP changes. | User | A proxy fleet in v1. |
| D4 | Server code goes in `api/oss/src/{apis,core,dbs}/browser_profiles/`, gated by a new organization flag `allow_browser`. | User (after the guide review) | `api/ee`: `api/AGENTS.md` keeps EE for billing, organizations, workspace, meters, subscriptions, and throttling. |
| D5 | A new `browser_profiles` domain holds owner, state, and allowlist. The cookies live in a write-only vault secret that the profile points to. The secrets table does not change. | User | An owner column on every secret (touches every secret flow). |
| D6 | Downloads use one named mount per (agent, user), signed only for that user's runs. | User | A new mount prefix type. The shared agent mount (every run of the agent can read it). |
| D7 | The allowlist is enforced in the browser sandbox through CDP. | User | An egress proxy with a second layer (see D3). |
| D8 | Tool names and inputs follow Anthropic's browser toolset, limited to the v1 set, by element reference only, plus `pay` and `delete`. | User | Playwright MCP names. A fully custom set. All 27 toolset tools. |
| D9 | The live view is a CDP screencast plus CDP input events over one WebSocket: browser ⇄ runner ⇄ API ⇄ web app. | User | WebRTC desktop stream (adds WebRTC, possibly TURN, Xvfb, and a snapshot change). |
| D10 | The browser sandbox uses the existing agent snapshot, which already has Chromium. No snapshot change. | User (part of D9) | A new browser-only snapshot. |
| D11 | Browser tools are `PlatformOp` entries in handler mode (`tools.agenta.browser_*`). The API handler checks access and calls the runner's `/browser/*` routes. | Design | Path mode on public REST endpoints (the agent-only operations would join the public API surface). A runner-local executor kind (does not exist; Pi on Daytona already reaches tools through `/tools/call`). |
| D12 | One "wait for user" interaction covers a login prompt, a 2FA prompt, and the user taking control. The turn pauses through the existing client-tool path; the browser sandbox keeps running because it is separate from the agent session. | Design | A tool call that blocks for 30 minutes (tool calls time out after 30 seconds; harness timeouts differ). |
| D13 | The profile is resolved on the server from the run's agent revision and the run's user. The model never passes a profile ID. | Design | The model passes a profile ID (it could name another user's profile). |
| D14 | Re-login bumps a profile generation. A run may save cookies only if the generation it loaded is still current. Among runs on the same generation, the last save wins. | Design (implements R22 safely) | Plain last-writer-wins (a stale run could overwrite a fresh re-login). |
| D15 | The sign-in host list is recorded from the hosts the owner's browser passes through during a live-view login, and shown to the owner. The allowlist is not enforced during the owner's own login session. | Design | A fixed list of known identity providers (misses custom SSO hosts). Asking the owner to type SSO hosts. |
| D16 | The agent reports a login or 2FA prompt by calling a `wait_for_user` tool. Agenta does not detect login pages itself. | Design | Automatic login-page detection (unreliable across sites). |
| D17 | The browser ops set `default_permission`: `allow` for the nine non-destructive ops, `ask` for `pay` and `delete`. Under the default `allow_reads` mode this gives R7. When an author picks another agent-wide mode or a per-tool permission, that choice applies, as for every tool. | Design | Writing explicit per-tool permissions when a profile is attached (would silently override an author who chose `ask` for everything). |

## Architecture

```
Agent harness (Pi / Claude / Codex)
  → tool call tools.agenta.browser_<op>            (PlatformOp, handler mode)
  → API POST /tools/call → browser handler
      checks: allow_browser flag, RBAC, run user == profile owner,
              profile state, allowlist, writes the step log
  → runner /browser/*                              (internal, runner token)
  → browser sandbox (Daytona, existing snapshot, no agent shell)
      Chrome over CDP: cookies loaded from the vault, saved back at the end

Web app ⇄ API WebSocket ⇄ runner ⇄ CDP screencast + input   (live view)
```

### Profile lifecycle

`pending_login` → (user logs in through the live view, presses Done; the runner reads cookies over CDP; the API writes the vault secret and bumps the generation) → `ready` → (a run detects a login prompt and the 30-minute wait expires, or the owner chooses "Log in again") → `needs_login` → `ready` after a new login. Deleting a profile archives the row and hard-deletes its vault secret.

### Run lifecycle

1. The first browser tool call of a run reaches the API handler. The handler resolves the profile (D13). If the state is `needs_login`, the call fails with `profile_needs_login` and no sandbox starts (R31).
2. The API asks the runner to start a browser sandbox. The runner creates it with the existing snapshot, starts Chrome (R33), loads the cookies, and installs the allowlist through CDP request interception.
3. Each tool call runs one CDP action and writes one step-log entry with a screenshot.
4. A login prompt, a 2FA prompt, or the user taking control parks the turn on the wait interaction (D12). The browser keeps running for up to 30 minutes. If the user finishes, the turn resumes and reattaches to the same browser.
5. When the turn ends, the runner reads the cookies over CDP and the API saves them under the generation rule (D14). The sandbox stays warm for 5 minutes (R37). A next turn of the same session in that time reattaches to it. Otherwise the runner deletes it. Metering follows the existing rule: time while a turn runs is billed, warm time between turns is not (`services/runner/src/metering/sandbox-usage.ts:16-18`). Agenta pays for warm and waiting time.

### Access rules (v1)

- Use a profile in a run: only when the run's user is the profile owner. For a channel run this means the Slack, Telegram, or WhatsApp sender must be the owner's linked account, or have no linked account while the owner created the agent.
- Watch or take control of a browser session: the profile owner and organization admins (R38).
- Read step logs and screenshots: the profile owner and organization admins (R35).
- Manage profiles: the owner. The `allow_browser` flag: organization admins.

## Risks and unknowns

Each item has a Phase 0 check in [tasks.md](tasks.md). None of them is assumed to pass.

| Risk | Why it matters | Check |
| --- | --- | --- |
| CDP over the Daytona preview proxy | CDP is a WebSocket. The runner reaches the sandbox daemon through the preview proxy today, but no WebSocket traffic has been tested through it. If it fails, a small relay process inside the browser sandbox is needed. | 0.2 |
| WebSockets through the cloud ingress | No API route uses WebSockets today. Ingress idle timeouts can cut a live view. | 0.4 |
| Browser sandbox start time | Each run starts a second sandbox (D2). A slow start delays the first browser step. | 0.1 |
| Images in tool results per harness | Returning a screenshot to the model through a handler-mode tool result is not verified for Pi, Claude, or Codex. `read_page` returns text, so the browser works without it, but `screenshot` does not. | 0.3 |
| Changing egress IPs | Some sites end a session when the IP changes. This decides D3. | 0.5, acceptance |
| Agent sandbox reaching the browser sandbox | D1 depends on the agent having no network path or credential to the browser sandbox. | 0.7 |
| A pending interaction in a scheduled run | R6 and R18 need a scheduled or triggered run to park on `wait_for_user` and be answered later from the session screen. No code path was found that shows this works for trigger-origin sessions. | 0.6 |
| Bot detection on the chosen R14 apps | Google is removed from scope (R32), but other sites can also block automation. | 0.5 with the named apps |

## Estimate

Basis: one engineer who knows the runner and the API, working days, unit tests included, review wait time excluded. Ranges, not points. Re-estimate after Phase 0, because the first two risks above can each add work.

| Phase | Work | Engineer-days |
| --- | --- | --- |
| 0 | Spike (time-boxed) | 4–6 |
| 1 | API domain, migration, RBAC, organization flag, vault link, states, owner-leaves cleanup | 5–7 |
| 2 | Platform ops, API handlers, API→runner client, allowlist check, step log, error envelopes, approval defaults | 5–8 |
| 3 | Runner `/browser/*`: sandbox lifecycle, Chrome launch, CDP actions for the v1 tools, `read_page` with element references, profile load and save, downloads, uploads, CDP allowlist, metering | 10–15 |
| 4 | Wait-for-user interaction, pause and reattach, 30-minute expiry | 4–6 |
| 5 | Live view backend: API WebSocket route, access checks, runner relay, input mapping, control hand-off | 4–6 |
| 6 | Per-user download mount: copy downloads into it, sign it only for the user's runs, and mount it into the agent sandbox; screenshot storage and 30-day deletion job; step log query | 6–9 |
| 7 | Frontend: live view 5–7, Settings tab 2–3, agent config section 2–3, chat dock, watch button, tool rows and screenshots 4–6, session badge 1, Fern client and entity 1–2 | 15–22 |
| 8 | Release-gate scenarios, docs page, and the R15 acceptance run (5 calendar days elapsed) | 4–6 |
| | **Total** | **57–85** |

Not included: plan pricing and limit decisions (Q1), Daytona quota changes, a fixed egress proxy if D3 triggers it, and v2 items (sharing, notifications, self-hosted).

## Open questions

| # | Question | Owner | Blocks |
| --- | --- | --- | --- |
| Q1 | Browser-minute limit per plan (R13). | Product | Phase 6 metering limits, not the build |
| Q2 | The two SaaS apps for R14. | Ashraf | Phase 0 check 0.5 |

## Corrections made during planning

These earlier statements were wrong and are fixed above. They are kept so a reviewer can see what changed.

- "No Xvfb or VNC exists": `sandbox-agent@0.4.2` has a `/v1/desktop/*` API with Xvfb, screenshots, and a WebRTC stream. It is unused, and D9 does not need it.
- "CDP screencast is watch-only": CDP input events allow control too. This made D9 possible.
- "Secrets have no user column": they have audit columns (`created_by_id`) but no owner.
- "The broker lives in the runner and serves tools itself": all harnesses already meet at `/tools/call` (D11).
- "Code goes in `api/ee`": contradicts `api/AGENTS.md` (D4).
- "A one-day spike": Phase 0 has seven checks; 4–6 engineer-days is the honest range.
- Second review against the code: the Pi kill rule was stated too broadly; organization flags are not typed by `OrganizationFlags`; `pay`/`delete` asking depends on the agent-wide permission mode (D17); the per-user download mount needs new runner mounting work (Phase 6 raised to 6–9 days); a paused scheduled run is unverified (new risk); channel-run identity added to the access rules.
