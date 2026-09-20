# Design: MCP catalog and selection

Draft. Not implemented. Technical choices below are recommendations for review.

## Context

See [proposal.md](proposal.md) for the desired entry flow. Agenta has three relevant patterns:

- `core/gateway/catalog` separates provider definitions, typed catalog responses, service logic, and adapters. Composio supplies integrations there for tools and triggers.
- `core/skills/service.py` serves project workflow-backed Skills, with a separate built-in static workflow catalog. A Skill is executable guidance, not an external server address.
- `core/gateways/mcps/registry.py` selects upstream transport adapters. It is not a browsable integration list.

The proposed catalog describes known direct MCP servers. Project endpoints remain the persisted connections. Composio's GitHub connection and direct GitHub MCP remain distinct choices.

## Goals / Non-Goals

**Goals:** Reuse catalog organization and visual conventions, keep stable identities, and let new entries be added through reviewed data changes.

**Non-goals:** A universal catalog rewrite, a database-backed marketplace, provider plugins, remote catalog downloads, or storing MCP integrations as Skills workflows.

## Decisions

### Keep a small code-defined catalog in the MCP domain

Add typed definitions, service reads, and a static source under proposed `api/oss/src/core/gateways/mcps/catalog/`. Keep `registry.py` for upstream adapters. Reuse common display field conventions from `CatalogIntegration`, but use an MCP-specific response rather than extending Composio's authentication enum to mean something else.

A database adds editing, versioning, and access-control work that two curated entries do not need. A remote registry adds availability and trust concerns. Version-controlled data ships with the API and fits the built-in workflow catalog precedent without copying its workflow storage.

Public entry fields:

| Field | Meaning |
| --- | --- |
| `key` | Stable identity such as `github` or `slack`, not a project connection slug. |
| `name`, `description`, `logo` | Display metadata. Use locally shipped branding assets. |
| `server_url` | Reviewed routing address, not a secret or proof of readiness. |
| `documentation_url` | Public setup guide. |

The server-only definition also carries reviewed issuer/resource/token-destination constraints and scope policy for the managed-client follow-up. Keep these separate from display metadata. Do not include secret values or environment lookup instructions in public responses.

Initial canonical addresses are `https://api.githubcopilot.com/mcp` and `https://mcp.slack.com/mcp`. Adding a provider requires official sources, uniqueness checks, HTTPS URL validation, setup guidance, and a validation date. Adding credentials later requires a reviewed backend configuration mapping, not arbitrary environment-variable lookup from catalog data supplied by users.

### Add reads and a catalog selector without replacing endpoint identity

Proposed authenticated routes, relative to the existing MCP router:

- `GET /gateways/mcps/catalog/integrations?search=...` returns `{integrations: [...]}`.
- `GET /gateways/mcps/catalog/integrations/{key}` returns one definition or 404.

Under the normal deployment prefix, these start with `/api`. Reuse project authorization conventions. For two entries, filtering on the server and returning the complete small list is enough; pagination can wait until measured need.

Add an optional `integration_key` selector to the probe and endpoint creation inputs. Catalog selection resolves routing server-side. Existing URL-only requests remain valid. If both selector and URL are present, require agreement. Store the resolved URL in the existing endpoint route, with a typed optional catalog key for provenance. It is not the authority for credentials on later requests; verify routing against the current trusted definition too.

For custom URLs, permit exact canonical matching after normalizing scheme/host case and a default HTTPS port. Do not ignore query parameters, arbitrary paths, ports, or host suffixes. Any aliases, including trailing-slash behavior, must be explicit reviewed entries. An unknown address keeps the generic flow.

### Use the shared journey as the frontend entry point

Add a catalog screen to `McpConnectJourney` for new untargeted connections. Put fetching and types in `@agenta/entities/mcpEndpoint`; render with existing `@agenta/ui` controls. Reuse the presentation conventions in the integration grid and Skills gallery, not their Composio or workflow state.

```text
Connect MCP
  --> Search GitHub / Slack / Custom server URL
      --> Known integration --> server-side resolve + probe
      --> Custom URL -------> current URL input + probe
          --> Existing authorization flow
              --> Existing project endpoint
```

A reconnect skips browsing. Existing endpoint-targeted in-chat requests keep targeting that endpoint. This does not add a new agent tool argument or auto-connect an integration on the agent's behalf.

Selecting an entry fills the name suggestion, but does not freeze the display name or grant agent permissions. Back returns to the retained search. Loading, empty, failure, keyboard focus, and mobile layout receive rendered tests. Avoid a separate new screen implementation for each provider.

### Separate entry presence from setup availability

Catalog presence means Agenta knows the integration. The probe remains responsible for reachability and setup decisions. Do not make catalog loading probe every provider. The managed-client follow-up supplies a backend decision after selection, so this catalog can ship first and use the current manual form.

## Risks / Trade-offs

- Similar entries can confuse Composio and direct MCP. Label the surface as MCP servers and retain separate connection identities.
- Catalog changes can break saved addresses if used as live indirection. Persist the selected address; do not rewrite existing endpoints on catalog updates.
- A maintained entry can become stale. Require official source checks and tests in its update pull request. Do not add an automatic updater in this scope.
- Reusing a whole Composio API would entangle action counts and connection semantics. Reuse structure and controls, not incompatible domain assumptions.

## Migration Plan

Land catalog reads and optional input fields first. Then land the shared browsing UI with a URL-only fallback for older servers or failed catalog reads. Existing endpoints need no backfill to remain usable; a missing catalog key means a legacy/custom endpoint.

Rollback the browsing UI without changing connections. Removing an entry stops new selection only. A destination change requires an explicit migration proposal for existing grants, not a catalog edit that silently redirects them.
