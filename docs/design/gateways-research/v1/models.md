# Gateways: models

Everything model-provider-specific. The other documents stay provider-neutral by pushing
their provider facts here.

**Status: skeleton.** The as-built facts are established; the gateway-side design is open.

## The two axes that already exist

The codebase already models model routing on the right two axes, and the runner wire uses the
same pair:

- **provider** — who issued the credential. A direct-provider list and a broader list that
  additionally covers cloud resellers and self-hosted deployments already exist as enums in
  the secrets domain.
- **deployment** — how that provider is reached: the provider's own API, an
  OpenAI-compatible third party, or a cloud reseller with its own auth scheme.

Keep both. Collapsing them is the common mistake, and the existing enums are evidence the
distinction is load-bearing.

## Where the routing logic lives today

**Not where the folder name suggests.** The SDK folder named after the model client library
holds an observability callback handler. The actual routing is a single provider-settings
builder in the SDK's secrets manager: it reads vault secrets, decides whether the model is a
direct or custom provider, normalizes the model name into the library's form, and assembles
the credentials — including the cloud-reseller shapes, which each differ.

It also guards the custom endpoint against server-side request forgery before using it.

**Moving that function behind the gateway is the substance of the model-plane work.** Anyone
sizing it from folder names will size the wrong thing.

## The library

The multi-provider client library the SDK already depends on handles provider adapters,
streaming differences and reseller auth schemes. That work drifts constantly, is identical for
everyone, and is not ours to own.

*To establish:* whether it is usable as an in-process routing layer inside the gateway or only
as a separate service. This materially changes the cost of the model plane and is the first
verification item.

## What the gateway removes

The credential category that today must be held inside an agent-controlled sandbox exists only
because cloud-reseller SDKs sign requests locally rather than transmitting the secret, so
outbound substitution cannot hide it. Behind a gateway, signing happens at the gateway and
that category stops existing for gateway-routed runs.

This is the strongest concrete security outcome in the design.

## Callers

At least two, and the list is not proven exhaustive — establishing it is a prerequisite for
sizing, since under the transit rule the list *is* the scope.

- **Agent runs** resolve a connection and inject it into the sandbox, where the harness reads
  a provider key from an environment variable because that is what the underlying agent SDKs
  expect.
- **Workflows** go through the SDK's model layer and call the provider from the workflow
  process.

They differ in who resolves the credential, where the call originates, and how they fail. Both
transit the gateway, each behind its own port, and the SDK keeps its secret-fetch and
secret-injection capabilities — only the adapter behind them changes.

## Open

- **The north port's shape.** An OpenAI-compatible surface is the obvious choice since every
  harness and the library already speak it, but harnesses that authenticate with their own
  subscription login inject no credential today and may not fit.
- **Streaming and policy.** A decision has to be made before the first token; what happens to
  a decision that expires mid-stream is unsettled.
- **Model aliasing and fallback.** Whether the gateway offers them at all, or stays a pure
  route-and-inject layer. Offering them makes the gateway a product surface rather than an
  enforcement point.
- **Spend attribution** when a call runs on a user-owned credential — see `secrets.md`.
