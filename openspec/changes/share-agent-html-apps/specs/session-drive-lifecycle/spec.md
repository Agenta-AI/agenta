# Session drive lifecycle delta

## Purpose

Define what an archived or deleted session drive still allows, so that an archived session keeps its history as read-only, and deleting a session reliably removes its files from storage.

## ADDED Requirements

### Requirement: Archived drives are read-only
When a drive is archived, file reads, listings, stat calls, downloads, exports, chat attachment reads, and app scope requests at level `read` SHALL still work. File writes, folder creation, deletes, uploads, attachment writes and deletes, drive edits, storage credential requests, and app scope requests at level `read-write` SHALL be refused as archived. Archiving and unarchiving the drive SHALL still work. Every drive operation SHALL state whether it reads, writes, or changes the drive lifecycle, so that no operation can skip this rule.

#### Scenario: History of an archived session
- **WHEN** a project member opens an archived session that has image attachments and files in its drive
- **THEN** the attachments SHALL render, and the drive files SHALL list and open.

#### Scenario: Write after archive
- **WHEN** a project member writes a file in the drive of an archived session
- **THEN** the request SHALL be refused as archived, and the drive SHALL NOT change.

#### Scenario: Storage credentials after archive
- **WHEN** a runner asks for storage credentials for the drive of an archived session
- **THEN** the request SHALL be refused as archived.

#### Scenario: Unarchive
- **WHEN** the session is unarchived
- **THEN** writes to its drive SHALL work again.

### Requirement: Only unarchive restores an archived drive
Binding a session drive, signing storage credentials for a session, or creating an app in a session SHALL NOT unarchive an archived drive. Such a request SHALL be refused as archived.

#### Scenario: Create app in an archived session
- **WHEN** an agent tool call tries to create an app in a session whose drive is archived
- **THEN** the call SHALL be refused, and the drive SHALL stay archived.

### Requirement: Deleting a session removes all of its stored files
Deleting a session SHALL remove every stored object of its drives, including app share snapshots. If removal fails for any object, the delete SHALL report failure, and a repeated delete SHALL try again and finish the removal.

#### Scenario: Storage failure during delete
- **WHEN** removing one drive's objects fails during a session delete
- **THEN** the delete SHALL report failure, and a second delete SHALL remove the remaining objects.

#### Scenario: Delete with shared apps
- **WHEN** a session with a shared app is deleted
- **THEN** no object SHALL remain under the drive's file prefix or its share prefix.
