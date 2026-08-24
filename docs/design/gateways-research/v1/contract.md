# Gateways: the ports

The gateway contracts are intentionally thin: external protocols determine most
of the wire shape, while Agenta owns authentication, target resolution and secret
injection.

**Status: as built for this increment.** Future protocol-version policy is open;
the current routes are documented below.

## North ports — what callers speak

### Authentication

All gateway routes use the normal Agenta request authentication. Gateway callers
may send the short-lived Agenta credential in `X-AG-Credentials` (or the accepted
authorization schemes); the header is deliberately separate from upstream
authorization so a pass-through request need not overwrite vendor credentials.

### Model surface

The LLM gateway exposes the same namespace for all supported model protocols:

| Namespace | Routes |
|---|---|
| `builtin/{provider}` | `v1/chat/completions`, `v1/responses`, `v1/messages`, `v1/models` |
| `standard/{provider}` | `v1/chat/completions`, `v1/responses`, `v1/messages`, `v1/models` |
| `custom/{slug}` | `v1/chat/completions`, `v1/responses`, `v1/messages`, `v1/models` |

The relay preserves provider protocol/error shapes. A policy denial is produced
before relay and never invokes the upstream.

### MCP surface

MCP is transparent Streamable HTTP, one URL per server:

- `/v1/gateways/mcps/standard/{provider}`
- `/v1/gateways/mcps/builtin/{provider}/{path}`
- `/v1/gateways/mcps/custom/{slug}`

Only request methods appropriate to the stateless MCP relay are accepted. Server
tool names, schemas and upstream errors are not translated.

MCP endpoint management includes `POST /endpoints/{id}/connect` and an OAuth
callback. It discovers the authorization server, performs OAuth with PKCE where
required, and stores the resulting project-owned OAuth grant. The public client
metadata document exists for authorization servers that use client registration
metadata.

## South ports — what adapters speak

LLM adapters receive a resolved `LLMEndpointRoute`, including deployment kind,
base URL, optional provider family, model, region/API version and credentials.
MCP adapters receive the resolved server URL, auth scheme and credentials. Both
are in-process adapter boundaries; neither is an external plugin contract.

## Not contracts

- Provider-specific APIs and the MCP protocol are upstream-owned contracts.
- There is no out-of-process adapter ABI.
- Alias/fallback, embeddings and static/stdio MCP support are not silently
  promised by the current route families.

## Still open

The public north-port compatibility/versioning policy, policy-decision caching,
and the semantics of a policy expiry during a stream are future design work.
