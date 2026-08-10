# What to reuse instead of building

The gap after `existing-gateway-model.md` was "a token store with refresh, plus an OAuth
client." Most of that is already written by other people.

## MCP OAuth client — use the official SDK

The MCP Python SDK ships `OAuthClientProvider`, which covers essentially the whole client
side of the authorization spec:

- the discovery chain — Protected Resource Metadata, then authorization server metadata,
  with the path-aware and root fallbacks the spec requires;
- client registration by **both** mechanisms — Client ID Metadata Documents where supported,
  dynamic registration as the fallback;
- PKCE on every flow;
- token refresh, with expiry tracking and automatic refresh when a token is stale but
  refreshable;
- `401` handling by running discovery and authorization, and **`403` handling for step-up
  when more scopes are needed** — the case flagged as open in `credential-model.md`;
- persistence behind a **`TokenStorage` protocol**, so the backend is ours.

It implements the HTTP client library's auth interface, so it drops into a normal async
client rather than requiring a bespoke transport.

**This changes the size of OD1 substantially.** The work is not "build an OAuth broker." It
is "implement one protocol against our database, and wire two callbacks to the dashboard
connect flow." `TokenStorage` is a port and our implementation is the adapter — the same
shape as everything else here.

Two caveats to check at implementation time, tracked in `open-reviews.md`:

- **No MCP SDK is a direct dependency today**, in either the runner or the Python projects.
  Adding one is a new dependency decision.
- Refresh-token support across MCP clients was incomplete for much of 2026, with the
  TypeScript SDK landing it first and Python following. Pin a version that has it and
  verify rather than assuming.

## Token storage — the secrets service, referenced by id

There is no token store to build. The gateways hold **no credential material**: a domain row
carries a `secret_id`, the secrets service holds the encrypted value, and the consumer
resolves it at use time. Webhook subscriptions and SSO providers already do exactly this.

So the `TokenStorage` implementation is thin — an adapter that reads and writes through the
secrets service rather than a persistence layer of its own. Encryption, key management,
rotation, and deletion are inherited rather than reimplemented.

What this needs instead is **new secret kinds**, covered in `secrets-scoping.md`.

## Model routing — the library already in the tree

The routing and provider-adapter work for models is already handled by the multi-provider
client library the SDK depends on, and the platform-specific part is one existing function
that turns vault secrets into that library's call parameters, including the awkward
cloud-reseller credential shapes.

Moving that function behind the gateway is the whole of it. Nothing new to adopt.

## What was considered and rejected

- **A dedicated integration platform as the OAuth broker.** Its actual value is a large
  inventory of pre-registered OAuth applications, which is exactly what Client ID Metadata
  Documents make unnecessary for MCP servers. It also deploys as a multi-service fleet with
  its own datastores, under a licence that is not open source and that gates the relevant
  features behind a paid tier when self-hosted. Wrong shape and wrong cost.
- **A general-purpose OAuth library.** Viable, but it would mean re-implementing the MCP
  discovery chain, resource indicators, and registration selection that the official SDK
  already has. Only worth revisiting if the SDK proves unusable.
- **Writing an OAuth client.** Not justified once the SDK covers discovery, registration,
  PKCE, refresh, and step-up.

## Net

| Piece | Source |
|---|---|
| MCP OAuth client flow | official MCP SDK |
| Token persistence | existing secrets service, referenced by `secret_id` |
| Encryption, key management, rotation | existing secrets service |
| Model routing and provider adapters | existing multi-provider client library |
| `TokenStorage` adapter over the secrets service | ours — thin |
| New secret kinds | ours — an enum value, a DTO, a union arm, a validator branch |
| Credential resolution and policy | ours — the real design work |
| Audit and metering | existing pipelines |

Only the last three rows are ours, and only one of them is design rather than wiring.
