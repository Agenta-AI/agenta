# MCP provider setup and maintenance

## Purpose

Give Cloud operators, self-hosting operators, and manual-setup users accurate instructions for creating, configuring, testing, and maintaining provider applications.

## ADDED Requirements

### Requirement: Document both setup paths
Agenta documentation SHALL describe operator-managed environment configuration and the per-connection manual client form. Each provider guide SHALL include the official registration link, required account rights, exact callback derivation, chosen app type, permissions, credential location, verification steps, and token fallback limitations. It SHALL distinguish confirmed instructions from provider checks still awaiting real authorization.

#### Scenario: A self-hosting operator follows the guide
- **WHEN** the operator opens the provider guide
- **THEN** it explains how to create the app, register the public HTTPS callback, inject environment values only into the API, restart, and test consent and tool discovery
- **AND** it also explains the manual client form when environment configuration is absent.

#### Scenario: A provider rejects token fallback
- **WHEN** a token lacks the required type, scopes, or application enablement
- **THEN** documentation explains that **Use a token instead** does not bypass provider requirements
- **AND** it specifies the correct authorization header format rather than imply that `x-api-key` works for every provider.

### Requirement: Keep application setup accurate for each provider
The GitHub guide SHALL distinguish OAuth Apps from GitHub Apps and state which path was tested. The Slack guide SHALL include enabling the Slack MCP Server feature, user-token scope selection, HTTPS redirects, and workspace approval or distribution checks. Neither guide SHALL claim successful integration from reaching a login page alone.

#### Scenario: Register Slack for testing
- **WHEN** an operator follows the Slack guide
- **THEN** it directs them to the app's Agents section to enable the MCP Server feature and to OAuth & Permissions for redirect and user scopes
- **AND** it rejects a public plain-HTTP callback as the documented setup path.

### Requirement: Separate environments and credential storage
Staging and production SHALL use separate provider applications and secret values. Deployment repositories SHALL contain only configuration names, templates, and procedures. Live values SHALL remain in the existing environment-specific secret store and SHALL be injected only into API services that execute OAuth.

#### Scenario: Render a Cloud deployment
- **WHEN** staging or production configuration is rendered with MCP client credentials
- **THEN** those credentials are absent from web, mobile, runner, services, build arguments, and public configuration
- **AND** the correct environment's API receives its own values.

### Requirement: Maintain a repeatable provider lifecycle
The operator procedure SHALL record an owner, environment, public callback, provider app reference, secret-store reference, approved scope policy, verification date, rotation instructions, and rollback steps without recording secret values. Provider metadata changes SHALL require a reviewed catalog update before widening trusted destinations or access.

#### Scenario: Review a provider update
- **WHEN** the provider changes its registration settings, scopes, or OAuth destinations
- **THEN** the owner checks official documentation and runs the affected tests in staging
- **AND** production configuration changes only after explicit approval.

### Requirement: Gate production enablement on real acceptance
Production enablement SHALL require a real registered application's consent, callback, token exchange, tool discovery, reconnect, and applicable refresh tests for each provider. Cloud distribution SHALL also be tested in a workspace or organization other than the application's development home. Recorded evidence SHALL omit credential entry and tokens.

#### Scenario: Only initiation was tested
- **WHEN** testing only reaches a provider login page using a placeholder client ID
- **THEN** the release record labels full provider authorization unverified
- **AND** it does not claim production readiness.
