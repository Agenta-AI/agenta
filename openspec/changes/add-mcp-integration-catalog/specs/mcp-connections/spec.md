# MCP connection entry delta

## MODIFIED Requirements

### Requirement: Enter a server address
Agenta SHALL begin an untargeted new MCP connection with a searchable catalog and a **Custom server URL** option. Selecting an integration SHALL resolve its server URL on the backend and enter the existing probe and authorization flow. Selecting the custom option SHALL ask for an HTTP server URL. Settings, agent configuration, and in-chat connect requests SHALL share the journey. A reconnect or request targeting an existing endpoint SHALL go directly to that endpoint's flow without requiring another catalog selection.

#### Scenario: Select GitHub
- **WHEN** the person selects GitHub from the catalog
- **THEN** Agenta resolves the catalog key to its canonical URL and probes it
- **AND** the person does not need to paste that URL.

#### Scenario: Add an unknown server
- **WHEN** the person chooses **Custom server URL**
- **THEN** the journey requests a server URL
- **AND** the probe distinguishes OAuth, no authentication, and inconclusive authentication without treating every authorization challenge as an API key requirement.

#### Scenario: Reconnect an existing endpoint
- **WHEN** the person selects Reconnect for a saved endpoint
- **THEN** Agenta retains that endpoint's identity and address
- **AND** it skips catalog browsing.

#### Scenario: Catalog loading fails
- **WHEN** the catalog request fails or a search returns no matches
- **THEN** the UI shows the corresponding error or empty state with a retry where applicable
- **AND** the custom URL path remains available.
