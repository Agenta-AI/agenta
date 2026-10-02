## ADDED Requirements

### Requirement: Preserve the in-app template page

The in-app templates page SHALL remain an in-app experience, not an iframe or website redirect. Migrating to the catalog API SHALL preserve existing cards, categories, display fields, examples and selection behavior. Any visual redesign SHALL be a separate UI decision.

#### Scenario: Existing gallery after migration

- **WHEN** a user opens templates after the data-source migration
- **THEN** the same catalog content and existing interactions are available using API data, including colors, initials and examples

### Requirement: Consistent application consumers

Gallery, template strip, detail surfaces, onboarding and mobile first-run template consumers SHALL use the normalized catalog data. The app SHALL distinguish loading, empty results and fetch failure, and SHALL offer upload and explicit GitHub loading without requiring a catalog entry.

#### Scenario: Source is temporarily unavailable

- **WHEN** the catalog query fails
- **THEN** the app shows a retryable error instead of an empty marketplace or an unexplained fallback list

#### Scenario: Review a PR template

- **WHEN** a reviewer selects GitHub loading and supplies repository, full commit SHA and package path
- **THEN** the app uses the normal agent creation flow for that explicit source without publishing it
