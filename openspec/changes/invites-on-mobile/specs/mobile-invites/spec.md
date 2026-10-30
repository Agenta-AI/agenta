## ADDED Requirements

### Requirement: Invite link opens /m
The API SHALL build the emailed invite link as `<web_url>/m/auth` with the same five query values as today.

#### Scenario: Invite email is sent
- **WHEN** an owner invites a person
- **THEN** the link is `<web_url>/m/auth?token&email&organization_id&workspace_id&project_id`

### Requirement: Invite survives sign-in
The `/m` sign-in SHALL keep an invite that has a token and an organization id for 30 minutes in browser storage, through every sign-in method.

#### Scenario: Password or one-time code
- **WHEN** a person opens the link and signs in by password or one-time code
- **THEN** `/m` opens the accept screen with the invite values

#### Scenario: Social or SSO
- **WHEN** a person opens the link and signs in through a provider redirect
- **THEN** `/m` opens the accept screen with the invite values after the callback

#### Scenario: Email without a token
- **WHEN** a person opens `/m/auth?email=a@b.c`
- **THEN** `/m` keeps no invite and fills in the email as it does today

#### Scenario: Window passed
- **WHEN** a person finishes sign-in more than 30 minutes after opening the link
- **THEN** `/m` ignores the kept invite and opens the project home

### Requirement: Accept screen outcomes
The `/m/invite` screen SHALL accept the kept invite once and show the outcomes of the old accept page.

#### Scenario: Accepted
- **WHEN** the API accepts the invite
- **THEN** `/m` shows "You joined a new workspace!", clears the invite, refreshes organizations and projects, and opens the invited project

#### Scenario: Already accepted
- **WHEN** the API answers `INVITE_ALREADY_ACCEPTED`
- **THEN** `/m` shows "You already joined this workspace.", clears the invite, and opens the invited project

#### Scenario: Different email
- **WHEN** a signed-in person with another email opens the link and the API answers `INVITE_EMAIL_MISMATCH`
- **THEN** `/m` shows "This invitation is not for you. Sign in with the invited account to accept it." with "Go back to your workspaces" and "Sign in with a different account"

#### Scenario: Different email, invited email has no account
- **WHEN** a signed-in person opens a link for an email that has no account
- **THEN** `/m` shows the same message as for a different email

#### Scenario: Signed-in visit
- **WHEN** a signed-in person with the invited email opens the link
- **THEN** `/m` accepts the invite and opens the invited project, every time

#### Scenario: Switch account
- **WHEN** the person picks "Sign in with a different account" and then signs in with the invited email
- **THEN** `/m` accepts the invite without a new click on the email link

#### Scenario: Go back
- **WHEN** the person picks "Go back to your workspaces"
- **THEN** `/m` clears the invite and opens the root resolver

#### Scenario: Expired or not valid
- **WHEN** the API answers `INVITE_EXPIRED` or `INVITE_NOT_FOUND`
- **THEN** `/m` shows the old page's message for that code on the same card and clears the invite

#### Scenario: Other failure
- **WHEN** the request fails with no known code
- **THEN** `/m` shows the old page's fallback message with a retry control, and keeps the invite

### Requirement: Onboarding for a new invited person
A new account that accepts an invite SHALL answer the onboarding questions only and then open the invited project.

#### Scenario: New person, project has agents
- **WHEN** a new account accepts an invite to a project with agents
- **THEN** `/m` shows the questions, sends `survey sent` after the last one, and opens the project home

#### Scenario: New person, empty project
- **WHEN** a new account accepts an invite to a project with no agents
- **THEN** `/m` shows the same questions and does not show the credits or first agent steps

#### Scenario: Existing person
- **WHEN** an existing account accepts an invite
- **THEN** `/m` shows no questions and opens the invited project

### Requirement: Gates keep invites on /m
The gates SHALL send an invite link to `/m` with its query and SHALL leave password reset links where they work today.

#### Scenario: Old link in an inbox
- **WHEN** anyone opens `/auth?token=t&organization_id=o&...`, including an opted out or Classic mode person
- **THEN** the desktop gate redirects to `/m/auth?token=t&organization_id=o&...`

#### Scenario: Password reset
- **WHEN** anyone opens `/auth/reset-password?token=t&tenantId=public`
- **THEN** the desktop gate passes as it does today

#### Scenario: Classic mode on /m
- **WHEN** a Classic mode person opens `/m/auth` with an invite, or `/m/invite`
- **THEN** the mobile gate passes

### Requirement: Invite link when email is off
The `/m` Members settings SHALL show the invite link the API returns when the deployment has no email service.

#### Scenario: Email is off
- **WHEN** an owner sends an invitation on a deployment with no email service
- **THEN** `/m` shows a dialog with the email, the link, and a Copy button

#### Scenario: Email is on
- **WHEN** an owner sends an invitation and the API returns no link
- **THEN** `/m` closes the invite dialog and shows no link dialog
