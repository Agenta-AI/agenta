## ADDED Requirements

### Requirement: Guided PR submission

A manual contribution guide SHALL be tested before the guided flow. The submit-template skill SHALL guide GitHub setup, collect author and template metadata, place a validated package folder and versioned metadata in the monorepo, and open a PR with the user's approval. It SHALL reuse existing author records when applicable and include exact source information for testing the package in Agenta.

#### Scenario: New author submits

- **WHEN** a first-time contributor asks to publish their template
- **THEN** the skill guides authentication without collecting credentials in chat, prepares author/template metadata and opens the approved PR
- **AND** the PR identifies its head repository, commit and package path for testing

### Requirement: CI checks and publication

CI SHALL validate all bundled packages, supported metadata schemas, author references and published-version immutability. Git comparison SHALL serve immutability checks, not select which packages to validate. Contributed packages SHALL be parsed as data without executing their code or exposing credentials. The required-check configuration SHALL block merging failed validation and SHALL require maintainer authorization to change. Merge SHALL feed normal website builds and subsequent bundled app releases without manual registration.

#### Scenario: Invalid author reference

- **WHEN** a catalog entry names an author absent from the registry
- **THEN** CI fails with the entry and author identifier

#### Scenario: Merge valid submission

- **WHEN** a valid template PR merges
- **THEN** the next website build includes its pages and the next bundled catalog release includes its entry
