## ADDED Requirements

### Requirement: Plugin workflow kind
The system SHALL treat a workflow revision with URI `agenta:custom:plugin:v0` as a plugin, derive `flags.is_plugin = true` for it, and classify it as an application that is neither an evaluator nor a snippet.

#### Scenario: Committing a plugin revision
- **WHEN** a revision with URI `agenta:custom:plugin:v0` is committed
- **THEN** the stored revision has `flags.is_plugin = true`, `flags.is_application = true`, `flags.is_evaluator = false` and `flags.is_agent = false`

#### Scenario: Other workflows
- **WHEN** a revision with any other URI is committed
- **THEN** its `flags.is_plugin` is false

### Requirement: Plugin manifest
A plugin revision SHALL carry `runtime = "javascript"`, its code in `script`, and a manifest in `parameters.plugin` with `operations` (name, description, input schema), `mcps` (name and gateway connection), and `ui.html`.

#### Scenario: Valid manifest
- **WHEN** a plugin revision has operations `my_open_issues` and `bulk_label`, one MCP named `linear`, and an HTML page
- **THEN** the API returns these fields unchanged on read

### Requirement: Query plugins by flag
Revision flags returned by the API SHALL include `is_plugin`, and the revision query SHALL accept `is_plugin` as a flag filter.

#### Scenario: Listing plugins
- **WHEN** a client fetches the latest revision of each workflow in a project
- **THEN** each revision carries `flags.is_plugin`, true only for plugins
