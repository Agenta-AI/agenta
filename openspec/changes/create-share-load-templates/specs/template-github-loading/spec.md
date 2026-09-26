## ADDED Requirements

### Requirement: Explicit public GitHub package source

The loader SHALL accept a public repository URL, full commit SHA and explicit package directory. It SHALL apply the existing package parser and load semantics to files fetched only at that commit. It SHALL reject branches, tags, abbreviated SHAs and ref fields rather than resolve them. It SHALL support testing a package in a PR head without merging or adding it to the bundled catalog.

#### Scenario: Test a contribution from a fork

- **WHEN** a reviewer supplies the PR head repository, head commit and package path
- **THEN** the agent loads from those exact files and the result identifies that commit
- **AND** the public catalog remains unchanged

#### Scenario: Mutable revision supplied

- **WHEN** the caller supplies a branch or tag instead of a full commit SHA
- **THEN** the API rejects it with instructions to supply the resolved commit and creates nothing

#### Scenario: Large monorepo

- **WHEN** a valid small package lives in the Agenta monorepo
- **THEN** one bounded directory-fetch strategy can load it without downloading the whole repository or adding a whole-archive fallback

#### Scenario: Missing or private source

- **WHEN** the directory is missing or the repository is private
- **THEN** the loader returns an actionable unsupported/unavailable source error and creates nothing
