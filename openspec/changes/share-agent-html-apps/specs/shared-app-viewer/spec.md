# Shared app viewer delta

## Purpose

Define who can open an app share link, what the share page shows each kind of viewer, and how a shared app is kept away from the network and from Agenta credentials.

## ADDED Requirements

### Requirement: Link access rules
A share link SHALL open for anyone when the share visibility is `link`. When the visibility is `workspace`, the link SHALL open only for a signed-in user who is a member of the app's workspace and who passes the organization's sign-in policy. A signed-out viewer of a `workspace` share SHALL be asked to sign in and SHALL return to the link after sign-in, with any sign-in method, including an OAuth or SSO provider. Access SHALL be decided once for each view, and a share SHALL load in one request.

#### Scenario: Anyone with the link
- **WHEN** a person who is not signed in opens a `link` share
- **THEN** the app SHALL render.

#### Scenario: Signed-out viewer of a workspace share
- **WHEN** a person who is not signed in opens a `workspace` share
- **THEN** the page SHALL ask them to sign in, and after sign-in SHALL return to the same link.

#### Scenario: Sign-in through a provider
- **WHEN** a signed-out viewer of a `workspace` share signs in with Google or with SSO
- **THEN** the viewer SHALL land on the same share link after the provider returns.

#### Scenario: Member of another workspace
- **WHEN** a signed-in user who is not a member of the app's workspace opens a `workspace` share
- **THEN** the page SHALL show that they have no access, and no app file SHALL be returned.

#### Scenario: Organization policy
- **WHEN** the organization requires SSO and a member signed in with email and password opens a `workspace` share
- **THEN** access SHALL be refused with the same policy error the rest of the product returns.

### Requirement: Failed links reveal nothing
A link with a bad signature, a stopped share, an old link after share again, or a deleted session SHALL fail as not found. A link to an archived session SHALL fail as unavailable. When the deployment still uses the default encryption key, share links SHALL NOT be issued or accepted.

#### Scenario: Tampered link
- **WHEN** a person changes one character of a share token
- **THEN** the link SHALL fail as not found.

#### Scenario: Default key
- **WHEN** a self-hosted deployment has not set its encryption key
- **THEN** the Share action SHALL report that sharing is not available, and no link SHALL work.

### Requirement: The share page and its header
The share page SHALL be at `/m/share/<token>`. It SHALL NOT redirect to sign-in for `link` shares, SHALL NOT redirect to the classic desktop app, and SHALL NOT send page views to product analytics. Its header SHALL sit outside the app and SHALL show:
- for everyone: the Agenta logo, the app name, and "App by <owner name>";
- for a signed-out viewer: a Sign in button;
- for a signed-in viewer: their avatar, and "Open in session" when they are a member of the app's project;
- for a viewer with `EDIT_MOUNTS` on the project: a Share button that opens the owner's share dialog, with "App by you" when they are the owner.

#### Scenario: Classic mode user
- **WHEN** a user whose classic-mode preference is on opens a share link
- **THEN** the share page SHALL render and SHALL NOT redirect.

#### Scenario: Workspace member outside the project
- **WHEN** a workspace member who is not in the app's project opens a `workspace` share
- **THEN** the header SHALL NOT show "Open in session".

### Requirement: Shared apps run with no network and no Agenta access
A shared app SHALL run in a sandboxed frame that cannot read Agenta cookies or storage, open popups, show dialogs, navigate the top page, or submit forms. It SHALL load only inline code and files from its snapshot. Captured scripts and stylesheets SHALL be inlined as code, and captured images and fonts as data, so that the policy allows no source other than the document itself. Any request to another address, including a URL that was captured at publish time, SHALL be blocked. Writes through the app file bridge SHALL fail with `read_only`.

#### Scenario: App sends typed data
- **WHEN** a shared app tries to send what a viewer typed to an outside address with fetch, an image request, a form, or a popup
- **THEN** the request SHALL be blocked.

#### Scenario: App saves data
- **WHEN** a shared app writes to a file through `window.agenta.fs`
- **THEN** the write SHALL fail with `read_only`, and the owner's drive SHALL NOT change.

### Requirement: Snapshot files never run on the Agenta origin
No snapshot file SHALL have its own URL on the Agenta origin. The share route SHALL return a share's files as data inside one JSON response that the browser does not render as a page. Responses SHALL NOT be cached, so that stopping a share takes effect on the next request.

#### Scenario: Direct URL to the share route
- **WHEN** a person opens the share route URL of a share that holds an HTML file in a browser tab
- **THEN** the browser SHALL show inert JSON, and no script in the snapshot SHALL run.
