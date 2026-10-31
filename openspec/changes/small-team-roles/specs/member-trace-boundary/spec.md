# Member trace boundary delta

## ADDED Requirements

### Requirement: Screens hide trace and analytics access
When the reader lacks `view_spans`, /m SHALL hide the Analytics tab, the Observability page, also when opened by URL, and every control that opens a trace, including the "Open trace" control in the Analytics drawer, and SHALL send no trace read while rendering a chat.

#### Scenario: Member opens a chat
- **WHEN** a Member opens a chat with settled turns
- **THEN** the app SHALL send no request to `/spans`, `/traces` or `/simple/traces`, and each turn SHALL show its duration from the turn's start and end.

#### Scenario: Member opens the analytics URL
- **WHEN** a Member opens the analytics tab by URL
- **THEN** the app SHALL show the default settings tab.

### Requirement: Screens hide actions the role lacks
/m SHALL hide invite, removing a person, create, rename and delete project, billing changes, credit usage and the chat "Buy credits" button from a person whose role lacks them. /m SHALL show the Access & Security controls only to the organization owner.

#### Scenario: Member opens Settings
- **WHEN** a Member opens the Members, Projects and Billing tabs
- **THEN** no control that the API would refuse SHALL be shown.

#### Scenario: Admin or Member opens Projects
- **WHEN** an admin or a Member opens the Projects tab
- **THEN** the app SHALL show create and rename, and SHALL NOT show delete.

#### Scenario: Member runs out of credits
- **WHEN** a Member's chat turn fails for lack of credits
- **THEN** the app SHALL NOT show the "Buy credits" button.

### Requirement: Turn usage needs no trace access
Turn usage SHALL stay readable by everyone who may read the chat, also without `VIEW_SPANS`.

#### Scenario: Member reads cost
- **WHEN** a Member opens a chat they may read
- **THEN** each turn SHALL show the stored tokens and cost.
