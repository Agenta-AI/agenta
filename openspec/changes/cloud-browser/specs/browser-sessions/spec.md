# Browser sessions

## Purpose

Give an agent session a cloud browser that is already logged in with the owner's profile, keep the session state safe from the agent, and record what the browser did.

## ADDED Requirements

### Requirement: Separate browser sandbox
Agenta SHALL run the browser for an agent session in its own Daytona sandbox, separate from the agent's sandbox. The agent SHALL have no shell, file access, network path, or credential to the browser sandbox, and SHALL reach the browser only through the browser tools. Chrome's debugging port SHALL accept connections only from the runner.

#### Scenario: Agent tries to read cookies
- **WHEN** an agent, through its shell, tries to read cookie files or connect to the browser's debugging port
- **THEN** the attempt SHALL fail because those files and that port exist only in the browser sandbox

### Requirement: Start on first use
Agenta SHALL start a browser sandbox for an agent session on the session's first browser tool call, and SHALL NOT start one for a session that makes no browser tool call. Each session SHALL have its own browser sandbox.

#### Scenario: Run without browser use
- **WHEN** an agent with a profile attached completes a turn without calling a browser tool
- **THEN** Agenta SHALL NOT start a browser sandbox

### Requirement: Who may use the profile
Agenta SHALL use a profile in a run only when all of these hold: the run's user is the profile owner; the author of the agent revision the run uses is the profile owner; and, for a channel run, the message sender is a linked Agenta account. For a scheduled or triggered run, the run's user is the user who created the schedule or trigger. Otherwise every browser tool call SHALL fail with `profile_not_available` and no browser sandbox SHALL start. A channel run SHALL carry a marker that says whether its identity is a linked sender or a fallback, and the browser tools SHALL read that marker from run context.

#### Scenario: Owner's scheduled run
- **WHEN** a schedule created by the profile owner runs an agent revision the owner committed
- **THEN** the browser SHALL start with that profile's session state

#### Scenario: Another user's run
- **WHEN** a run whose user is not the profile owner calls a browser tool
- **THEN** the call SHALL fail with `profile_not_available`

#### Scenario: Another editor changed the agent
- **WHEN** another member commits a new revision of an agent that names the owner's profile, and a run uses that revision
- **THEN** browser tool calls SHALL fail with `profile_not_available` until the owner commits a revision

#### Scenario: Unlinked channel sender
- **WHEN** a Slack sender with no linked Agenta account messages an agent created by the profile owner
- **THEN** browser tool calls in that run SHALL fail with `profile_not_available`

### Requirement: Fail fast on a stale login
When the run's profile is in the `needs_login` state, the first browser tool call SHALL fail with `profile_needs_login`, and Agenta SHALL NOT start a browser sandbox.

#### Scenario: Profile needs login at start
- **WHEN** a scheduled run starts and its profile is `needs_login`
- **THEN** the first browser tool call SHALL fail with `profile_needs_login` and no browser sandbox SHALL start

### Requirement: Browser start settings
Agenta SHALL start Chrome without automation flags, so that `navigator.webdriver` is `false`, with a desktop viewport, a desktop user agent, and a timezone and locale that match each other.

#### Scenario: Page reads the automation flag
- **WHEN** a page in the browser reads `navigator.webdriver`
- **THEN** the value SHALL be `false`

### Requirement: Allowlist
During a run, the browser SHALL load a document in any target (page, iframe, popup, or worker) and SHALL download a file only from a host on the profile's allowlist or on the profile's confirmed sign-in host list. Agenta SHALL refuse IP literals, `localhost`, and hosts that resolve to private, link-local, or loopback addresses. Agenta SHALL enforce the allowlist through CDP. Every browser connection, including HTTPS and WebSocket connections, SHALL go through a proxy inside the browser sandbox that resolves the host once, refuses private, link-local, and loopback addresses, and connects to the address it checked. WebRTC SHALL NOT send UDP outside the proxy. v1 SHALL support only sites on the public internet.

#### Scenario: Navigation to an allowed site
- **WHEN** the agent navigates to `https://app.example.com/reports` and `app.example.com` is on the allowlist
- **THEN** the page SHALL load

#### Scenario: Single sign-on redirect
- **WHEN** an allowed site redirects to `login.okta.com` and the owner confirmed that host
- **THEN** the page SHALL load

#### Scenario: Navigation to another site
- **WHEN** the agent or a link in a page navigates to a host that is not on either list
- **THEN** the navigation SHALL be blocked and the tool call SHALL fail with `site_not_allowed`

#### Scenario: Iframe or popup on another host
- **WHEN** an allowed page opens an iframe or a popup on a host that is not on either list
- **THEN** Agenta SHALL block that document

#### Scenario: Name that changes its address
- **WHEN** a host name on the allowlist resolves to a public address at one moment and to a private address at the next
- **THEN** the proxy SHALL connect only to the address it checked, and SHALL refuse the connection when that address is private

#### Scenario: Internal address
- **WHEN** a navigation targets `http://169.254.169.254/` or a public host name that resolves to a private address
- **THEN** Agenta SHALL block it and the tool call SHALL fail with `site_not_allowed`

### Requirement: Wait for the user
When the agent calls `wait_for_user`, Agenta SHALL pause the turn and keep the browser sandbox running for up to 30 minutes. Only the profile owner SHALL be able to answer the wait. When the user finishes, the turn SHALL resume with the same browser and page. If 30 minutes pass first, the run SHALL fail. The profile SHALL change to `needs_login` only when the run proved the session is logged out: a navigation to an allowlisted site landed on a confirmed sign-in host, the op failed with `login_required`, and the wait that followed timed out.

#### Scenario: Owner completes 2FA in time
- **WHEN** a site asks for a 2FA code, the agent calls `wait_for_user`, and the owner enters the code in the live view within 30 minutes
- **THEN** the turn SHALL resume with the same browser page

#### Scenario: Proven logout and nobody answers
- **WHEN** a navigation lands on a confirmed sign-in host, the op fails with `login_required`, the agent calls `wait_for_user`, and nobody logs in for 30 minutes
- **THEN** the run SHALL fail, the browser sandbox SHALL be deleted, and the profile SHALL change to `needs_login`

#### Scenario: Another member answers the wait
- **WHEN** another project member answers the owner's pending `wait_for_user`
- **THEN** Agenta SHALL refuse the answer and the turn SHALL stay paused

#### Scenario: Other wait times out
- **WHEN** the agent calls `wait_for_user` for a CAPTCHA and nobody answers for 30 minutes
- **THEN** the run SHALL fail and the profile state SHALL NOT change

### Requirement: Warm browser between turns
After a turn ends with no pending wait, Agenta SHALL keep the browser sandbox running for 5 minutes. A next turn of the same session in that time SHALL reuse the same browser and page. After 5 minutes Agenta SHALL delete the sandbox.

#### Scenario: Quick follow-up in chat
- **WHEN** the user sends a follow-up message 2 minutes after the agent's last browser turn
- **THEN** the agent's next browser tool call SHALL act on the same open page

#### Scenario: Late follow-up
- **WHEN** the user sends a follow-up message 10 minutes after the last browser turn
- **THEN** the next browser tool call SHALL start a new browser sandbox with the profile's latest saved session state

### Requirement: One owning runner
The browser sandbox SHALL belong to the runner replica that owns the agent session. Agenta SHALL route every browser tool call, save, and live-view connection by session ID to that replica.

#### Scenario: Call arrives at another replica
- **WHEN** a browser tool call for a session reaches a runner replica that does not own the session's browser sandbox
- **THEN** the call SHALL be served by the owning replica, on the same page

### Requirement: Save the session state
When a turn that used the browser ends, the runner SHALL send the browser session state to the API, and the API SHALL save it only when the profile is not archived and its generation is still the generation the browser loaded. Among saves of the same generation, the last save SHALL win. Several sessions SHALL be able to use one profile at the same time.

#### Scenario: Two parallel runs
- **WHEN** two runs in different sessions use the same profile at the same time and both end
- **THEN** the session state of the run that ended last SHALL be the stored state

#### Scenario: Owner logged in again during a run
- **WHEN** a run loaded generation 4, the owner logged in again (generation 5), and then the run ends
- **THEN** Agenta SHALL NOT save the run's session state, and the stored state SHALL stay at generation 5

#### Scenario: Profile deleted during a run
- **WHEN** the owner deletes the profile while a run uses it
- **THEN** Agenta SHALL stop the run's browser sandbox and SHALL NOT save any session state

### Requirement: Downloads
Agenta SHALL store each file the browser downloads with the profile, readable only by the profile owner. The agent SHALL copy a download into the session files only with `read_download`.

#### Scenario: Agent downloads a report
- **WHEN** the agent downloads `report.pdf` in the owner's run and then calls `read_download` for it
- **THEN** the file SHALL be stored with the profile and a copy SHALL appear in the session files

#### Scenario: Another member looks for the file
- **WHEN** another member of the project lists the profile's downloads through the API
- **THEN** Agenta SHALL refuse the request

### Requirement: Uploads
The agent SHALL be able to upload to a page only files that are already in the session files.

#### Scenario: Upload a session file
- **WHEN** the agent asks to upload `invoice.pdf` from the session files to a file input
- **THEN** the browser SHALL attach that file

#### Scenario: Upload from elsewhere
- **WHEN** the agent asks to upload a path that is not in the session files
- **THEN** the tool call SHALL fail with `file_not_in_session`

### Requirement: Step log
Agenta SHALL record one step-log entry for every browser tool call, with the time, the site, the action, its result, and a screenshot taken after the action. Agenta SHALL delete screenshots 30 days after they were taken. Only the profile owner and admins (the organization owner, or a member with the `owner` or `admin` role in the session's project, checked on the member role directly) SHALL be able to read the step log and the screenshots.

#### Scenario: Owner reviews a scheduled run
- **WHEN** the owner opens a finished scheduled run
- **THEN** Agenta SHALL show each browser step with its screenshot

#### Scenario: Screenshot older than 30 days
- **WHEN** a screenshot is 30 days old
- **THEN** Agenta SHALL delete it and keep the rest of the step-log entry

#### Scenario: Editor on a plan without RBAC
- **WHEN** a member with the `editor` role, in an organization whose plan has no RBAC, asks for the step log of another member's run
- **THEN** Agenta SHALL refuse the request

### Requirement: Redaction
Agenta SHALL store `"[redacted]"` in place of any value the agent types into a password field, in the step log, in the session transcript, and in traces. Page text the agent reads SHALL stay in the session transcript, visible to members who can open the session.

#### Scenario: Agent fills a password field
- **WHEN** the agent calls `form_input` on a password field
- **THEN** the step log, transcript, and trace SHALL show `"[redacted]"` instead of the value

### Requirement: Metering and limits
Agenta SHALL meter every second a browser sandbox runs, including turns, warm time, waits, and live-view login sessions, as sandbox time for the profile owner's payer. Agenta SHALL refuse to start a browser sandbox when the payer's plan limit for browser time is reached.

#### Scenario: Wallet metering on
- **WHEN** wallet metering is enabled and a browser sandbox runs for 4 minutes of a turn and 5 minutes warm
- **THEN** the runner SHALL report 9 minutes of sandbox time for the profile owner's payer

#### Scenario: Limit reached
- **WHEN** the payer has reached the plan's browser-time limit and an agent calls a browser tool
- **THEN** the call SHALL fail with `browser_limit_reached` and no browser sandbox SHALL start
