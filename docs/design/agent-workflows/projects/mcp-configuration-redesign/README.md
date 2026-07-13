# MCP configuration redesign

Status: slices 0-2 implemented, validation in progress
Date: 2026-07-13

This project turns the MCP status-quo audit into an implementation sequence. It narrows the
public product to remote MCP servers, removes controls that cannot work, separates saved author
intent from runtime delivery, and gives the UI one runtime capability source.

## Decisions

- The internal `agenta-tools` MCP is never shown or edited in the user MCP UI.
- The user MCP section is shown only when the selected harness publishes `mcp.user_servers`.
- User-authored stdio is removed from the public schema and UI. The trusted internal Daytona
  stdio shim remains a private runner implementation detail.
- The saved interface is role-based: identity, connection, credentials, and policy.
- The first supported connection is remote HTTPS. Protocol negotiation belongs to the MCP client
  or future gateway, not the agent template.
- Credentials remain part of the extensible contract, but the first acceptance slice uses
  `credentials.type = "none"`.
- Secret values are never stored in agent revisions. Static credentials are references, and OAuth
  will reference a platform connection.
- Tool policy uses an explicit mode. An empty string or empty array never means "all tools."
- There is no backward compatibility, feature flag, or MCP-specific frontend environment
  variable.
- Claude keeps the existing direct ACP HTTP path. Pi is the immediate slice 2.2 follow-up.
- The currently reported enabled-deployment Claude failure is unresolved until reproduced on the
  exact deployment and traced across every boundary.

## Deliverables

- [Context](context.md)
- [Research](research.md)
- [Interface design](interface.md)
- [Implementation plan](plan.md)
- [Migration](migration.md)
- [QA plan](qa.md)
- [Status and decisions](status.md)

The source audit that precedes this plan is in
[MCP status quo and interface recommendation](../mcp-delivery-architecture/status-quo-report.md).

## Intended outcome

A user can add an external HTTP MCP server to Claude with an unambiguous config. Unsupported
controls are absent, Pi stays hidden until slice 2.2 works, and future discovery, status, OAuth,
and gateway work can extend the role-based object without moving existing fields.
