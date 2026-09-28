# Session drive lifecycle delta

## Purpose

Define what an archived or deleted session drive still allows, so that archiving and deleting a session reliably stop access to its files and remove them from storage.

## ADDED Requirements

### Requirement: Archived drives refuse file access
When a drive is archived, file reads, writes, deletes, uploads, downloads, exports, app scope requests, and storage credential requests for that drive SHALL be refused. Archiving and unarchiving the drive SHALL still work.

#### Scenario: Read after archive
- **WHEN** a project member reads a file in the drive of an archived session
- **THEN** the request SHALL be refused as archived.

#### Scenario: Unarchive
- **WHEN** the session is unarchived
- **THEN** file access to its drive SHALL work again.

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
