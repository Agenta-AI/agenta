# MCP connection experience

Status: target behavior for implementation, not shipped documentation.

## User goal

Connect an external tool server to a project in one journey. Today the settings flow separates adding an endpoint from connecting its account. The user should not have to understand that internal distinction.

The same server can have multiple account connections. Each connection has its own stable platform identity and editable display name. Agent configuration selects that connection. The server URL is an address, not an account identity.

## Connect flow

1. Click **Connect MCP** from the integrations-style connection entry point. Reuse the same flow when entering from agent configuration.
2. Enter the MCP URL. Agenta checks the server through its existing outbound-request controls and shows progress.
3. Suggest an editable connection name. Use available server metadata; fall back to a readable hostname. A person may customize it to distinguish accounts. Do not require a second manual name when the default works, and do not expose slug editing as part of setup.
4. When OAuth discovery succeeds, the primary action continues to the provider's consent page. Return to Agenta after consent.
5. Show the completed connection once credentials are persisted successfully. Continue to tool discovery and show the tool list when available. There is no second manual Connect action after creating an endpoint.
6. Open the connected server/connection later to see its tools, edit the name, adjust ask/deny/allow permissions, reconnect or disconnect. Keep configured agents attached to the same stable connection.

Suggested labels are provisional; reuse actual integration components and wording wherever possible. Preserve the user's entry point after OAuth returns. Adding from an agent can select the newly completed connection for that agent without silently changing other agents.

```text
Connect MCP -> URL + suggested editable name -> Continue
  -> OAuth consent when discovered -> Connected -> Tools and permissions
  -> Manual credential fallback when needed -> Verify -> Connected
  -> No authentication required -> Verify -> Connected
```

## Name discovery

MCP initialization can report serverInfo.name, but an authenticated server may not allow initialization until after OAuth. Metadata may be absent or unhelpful, and a server name does not identify the connected account. Use a hostname fallback before consent. After discovery, improve only an untouched suggestion; never overwrite a name the user edited. Generate a unique stable slug using existing platform rules once, independently of subsequent label changes. Two accounts need distinct selectable labels, even when both suggest the same server name.

## Authentication discovery

Try the supported OAuth discovery path first when the server challenges for authentication. Standards-compliant protected-resource metadata and authorization-server metadata can identify the OAuth flow. Do not force a universal API-key/OAuth selector before checking the server.

A failed request or a bare 401 does not prove that the server uses an API key. Timeouts, invalid metadata, missing client registration and permission failures need their own explanation. For unsupported or ambiguous discovery, offer an explicit manual-authentication fallback with only the fields needed, using existing secret-storage components. Arbitrary API-key header requirements cannot be inferred reliably from MCP alone. Never ask for a key just because discovery timed out.

Use safe read-only discovery and initialization, not a tool call, to check connectivity. Preserve current URL validation, address checks, redirect policy and credential boundaries. Do not send supplied credentials to a guessed origin. OAuth client-registration exceptions can require additional input; explain that exception rather than promising all URLs connect automatically.

Sources: [MCP authorization](https://modelcontextprotocol.io/specification/2025-06-18/basic/authorization) and [MCP initialization](https://modelcontextprotocol.io/specification/2025-06-18/basic/lifecycle). Verify the protocol version supported by the branch before implementation.

## States and recovery

| State | User feedback and action |
| --- | --- |
| Checking URL | Progress and cancel; retain entered URL/name. |
| Waiting for consent | Clear pending state; cancel or retry if the browser redirect is interrupted. |
| Consent canceled or access lost | No success message. Explain the problem and allow retry without duplicating the connection. |
| Credentials saved, tools unavailable | Show Connected with tool-discovery failure and Retry tools. Do not lose valid credentials or require consent again unnecessarily. |
| Save interrupted | Retry safely. Repeated callback/submission cannot create duplicate grants or overwrite another account. |
| Token revoked | Show Reconnect on the existing connection; preserve identity and agent references. |
| No tools returned | Show a clear empty state; do not imply a transport failure. |
| Manual authentication needed | Explain the missing information and provide the existing credential-entry path. |

Internal pending endpoint/attempt records are allowed. They must not appear as a successfully added connection before authentication succeeds. Cancellation must not delete an existing working connection. Keep pending records recoverable or expirable using existing lifecycle patterns.

## Tools and permissions

Reuse the integration permission UI and runner approval behavior. Show discovered tools for the selected account connection. Match policy and calls by stable connection identity plus upstream tool identity. Preserve existing permission precedence and make new-tool defaults explicit in code and tests. Renaming a display label must not reset policy.

The Composio path and MCP path are currently separate. Validate a complete discovery-to-approval-to-execution proof before expanding policy configuration. Direct gateway authentication is not a runner approval screen. Keep project checks in the gateway and execution approval in the supported agent path.

## Accessibility and validation

Use keyboard-operable actions, labelled fields, visible progress/error text and focus restoration after OAuth. Keep forms usable on narrow screens. Test repeated submission, refresh, back navigation and returning to the original agent configuration. Validate the low-fidelity flow against the existing integration UI before polishing it; routine details may be resolved within this direction.

No new request schema is fixed by this document. Before changing a contract, document fields by role: URL is routing, editable name is display metadata, slug/ID is identity, permissions are policy, tokens are credentials, and OAuth state is protocol context. Reuse existing shapes and keep credentials out of display metadata.
