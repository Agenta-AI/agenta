# Model call sites, and whether the router runs in-process

Two checks that gate the work packages. Both are now closed.

## Check 1: the call sites

Decision D1 says all model calls go through the gateway. Thus this list is the scope of the
model work.

**Result: four paths, not two. All provider calls come from the SDK. The API calls no
models.**

| # | Where | Call | Kind |
|---|---|---|---|
| 1 | SDK running handlers, the `llm_v0` handler | the router's async completion | chat |
| 2 | SDK running handlers, a similarity evaluator | the OpenAI client directly | **embeddings** |
| 3 | SDK running handlers, a second similarity evaluator | the OpenAI client directly | **embeddings** |
| 4 | the harness, inside the sandbox | the harness's own client | chat |

A mock path also exists in the SDK. It makes no outbound call and is not a site.

### What is not a call site

- **The API.** Neither the OSS nor the EE tree calls a model provider. Two imports of the
  router's cost calculator exist, for pricing only.
- **The runner.** Its model module only picks a model id and checks it against what the
  harness accepts. It fails loudly when the harness cannot set the requested model. The
  credential goes to the harness, and the harness makes the call.

This is better than feared. The blast radius is one SDK file plus the harness path.

## The finding that changes the design: embeddings

Two of the three SDK sites call **embeddings**, not chat. The design assumed chat throughout
and proposed an OpenAI-compatible chat surface as the north port.

Both sites also:

- read the OpenAI key straight from the vault list and match on the provider name;
- hardcode the provider, with no abstraction to swap it;
- bypass the router completely.

**Consequence:** the model north port needs an embeddings route, or these two sites cannot
transit the gateway and D1 fails. They are also the least abstracted callers in the tree, so
they are the ones most changed by the move.

## Check 2: does the router run in-process?

**Result: yes. One pattern in the current code must not survive the move.**

The library ships two separate things:

- **The in-process SDK** — a completion call plus a router that adds retries, fallbacks, load
  balancing, cost tracking and callbacks. This is the routing and dispatch we want.
- **A proxy server** — a separate deployment that adds virtual keys, an admin interface,
  per-team credential routing and spend tracking.

Calling the library in-process bypasses the proxy completely. No virtual key is checked and
nothing reaches the proxy's records.

That split is convenient rather than awkward. **The proxy is the part that competes with our
policy plane** — its virtual keys occupy the same role as our gateway token, and its
credential routing the same role as our resolution modes. We want the routing, not the
policy. This confirms decision D9: embed the commodity, own the policy.

### Per-request credentials work, and one call site does it wrong

The supported in-process pattern passes the key and the base URL as call arguments. The
SDK's provider-settings builder already produces exactly that, so that path is correct today.

The `llm_v0` handler does not. It assigns the key to **module-level attributes on the
library** — one per provider — before it calls.

That is process-wide state. Today each workflow process serves one tenant, so it survives. **In
a shared gateway process it is a cross-tenant credential leak:** one caller's key stays set
and serves the next caller.

**This pattern must not move to the gateway.** Convert the handler to per-call arguments
first, or convert it as part of the move. It is the single most dangerous line in the model
work.

### One dependency note

The library is declared only in the SDK's own project file, not the API's, though it resolves
into the API environment today. If routing moves into the API or a gateway service, that
service must declare it.

## What these two answers unblock

- The model plane is a **library integration, not a service**. No second deployment for
  routing.
- The package that converts callers is **small in file count and large in care**: one SDK
  file holds three of the four paths.
- `models.md` needs an embeddings section, and `contract.md` needs an embeddings route on the
  north port.
- The global-key conversion is a prerequisite, not a cleanup.
