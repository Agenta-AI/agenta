# Agent app sharing delta

## Purpose

Let the owner of an agent-made HTML app in a session drive publish it as a read-only share link, update it, and control or stop that link.

## ADDED Requirements

### Requirement: Only session-drive apps can be shared
A share SHALL be created only for an app folder in a session's working drive. The folder SHALL contain a valid `app.json` and SHALL NOT be the drive root. The session SHALL exist and SHALL NOT be archived. An app in an agent drive or in a standalone drive SHALL be refused.

#### Scenario: App in a session drive
- **WHEN** an editor shares `apps/board`, a valid app folder in the working drive of a live session
- **THEN** the share SHALL be created and a link SHALL be returned.

#### Scenario: App in the agent drive
- **WHEN** an editor tries to share an app folder in an agent drive
- **THEN** the request SHALL be refused and no share SHALL be created.

#### Scenario: Folder without a manifest
- **WHEN** an editor tries to share a folder with no valid `app.json`
- **THEN** the request SHALL be refused.

### Requirement: Only people in an interactive session can change a share
Creating, updating, restoring, changing, or stopping a share SHALL require the `EDIT_MOUNTS` permission on the project and an interactive sign-in session. A request made with an API key or with the agent's tool credential SHALL be refused, even when that credential carries `EDIT_MOUNTS`. Reading the share state of an app SHALL require `VIEW_MOUNTS`.

#### Scenario: Editor in the browser
- **WHEN** a signed-in user with the editor role clicks Share
- **THEN** the share SHALL be created.

#### Scenario: Agent credential
- **WHEN** a request to create a share carries the agent's tool credential for the same user
- **THEN** the request SHALL be refused and no share SHALL be created.

#### Scenario: Viewer role
- **WHEN** a signed-in user with the viewer role tries to create a share
- **THEN** the request SHALL be refused.

### Requirement: A share serves a frozen snapshot
Publishing SHALL copy every file in the app folder, including data files and subfolders, into a snapshot. A subfolder that has its own `app.json` SHALL be left out. Later changes to the drive SHALL NOT change what the link shows. One budget SHALL cover the snapshot, captured external files included: at most 200 files, 5 MB for each file, and 25 MB in total. A publish whose own app files exceed the budget SHALL be refused.

#### Scenario: Agent edits the app after sharing
- **WHEN** the agent changes `apps/board/index.html` after the owner shared it
- **THEN** the link SHALL keep showing the published snapshot.

#### Scenario: Snapshot over the limit
- **WHEN** an app folder holds 30 MB of files
- **THEN** publishing SHALL be refused with an error that names the limit, and the live snapshot SHALL NOT change.

### Requirement: External files are captured at publish time
Publishing SHALL follow each `https:` script, stylesheet, image, and font that the app's HTML or CSS references, and each `url()` and `@import` inside a captured stylesheet, resolved against that stylesheet's own URL, to a depth of 3. It SHALL store what it downloads in the snapshot, at most 30 URLs in total, inside the snapshot budget. A URL that resolves to a private or internal address SHALL NOT be fetched. A redirect SHALL be followed up to 3 hops, and each hop SHALL be checked as a new URL. A URL that cannot be downloaded, or that does not fit the budget, SHALL be reported to the owner and SHALL NOT stop the publish. A module script that imports other URLs SHALL be reported to the owner as a warning, because its imports are not captured.

#### Scenario: App uses a CDN library
- **WHEN** an app loads a chart library from a public CDN over `https:`
- **THEN** the library SHALL be stored in the snapshot, and the shared app SHALL work with no network.

#### Scenario: App uses a web font service
- **WHEN** an app links a Google Fonts stylesheet
- **THEN** the stylesheet and the font files it references SHALL be stored in the snapshot, and the shared app SHALL show the fonts with no network.

#### Scenario: Stylesheet with relative assets
- **WHEN** a captured CDN stylesheet references `url(fonts/icons.woff2)`
- **THEN** the font SHALL be fetched from the address relative to the stylesheet's URL and stored in the snapshot.

#### Scenario: Redirect to an internal address
- **WHEN** a referenced URL redirects to `https://10.0.0.5/lib.js`
- **THEN** the redirect target SHALL NOT be fetched, and the URL SHALL be listed as failed.

#### Scenario: Internal address
- **WHEN** an app references `https://10.0.0.5/lib.js`
- **THEN** the URL SHALL NOT be fetched and SHALL be listed as failed.

#### Scenario: Module script with imports
- **WHEN** an app has a module script that imports `https://esm.sh/lib`
- **THEN** publishing SHALL succeed, and the owner SHALL see a warning that names the script.

### Requirement: The snapshot changes only on publish
Each "Update share" SHALL replace the snapshot the link shows with the app folder as it is now. A share SHALL keep no history of earlier snapshots.

#### Scenario: Update share
- **WHEN** the owner clicks "Update share" after the app changed
- **THEN** the same link SHALL show the changed app.

#### Scenario: Session archived during publish
- **WHEN** the session is archived while a publish is capturing files
- **THEN** the publish SHALL be refused, and the link SHALL keep showing the earlier snapshot.

### Requirement: Visibility, stop, and share again
A share SHALL have one visibility: `workspace` or `link`. Changing visibility SHALL NOT change the link. Stopping a share SHALL make the link fail on the next request. Sharing again after a stop SHALL produce a new link, and the old link SHALL keep failing.

#### Scenario: Change visibility
- **WHEN** the owner changes a share from `workspace` to `link`
- **THEN** the same link SHALL open without sign-in.

#### Scenario: Stop sharing
- **WHEN** the owner stops a share
- **THEN** the next request to the link SHALL fail as not found.

#### Scenario: Share again
- **WHEN** the owner shares an app again after stopping it
- **THEN** a new link SHALL be returned, and the old link SHALL still fail.

### Requirement: A share follows its session
Archiving the session SHALL pause the share: the link SHALL fail as unavailable. Unarchiving the session SHALL make the same link work again. Deleting the session SHALL end the share and remove its snapshots from storage.

#### Scenario: Session archived
- **WHEN** the owner archives the session that holds a shared app
- **THEN** the link SHALL fail as unavailable until the session is unarchived.

#### Scenario: Session deleted
- **WHEN** the owner deletes the session
- **THEN** the link SHALL fail as not found, and no snapshot file SHALL remain in storage.

### Requirement: Share settings are not exposed through drive responses
The share settings of a drive, including anything needed to build a link, SHALL NOT appear in drive list or drive detail responses. They SHALL be readable only through the share routes.

#### Scenario: Drive detail
- **WHEN** a project member fetches a drive that holds a shared app
- **THEN** the response SHALL NOT contain share settings.
