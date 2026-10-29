# Template sources

## Purpose

Resolve reusable template content from an explicit source while keeping built-in templates as the default.

## ADDED Requirements

### Requirement: Default internal source

The service SHALL resolve an existing template key to an internal package source when no source kind is supplied.

#### Scenario: Existing card

- **WHEN** a user chooses a built-in template through the existing interface
- **THEN** the loading service resolves the corresponding internal package without asking for a repository URL.

### Requirement: Source ownership and provenance

The service SHALL resolve source content before creating agent resources and retain its source key, resolved version, and content digest on the created resource provenance.

#### Scenario: Pinned content

- **WHEN** a template is loaded and the internal source later changes
- **THEN** the created agent retains the loaded content and its original provenance.

#### Scenario: Unknown source

- **WHEN** a requested internal key does not exist or a source kind is unsupported
- **THEN** the request fails with a source diagnostic and creates no agent.

### Requirement: Bounded source access

The service MUST reject source paths that escape the package root and MUST NOT execute source-provided startup hooks.

#### Scenario: Unsafe path

- **WHEN** a package contains an absolute path, traversal segment, symlink escape, or automatic startup file
- **THEN** validation rejects the package before resource writes.
