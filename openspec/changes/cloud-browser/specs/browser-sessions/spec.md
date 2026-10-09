# Browser sessions

## Purpose

Give one agent run a cloud browser that is already logged in with the run's profile, keep the session state safe from the agent, and record what the browser did.

## ADDED Requirements

### Requirement: Separate browser sandbox
Agenta SHALL run the browser for a run in its own Daytona sandbox, separate from the agent's sandbox. The agent SHALL have no shell, file access, network path, or credential to the browser sandbox, and SHALL reach the browser only through the browser tools.

#### Scenario: Agent tries to read cookies
- **WHEN** an agent, through its shell, tries to read cookie files or connect to the browser's debugging port
- **THEN** the attempt SHALL fail because those files and that port exist only in the browser sandbox

### Requirement: Start on first use
Agenta SHALL start a browser sandbox for a run on the run's first browser tool call, and SHALL NOT start one for a run that makes no browser tool call.

#### Scenario: Run without browser use
- **WHEN** an agent with a profile attached completes a turn without calling a browser tool
- **THEN** Agenta SHALL NOT start a browser sandbox

### Requirement: Use by the owner only
Agenta SHALL use a profile in a run only when the run's user is the profile owner. For a scheduled or triggered run, the run's user is the user who created the schedule or trigger.

#### Scenario: Owner's scheduled run
- **WHEN** a schedule created by the profile owner runs an agent that names the owner's profile
- **THEN** the browser SHALL start with that profile's session state

#### Scenario: Another user's run
- **WHEN** a run whose user is not the profile owner calls a browser tool
- **THEN** the call SHALL fail with `profile_not_available` and no browser sandbox SHALL start

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
During a run, the browser SHALL load a top-level page only from a host on the profile's allowlist or on the profile's sign-in host list. Agenta SHALL build the sign-in host list from the hosts the owner's browser passes through during a live-view login, and SHALL show that list to the owner. Agenta SHALL enforce the rule in the browser sandbox through CDP. v1 SHALL support only sites on the public internet.

#### Scenario: Navigation to an allowed site
- **WHEN** the agent navigates to `https://app.example.com/reports` and `app.example.com` is on the allowlist
- **THEN** the page SHALL load

#### Scenario: Single sign-on redirect
- **WHEN** an allowed site redirects to `login.okta.com` and that host was recorded during the owner's login
- **THEN** the page SHALL load

#### Scenario: Navigation to another site
- **WHEN** the agent or a link in a page navigates to a host that is not on the allowlist
- **THEN** the navigation SHALL be blocked and the tool call SHALL fail with `site_not_allowed`

### Requirement: Wait for the user
When the agent calls `wait_for_user` because a page asks for a login or a 2FA code, or when a user takes control in the live view, Agenta SHALL pause the turn and keep the browser sandbox running for up to 30 minutes. When the user finishes and gives control back, the turn SHALL resume with the same browser and page. If 30 minutes pass first, the run SHALL fail and the profile SHALL change to `needs_login`.

#### Scenario: Owner completes 2FA in time
- **WHEN** a site asks for a 2FA code, the agent calls `wait_for_user`, and the owner enters the code in the live view within 30 minutes
- **THEN** the turn SHALL resume with the same browser page

#### Scenario: Nobody answers
- **WHEN** a run waits for a login for 30 minutes and nobody completes it
- **THEN** the run SHALL fail, the browser sandbox SHALL be deleted, and the profile SHALL change to `needs_login`

### Requirement: Warm browser between turns
After a turn ends with no pending wait, Agenta SHALL keep the browser sandbox running for 5 minutes. A next turn of the same session in that time SHALL reuse the same browser and page. After 5 minutes Agenta SHALL delete the sandbox.

#### Scenario: Quick follow-up in chat
- **WHEN** the user sends a follow-up message 2 minutes after the agent's last browser turn
- **THEN** the agent's next browser tool call SHALL act on the same open page

#### Scenario: Late follow-up
- **WHEN** the user sends a follow-up message 10 minutes after the last browser turn
- **THEN** the next browser tool call SHALL start a new browser sandbox with the profile's latest saved session state

### Requirement: Save the session state
When a turn that used the browser ends, Agenta SHALL read the browser session state and save it to the profile, but only when the profile generation is still the generation the browser loaded. Among saves of the same generation, the last save SHALL win. Several runs SHALL be able to use one profile at the same time.

#### Scenario: Two parallel runs
- **WHEN** two runs use the same profile at the same time and both end
- **THEN** the session state of the run that ended last SHALL be the stored state

#### Scenario: Owner logged in again during a run
- **WHEN** a run loaded generation 4, the owner logged in again (generation 5), and then the run ends
- **THEN** Agenta SHALL NOT save the run's session state, and the stored state SHALL stay at generation 5

### Requirement: Downloads
Agenta SHALL store each file the browser downloads in a mount that belongs to the agent and the run's user. Agenta SHALL sign that mount only for runs of that user.

#### Scenario: Agent downloads a report
- **WHEN** the agent downloads `report.pdf` in the owner's run
- **THEN** the file SHALL be stored in the owner's download mount for that agent and SHALL be readable in the owner's later runs of that agent

#### Scenario: Another user's run of the same agent
- **WHEN** another member runs the same agent
- **THEN** that run SHALL NOT be able to read the owner's download mount

### Requirement: Uploads
The agent SHALL be able to upload to a page only files that are already in the run's session files.

#### Scenario: Upload a session file
- **WHEN** the agent asks to upload `invoice.pdf` from the session files to a file input
- **THEN** the browser SHALL attach that file

#### Scenario: Upload from elsewhere
- **WHEN** the agent asks to upload a path that is not in the session files
- **THEN** the tool call SHALL fail with `file_not_in_session`

### Requirement: Step log
Agenta SHALL record one step-log entry for every browser tool call, with the time, the site, the action, its result, and a screenshot taken after the action. Agenta SHALL delete screenshots 30 days after they were taken. The profile owner and organization admins SHALL be able to read the step log and the screenshots.

#### Scenario: Owner reviews a scheduled run
- **WHEN** the owner opens a finished scheduled run
- **THEN** Agenta SHALL show each browser step with its screenshot

#### Scenario: Screenshot older than 30 days
- **WHEN** a screenshot is 30 days old
- **THEN** Agenta SHALL delete it and keep the rest of the step-log entry

### Requirement: Metering
Agenta SHALL report browser sandbox time to the existing sandbox metering, under the same rules as agent sandbox time, and SHALL apply the plan's limit for it.

#### Scenario: Wallet metering on
- **WHEN** wallet metering is enabled and a browser sandbox runs during a turn
- **THEN** the runner SHALL report that time as sandbox time for the run's payer
