# Brief

## The question

Every outbound call to a model or a tool — from anything on the platform, with no
exceptions — transits a gateway we own, so that credentials, policy, and audit live at one
boundary instead of being scattered across sandboxes, workflow processes, and SDK call
sites.

Concretely: when an MCP server is declared, the caller talks to **our MCP gateway**, and
the gateway talks to the server. When anything calls a model, it talks to **our LLM
gateway**, and the gateway talks to the provider. Provider credentials stop at our boundary
and never travel outward.

"No exceptions" includes everything custom. A custom provider, a self-hosted model server,
a cloud reseller, an OpenAI-compatible third party — none of these becomes a direct path.
The call goes to our gateway and the gateway's adapter calls the custom thing. What is
custom lives *behind* the gateway; the route *to* the gateway is invariant.

This is a large change and it touches many call sites rather than one. Every place that
today resolves a credential and calls a provider becomes a place that calls the gateway.
That is the real scope.

## The inversion

This is ports and adapters, with the control inverted at the credential boundary.

**Today** the platform resolves a real third-party credential and hands it to the caller.
The caller holds the secret and chooses the route. Trust is extended outward, and the
mitigations for that (placeholder substitution on remote sandboxes, a per-run redaction
deny-set) are damage control on a decision already made.

**With a gateway** the caller receives a short-lived, run-scoped token that is worthless
anywhere except our gateway, and a base URL that points at us. The caller no longer
*chooses* a provider — it *names* a connection, and the gateway binds that name to a real
route and a real credential. The caller cannot exceed what the name entitles it to,
because it never holds anything that would let it.

The tool plane already works this way and has for some time: a tool call is a reference
resolved server-side, not a credential handed out. The model plane does not. Making the
model plane behave like the tool plane is most of what the LLM gateway is.

## What a gateway is here

Not a proxy with a cache. Six concerns, applied to both nouns:

| Concern | Model plane | Tool plane |
|---|---|---|
| **Identity** | which principal is calling this model | which principal is calling this tool |
| **Authorization** | may they use this model, at this cost | may they use this server, this tool |
| **Governance** | model allowlists, spend ceilings, data rules | tool allowlists, approval, egress rules |
| **Compliance** | one audit record per call, with the principal | same record, same shape, different noun |
| **Metering** | tokens, cost, per principal | calls, per principal |
| **Routing** | fallback, aliasing, load-balancing, region | which backend server owns this tool name |

The claim this research tests: those are one implementation with two protocol adapters,
not two implementations.

## Why now, and why together

Three things make this the moment rather than a later refactor:

- **The wire already anticipates it.** Both consumers are already modelled as a route plus
  typed credentials; neither needs a new field to point at a gateway instead of a
  provider. The cost of adopting the gateway on the wire is close to zero.
- **The credential-hiding work has gone as far as it can.** The current design already
  distinguishes credentials the sandbox must hold from credentials it can be denied, and
  the ones it must hold are the ones a gateway removes entirely. Further hardening on the
  present shape has diminishing returns.
- **The self-hosted story needs it.** The tool-side research concluded that the honest
  self-hosted path is to be a gateway rather than to clone a catalog. That conclusion
  applies unchanged to models, where self-hosters already bring their own keys.

## Non-goals

Being a model catalog, or a tool catalog. Replacing the tracing pipeline. Solving triggers
— inbound events are a separate subsystem for structural reasons and stay that way.
