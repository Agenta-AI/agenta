# Browser live view

## Purpose

Let a user see a cloud browser and control it: to log in to a profile, to finish a login or 2FA during a run, and to watch or correct the agent.

## ADDED Requirements

### Requirement: Live view transport
Agenta SHALL show the live view as a stream of screen frames from the browser, sent over one WebSocket from the API to the web app. The web app SHALL send the user's clicks, taps, scrolls, and key presses over the same WebSocket, and Agenta SHALL apply them to the browser.

#### Scenario: User clicks in the live view
- **WHEN** the user clicks a link in the live view
- **THEN** the browser SHALL click the same point of the page and the live view SHALL show the result

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
A user who may control the browser session SHALL be able to take control at any time. While a user has control, the agent's turn SHALL wait. When the user gives control back, the agent's turn SHALL continue with the same page.

#### Scenario: User corrects the agent
- **WHEN** the user takes control during a run, selects the right option on the page, and gives control back
- **THEN** the agent SHALL continue from that page

### Requirement: Who can watch and control
The profile owner and organization admins SHALL be able to watch and take control of a browser session. No other user SHALL be able to open the live view, even if they can open the session.

#### Scenario: Admin opens a member's run
- **WHEN** an organization admin opens a member's running session and chooses "Watch browser"
- **THEN** the admin SHALL see the live view and SHALL be able to take control

#### Scenario: Other member opens the session
- **WHEN** a member who is neither the profile owner nor an organization admin opens the session
- **THEN** Agenta SHALL NOT show "Watch browser" and the API SHALL refuse the live view WebSocket

### Requirement: Watch any running session
A user who may watch SHALL be able to open the live view of a running browser session from the session screen, including a scheduled or triggered run. The session list SHALL mark sessions whose browser is running or waiting for the user.

#### Scenario: Run waiting for a login
- **WHEN** a scheduled run is waiting for a login
- **THEN** the session list SHALL show the session as waiting for the user, and opening it SHALL offer the live view

### Requirement: Login dock card in chat
When a run waits for the user, the chat SHALL show a dock card that names the site and opens the live view.

#### Scenario: 2FA during chat
- **WHEN** the agent calls `wait_for_user` for a 2FA code on `portal.example.org`
- **THEN** the chat SHALL show a card "Log in to portal.example.org" that opens the live view
