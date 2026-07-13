# MCP configuration redesign

Status: planning complete, implementation not started  
Date: 2026-07-13

This project turns the MCP status-quo audit into an implementation sequence. It narrows the
public product to remote MCP servers, removes controls that cannot work, separates saved author
intent from runtime delivery, and makes the Claude failure observable before expanding to Pi or
authenticated servers.

## Decisions

- The internal `agenta-tools` MCP is never shown or edited in the user MCP UI.
- The user MCP section is shown only when the deployment publishes the user-MCP capability.
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

A user can add an unauthenticated remote MCP server to a capability-enabled Claude deployment,
test the connection, see the discovered tools or a concrete error, save an unambiguous config,
and run it. Unsupported combinations are absent from the editor or rejected clearly. The saved
shape remains valid when execution later moves behind the Agenta MCP gateway and becomes
available to Pi.

