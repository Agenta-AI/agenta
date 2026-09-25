# Session link delta

## Purpose

Let an agent give people a private link that opens its session in the default app.

## ADDED Requirements

### Requirement: The link opens the session in the default app
The URL returned by `get_current_session` SHALL point to the session's page in `/m`: `<web URL>/m/w/<workspace>/p/<project>/sessions/<session>`, with `?agent=<agent>` when the session has an agent reference. A session with no agent reference SHALL still get a URL. The response SHALL give no URL, and SHALL give a reason, only when the web URL or the workspace is unavailable.

#### Scenario: Default app
- **WHEN** a project member with no Classic-mode preference opens the link on a desktop browser
- **THEN** the session SHALL open in `/m`.

#### Scenario: Classic mode
- **WHEN** a project member with Classic mode on opens the link
- **THEN** the session SHALL open as a tab of the agent's classic playground.

#### Scenario: Channel agent bound by application reference
- **WHEN** a Slack agent bound by an application reference calls `get_current_session`
- **THEN** the response SHALL contain a URL to the `/m` session page without `?agent=`, and opening it SHALL show the session.

#### Scenario: No web URL configured
- **WHEN** a self-hosted install has no valid web URL
- **THEN** the response SHALL contain `url_unavailable_reason` `web_url_unavailable` and no URL, and the agent SHALL say that no link is available.

### Requirement: The link stays private
The link SHALL open only for signed-in members of the session's project who can view sessions. This tool SHALL NOT make a session readable to anyone else.

#### Scenario: Signed-out colleague
- **WHEN** a Slack colleague who is not signed in to Agenta opens the link
- **THEN** Agenta SHALL show the sign-in page and SHALL NOT show the session.

#### Scenario: Member signs in from the link
- **WHEN** a signed-out project member opens the link and signs in
- **THEN** Agenta SHALL show the session.

#### Scenario: Non-member
- **WHEN** a signed-in person who is not a member of the project opens the link
- **THEN** Agenta SHALL NOT show the session.

### Requirement: The agent shares the link when it helps
The `get_current_session` description SHALL tell the agent to share the link when a person asks for it, and when it ends a long piece of work in a chat app or an automation whose detail does not fit in the reply. It SHALL tell the agent to share the link only with people who can open it and to say that the link opens in Agenta for people with access.

#### Scenario: Asked in the playground
- **WHEN** a person in the playground asks "give me a link to this chat"
- **THEN** the agent SHALL call `get_current_session` and reply with the returned URL, copied exactly.

#### Scenario: Long task in Slack
- **WHEN** an agent in a Slack thread finishes a long research task whose full result does not fit in the reply
- **THEN** the agent MAY end its reply with a short summary and the session link.

#### Scenario: Short answer
- **WHEN** an agent answers a short question in Slack
- **THEN** the agent SHALL NOT add the session link unless asked.
