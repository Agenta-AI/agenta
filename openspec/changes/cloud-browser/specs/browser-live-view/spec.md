# Browser live view

## Purpose

Let a user see a cloud browser and control it: to log in to a profile, to finish a login or 2FA during a run, and to watch or correct the agent.

## ADDED Requirements

### Requirement: Live view transport
Agenta SHALL show the live view as a stream of screen frames from the browser, sent over one WebSocket from the API to the web app. The web app SHALL send the user's clicks, taps, scrolls, and key presses over the same WebSocket, and Agenta SHALL apply them to the browser.

#### Scenario: User clicks in the live view
- **WHEN** the user clicks a link in the live view
- **THEN** the browser SHALL click the same point of the page and the live view SHALL show the result

### Requirement: WebSocket security
The live-view WebSocket route SHALL authenticate the user inside the route, SHALL accept a connection only when its `Origin` header is one of the web app's origins, SHALL check that the user may watch the session, and SHALL close the connection when the user's session expires.

#### Scenario: Request from another site
- **WHEN** a page on another origin opens the live-view WebSocket with the user's cookies
- **THEN** Agenta SHALL refuse the connection

#### Scenario: Session expires while watching
- **WHEN** the user's login session expires while the live view is open
- **THEN** Agenta SHALL close the WebSocket

### Requirement: Stream on demand
Agenta SHALL stream frames only while at least one user has the live view open for that browser session.

#### Scenario: Nobody watches
- **WHEN** a scheduled run uses the browser and nobody opens its live view
- **THEN** Agenta SHALL NOT capture or send any frames

### Requirement: Desktop viewport on any screen
The browser SHALL keep a desktop viewport. On a phone, the live view SHALL scale the frame to the screen, let the user zoom, map each tap to the matching point of the desktop page, and open the phone keyboard for typing.

#### Scenario: Typing on a phone
- **WHEN** the user taps a text field in the live view on a phone and types
- **THEN** the phone keyboard SHALL open and the typed text SHALL reach the field

### Requirement: Take control
A user who may control the browser session SHALL be able to take control at any time. While a user has control, handler-mode browser tools SHALL fail with `user_in_control` so that the agent waits through `wait_for_user`. When the user gives control back, the agent's turn SHALL continue with the same page.

#### Scenario: User corrects the agent
- **WHEN** the user takes control during a run, selects the right option on the page, and gives control back
- **THEN** the agent SHALL continue from that page

### Requirement: Who can watch and control
The profile owner and admins SHALL be able to watch and take control of a browser session. An admin is the organization owner, or a member whose role is `owner` or `admin` in the session's project, checked on the member role directly. No other user SHALL be able to open the live view, even if they can open the session.

#### Scenario: Project admin opens a member's run
- **WHEN** a member with the `admin` role in the project opens another member's running session and chooses "Watch browser"
- **THEN** the admin SHALL see the live view and SHALL be able to take control

#### Scenario: Editor on a plan without RBAC
- **WHEN** a member with the `editor` role, in an organization whose plan has no RBAC, opens another member's running session
- **THEN** Agenta SHALL NOT show "Watch browser" and the API SHALL refuse the live-view WebSocket

### Requirement: Owner sees who watched
Agenta SHALL record, for the profile owner, each time a user opened the live view of one of the owner's browser sessions and each time a user took and gave back control, with the user and the times.

#### Scenario: Admin took control
- **WHEN** an admin took control of the owner's browser session for 3 minutes
- **THEN** the owner SHALL see an entry with the admin's name and the start and end times

### Requirement: Login sessions
A live-view login session for a profile SHALL apply the profile's allowlist, except that it SHALL follow redirects that start on an allowlisted site. Agenta SHALL propose the hosts in those redirect chains as sign-in hosts and SHALL save only the hosts the owner confirms. A login session SHALL end after 30 minutes, and a user SHALL have at most one login session open at a time.

#### Scenario: SSO during login
- **WHEN** the owner logs in to `app.example.com`, which redirects to `example.okta.com` and back
- **THEN** Agenta SHALL propose `example.okta.com` as a sign-in host and SHALL save it only after the owner confirms it

#### Scenario: Owner browses elsewhere
- **WHEN** the owner types `https://news.example.net` into the login session's address bar and that host is not on the allowlist
- **THEN** the navigation SHALL be blocked

### Requirement: Watch any running session
A user who may watch SHALL be able to open the live view of a running browser session from the session screen, including a scheduled or triggered run. The session list SHALL mark sessions whose browser is running or waiting for the user.

#### Scenario: Run waiting for a login
- **WHEN** a scheduled run is waiting on `wait_for_user`
- **THEN** the session list SHALL show the session as waiting for the user, and opening it SHALL offer the live view

### Requirement: Wait card in chat
When a run waits on `wait_for_user`, the chat SHALL show a dock card with the agent's reason and message that opens the live view.

#### Scenario: 2FA during chat
- **WHEN** the agent calls `wait_for_user` with reason `two_factor` on `portal.example.org`
- **THEN** the chat SHALL show a card for `portal.example.org` that opens the live view
