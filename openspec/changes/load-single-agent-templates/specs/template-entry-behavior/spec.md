# Existing template entry behavior

## Purpose

Preserve the familiar template-opening experience while replacing the content-loading behavior underneath it.

## ADDED Requirements

### Requirement: Unchanged interface

The change SHALL preserve existing template cards, opening actions, navigation, and connection controls. It MUST NOT add a package preview, setup wizard, installation status screen, or new account selector.

#### Scenario: Default application

- **WHEN** a user opens a template in /m on a desktop or phone viewport
- **THEN** the existing screen sequence and connection-card placement remain unchanged.

#### Scenario: Older host

- **WHEN** a user opens a template in the older web app
- **THEN** its current connection/create sequence remains unchanged.

### Requirement: Existing choices survive loading

Connection choices already collected by the current interface SHALL be preserved in valid agent configuration or in the first-message setup context. The loader MUST NOT silently substitute another provider.

#### Scenario: Alternative selected

- **WHEN** the user selects GitLab while GitHub is also connected
- **THEN** GitLab remains the chosen provider in the saved configuration or the remaining setup instructions.

### Requirement: Ordinary creation remains ordinary

Free-text creation, blank-agent creation, and existing saved agents SHALL retain their current behavior.

#### Scenario: Free text

- **WHEN** a user enters a free-text agent request without selecting a template
- **THEN** the request uses the ordinary creation path without requiring a package source.
