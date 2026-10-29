## ADDED Requirements

### Requirement: Repository-style catalog API

The API SHALL expose POST /agent-templates/query with typed filters and a count/templates envelope, and GET /agent-templates/{key} for detail. Routes SHALL use repository router, model, permission and error conventions. The bounded bundled catalog SHALL be returned without pagination.

#### Scenario: Filter the catalog

- **WHEN** the app posts search, category or author filters
- **THEN** it receives matching normalized entries from the bundled catalog without a handwritten application list

### Requirement: One metadata reader

The API and website data generator SHALL use one Python reader for presentation fallbacks, author references and package-derived connection/tool summaries. The frontend SHALL NOT retain a handwritten runtime fallback for fields omitted from the API.

#### Scenario: Compare API and website input

- **WHEN** the same catalog and selected package versions are read for the API and website build
- **THEN** their normalized display values and derived summaries match

### Requirement: Coordinated catalog migration

The bundled catalog, API and frontend SHALL migrate together to the versioned catalog envelope. The reader SHALL NOT retain support for the old unwrapped catalog or add a custom catalog-root setting. Existing package formats and published package versions SHALL remain unchanged by this catalog migration.

#### Scenario: Obsolete catalog envelope

- **WHEN** the reader receives an unwrapped catalog instead of schema v1
- **THEN** it reports an actionable unsupported-catalog-format error instead of silently activating a legacy reader

### Requirement: Separate presentation and package versions

Catalog and author documents SHALL declare a schema version. Packages SHALL retain their content version, digest and existing schema identifiers. Unsupported behavioral or presentation schemas SHALL produce actionable errors.

#### Scenario: Add listing media

- **WHEN** an image or video is added outside an installable package
- **THEN** presentation changes without requiring a package content version change

#### Scenario: Change setup instructions

- **WHEN** setup content in a published package changes
- **THEN** it is published as a new package version without modifying the old package

### Requirement: Bundled delivery and source separation

The catalog SHALL ship with app releases. Explicit GitHub loading SHALL NOT refresh it. Keys SHALL resolve to versioned package directories, not marketing HTML pages or existing installed agents.

#### Scenario: Website is newer than the instance

- **WHEN** a website selects a key absent from an older instance's catalog
- **THEN** the app explains that the template is unavailable in that catalog/version without substituting another agent
