# Gateways: MCP

Everything MCP-specific. The other documents stay protocol-neutral by pushing their protocol
facts here, so that a protocol revision changes this file and not the architecture.

**Status: protocol facts are current as of revision 2026-07-28. Gateway behaviour derived
from them is partly open.**

## The revision we target

**2026-07-28**, the largest revision since the protocol launched. It supersedes the revision
the earlier tool-gateway research was written against, and several of that research's
assumptions are stale as a result.

Target this revision. The features that made a gateway expensive are precisely the ones it
removed.

## What it removed

- Protocol-level sessions and the session header, from the Streamable HTTP transport.
- The initialize handshake. Every request now carries its protocol version and client
  capabilities in metadata; a discovery RPC replaces the handshake for negotiation.
- SSE stream resumability and message redelivery. A broken stream loses the in-flight request
  and the client re-issues it with a new id.

Servers needing cross-call state use explicit server-minted handles passed as ordinary tool
arguments. Any request can land on any instance behind a plain load balancer.

## Three changes that are explicitly about intermediaries

The specification names gateways as a beneficiary, which is worth taking at face value:

1. **Header-based routing.** The method and the target name ride required HTTP headers, so a
   gateway routes and authorizes without parsing the JSON body.
2. **Cacheable list results.** List endpoints now carry a freshness hint and a scope flag
   controlling whether *shared intermediaries* may cache the response, and no longer vary per
   connection.
3. **Multi Round-Trip Requests.** Server-initiated requests are replaced by the server
   returning an input-required result that the client answers by retrying the original
   request.

The third is the one that changes our cost structure. Under the old design a gateway had to
broker a bidirectional conversation because a server could call back into the client
mid-request. Now it is plain request/response with retries — a stateless proxy rather than a
stateful broker. This is most of what makes "everything transits the gateway" affordable.

## Authorization

The normative position is direct: **authorization is OPTIONAL**. HTTP-transport
implementations should conform to the authorization spec when they support authorization at
all; **stdio implementations should not**, and take credentials from the environment instead.

So a server accepting a static bearer token or API key in a header is fully within spec.
**Whether OAuth is needed is a per-server property, not a protocol-wide requirement** — which
is what makes a large class of servers nearly free to support.

When a server *is* OAuth-protected, the client obligations are heavy and mostly
non-negotiable: OAuth 2.1 with PKCE, protected-resource-metadata discovery, resource
indicators sent on both authorization and token requests, issuer validation before redeeming
a code, step-up flows on insufficient scope with scope-union accumulation, and refresh-token
custody.

Client registration moved: dynamic client registration is **deprecated** in favour of Client
ID Metadata Documents, where an HTTPS URL serves as the client identifier and the
authorization server fetches metadata from it. Pre-registration remains available.

### The rule that decides gateway shape

Two normative rules together: a client must not send a server any token other than one issued
by that server's authorization server, and a server must not accept or transit any other
token.

**A gateway therefore cannot pass a caller's token upstream.** It has to be two things at
once — a resource server to its caller, validating a token minted for the gateway itself, and
an independent OAuth client to each upstream, holding its own tokens per upstream.

This is the two-layer split, now enforced rather than merely advisable. The token-custody work
cannot be avoided by proxying, only by restricting ourselves to servers taking static
credentials.

### Statelessness and OAuth are orthogonal

An easy conflation worth stating: going stateless removed **protocol session** state. OAuth is
**credential lifecycle** state — expiry, refresh, step-up scopes, per-owner-per-server tokens.
This revision removes the first and leaves the second fully specified.

The gain from statelessness is a cheaper gateway, not less authorization work.

## Deprecations that touch us

- **Roots, sampling and logging are deprecated**, with a minimum twelve-month window. The
  suggested migration for sampling is to call a model provider directly — which in a
  two-gateway world means an MCP server calling the LLM gateway. **This is the point where
  the two planes touch**, and it is an argument for one policy core.
- The older HTTP+SSE transport is deprecated; Streamable HTTP is the path.
- Trace-context propagation conventions are now documented for request metadata, which lines
  up with the tracing pipeline that already exists.

## The client implementation

Not ours to write. The official Python SDK's OAuth client provider covers the discovery
chain, both registration mechanisms, PKCE, refresh with expiry tracking, and both the
unauthorized and insufficient-scope responses — persisting behind a storage protocol we
implement over the secrets service.

Two things to verify at implementation time, tracked in `v1/open-reviews.md`: no MCP SDK is a
direct dependency today in either the runner or the Python projects, and refresh-token
support was still landing across SDKs during 2026, so pin a version that has it.

## Open

- **Endpoint shape.** One merged endpoint whose tool list spans every registered server, with
  names namespaced to avoid collisions, or one endpoint per server. Header routing makes the
  merged form cheap; namespacing changes the names the model sees, which affects prompts and
  per-tool permission rules.
- **Step-up handling.** Over-request scopes at connect time, fail actionably, or pause the
  run. The spec recommends least privilege with incremental step-up; an agent platform may
  reasonably prefer fewer interruptions.
- **List composition.** How a merged list behaves when one server's credential is dead, given
  the revision actively encourages caching list results.
- **stdio servers.** The spec directs them to take credentials from the environment. Whether
  we support them at all through a gateway, and where they would run, is unsettled.
