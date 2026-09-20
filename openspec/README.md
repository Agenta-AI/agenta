# MCP integration specifications

Draft for Mahmoud's review. The catalog and managed applications are proposals, not implemented features.

## The outcome

A person opens **Connect MCP**, selects GitHub or Slack, and authorizes their account. When the operator has configured that provider's application, Agenta does not ask for a client ID or secret. Without that configuration, Agenta shows the manual application form and a setup guide. Custom server URLs and token authentication remain available.

## Read in this order

1. [Current behavior and evidence](current-state.md): what main supports, what the existing branch changes, and which tests remain incomplete.
2. [Catalog proposal](changes/add-mcp-integration-catalog/proposal.md) and [design](changes/add-mcp-integration-catalog/design.md): the list users select from and how it fits existing registries.
3. [Managed-client proposal](changes/configure-managed-mcp-oauth-clients/proposal.md) and [design](changes/configure-managed-mcp-oauth-clients/design.md): backend credentials, UI decisions, self-hosting, and deployment.
4. [Provider setup guide draft](provider-setup-guide.md): both setup paths and verified provider documentation.
5. [Delivery plan and status](status.md): proposed pull request boundaries and outstanding acceptance.

## What is specified where

OpenSpec stores accepted behavior under `specs/` and proposed changes under `changes/`. Because this branch had no OpenSpec root, the two baseline specs record the inspected main revision, including its known registration defect. They are deliberately not a claim that the new branch or future catalog is already deployed to production.

| Change | Scope | State |
| --- | --- | --- |
| [Registered-client fix](changes/support-registered-mcp-oauth-clients/proposal.md) | Generic detection, manual application input, and stored registration reuse. | Existing code; provider acceptance remains open. |
| [MCP catalog](changes/add-mcp-integration-catalog/proposal.md) | Backend definitions and shared frontend selection. | Proposal only. |
| [Managed applications](changes/configure-managed-mcp-oauth-clients/proposal.md) | Environment credentials, backend setup decision, callback/refresh identity, docs, and deployment delivery. | Proposal only. |

Each change has a proposal, a design, capability deltas with testable scenarios, and an implementation task list. A completed planning checklist means those artifacts exist, not that the feature works. Do not sync or archive future deltas until their code and acceptance evidence are approved. Apply the registered-client change first; the other two add distinct capabilities without competing modifications to the same baseline requirement.

## Full requirement sets

- Baseline: [MCP connections](specs/mcp-connections/spec.md), [OAuth registration](specs/mcp-oauth-registration/spec.md).
- Current fix: [Registration changes](changes/support-registered-mcp-oauth-clients/specs/mcp-oauth-registration/spec.md), [manual clients](changes/support-registered-mcp-oauth-clients/specs/mcp-manual-oauth-clients/spec.md).
- Catalog: [Catalog behavior](changes/add-mcp-integration-catalog/specs/mcp-integration-catalog/spec.md), [connection entry changes](changes/add-mcp-integration-catalog/specs/mcp-connections/spec.md).
- Managed applications: [Client behavior](changes/configure-managed-mcp-oauth-clients/specs/mcp-managed-oauth-clients/spec.md), [operator and documentation requirements](changes/configure-managed-mcp-oauth-clients/specs/mcp-provider-operations/spec.md).

## Decisions to review

The user requirements are the catalog-first flow, backend-only managed credentials, both self-hosting paths, setup documentation, and delivery in separate changes. The following are proposed implementation choices, not confirmed product decisions:

- Use a small code-defined MCP catalog, not a new editable registry service or Skills workflow type.
- Keep unconfigured entries visible and explain their setup needs.
- Preserve existing manual registrations when managed credentials become available.
- Treat partial configuration as an operator error, not a silent fallback.
- Validate initially with minimal read-only scope profiles. Broader production tool access needs an explicit scope decision before enablement.

## Terms

- **MCP:** Model Context Protocol, which exposes an external server's tools to an agent.
- **Catalog:** Reviewed integration definitions such as GitHub's server address and guide.
- **Endpoint:** A persisted project connection with its own identity and credentials.
- **OAuth client:** A provider-registered application identifying Agenta or a self-hosted installation.
- **Issuer:** The authorization server that issues a connection's tokens.
- **Grant:** One connection's resulting access token and optional refresh token.
- **Vault:** Agenta's project-scoped write-only secret storage.
- **Managed client:** An application configured by the deployment operator, not by every project user.

## OpenSpec tooling

Used OpenSpec `1.13.1` from the [official project](https://github.com/Fission-AI/OpenSpec). The existing downloaded npm archive was checked against the official registry's SHA-512 integrity value. The proposal skill and CLI generated the change scaffolds and artifact instructions. No application code changed while authoring these documents.

Validate from the repository root:

```sh
openspec validate --all --strict --no-interactive
openspec status --change add-mcp-integration-catalog
openspec status --change configure-managed-mcp-oauth-clients
```

Do not install OpenSpec into production images. Generated local assistant skills are ignored by the repository; the versioned deliverables here are the specs and change artifacts.
