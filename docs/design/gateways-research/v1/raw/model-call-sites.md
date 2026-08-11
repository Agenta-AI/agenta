# Model call sites, and whether the routing library runs in-process

Two checks that gate the work packages. Both are closed.

**Revised after a second pass against the code.** The first version of this document got the
count and one attribution wrong, and drew two conclusions that later decisions reversed. What
changed is recorded at the bottom.

## Check 1: the call sites

Decision D1 says every model call transits a gateway, so this list is the scope of the model
work.

**Result: six call sites across three shapes, not four paths. Every provider call comes from the
SDK or from the harness. The API calls no models.**

All the in-repo provider calls live in one file, `sdks/python/agenta/sdk/engines/running/handlers.py`.

| # | Where | Call | Kind |
|---|---|---|---|
| 1 | the LLM-as-judge evaluator | the routing library's async completion, through the shared retry wrapper | chat |
| 2 | the shared completion path for prompt workflows | the same wrapper, reached from two callers | chat |
| 3 | the `llm_v0` agent tool-loop | the routing library **directly**, bypassing the wrapper | chat |
| 4 | a similarity evaluator | the OpenAI client directly, twice per call | **embeddings** |
| 5 | a second similarity evaluator | the OpenAI client directly, twice per call | **embeddings** |
| 6 | the harness, inside the sandbox | the harness's own client | chat |

Sites 1 and 2 go through a shared retry-and-mock wrapper in the SDK that lazy-loads the routing
library and retries on a closed client. Site 3 does not.

A mock path also exists. It makes no outbound call and is not a site.

### There is no router object

The routing library ships a `Router` class. **Nothing in this repo instantiates it.** The only
matches for a router constructor in the SDK are the web framework's own. "Routing" here means the
library's model-string provider dispatch — you pass `model="anthropic/claude-…"` and it picks the
transport. The earlier claim that a call went "through the router" was wrong in a way that
matters: there is no retry, fallback, or load-balancing object to inherit, so anything the design
wants from those has to come from somewhere else.

### What is not a call site

- **The API.** Neither tree calls a model provider. There is one import of the routing library,
  in the tracing tree, for the cost calculator only. The static model catalogue in the SDK uses
  the same calculator to derive per-model costs. Pricing is the library's entire role outside the
  completion calls.
- **The runner.** Its model module picks a model id and checks it against what the harness
  accepts, failing loudly when the harness cannot set the requested model. The credential goes to
  the harness and the harness makes the call.

The blast radius is one SDK file plus the harness path.

## The finding about embeddings

Two of the five in-repo sites call **embeddings**, not chat, and each issues two calls — one for
the output and one for the reference. The design assumed chat throughout.

Both sites also:

- read the OpenAI key straight from the vault list, matching on the inner provider name;
- hardcode the provider, with no abstraction to swap it;
- **bypass the provider-settings builder entirely**, hand-rolling the credential lookup.

They are the least abstracted callers in the tree.

**This does not force an embeddings route now.** These two sites are evaluator paths, and the
current scope is the gateways, agent v0, the runner and the harnesses (D15). The route arrives
with the evaluator path. What the finding does establish is that the model north port cannot be
assumed to be chat-shaped forever.

## Check 2: does the routing library run in-process?

**Result: yes. One pattern in the current code must not survive the move.**

The library ships two separate things:

- **The in-process SDK** — a completion call plus a router object that adds retries, fallbacks,
  load balancing, cost tracking and callbacks. This is the routing and dispatch we want, and as
  noted above we currently use only the completion call, not the router object.
- **A proxy server** — a separate deployment adding virtual keys, an admin interface, per-team
  credential routing and spend tracking.

Calling the library in-process bypasses the proxy completely.

That split is convenient rather than awkward. **The proxy is the part that competes with our
policy plane** — its virtual keys occupy the same role as our gateway token, and its credential
routing the same role as our resolution modes. We want the routing, not the policy. This is
decision D9: embed the commodity, own the policy.

### Per-request credentials work, and one call site does it wrong

The supported in-process pattern passes the key and the base URL as call arguments.

**The provider-settings builder already produces exactly that** — a dictionary splatted into the
completion call, always carrying the model and conditionally the key or a set of extras. It lives
in the SDK's secrets manager, not in the folder named after the model library; that folder holds
an observability callback. Anyone sizing this work from folder names will size the wrong thing.

**There are two copies of the builder.** The same logic exists twice, differing only in which
execution context it reads secrets from — the older routing context and the newer workflow
context. The workflow copy is the one both production chat sites actually call. An extraction
that takes only one leaves a live second implementation behind.

The `llm_v0` handler does neither. It assigns keys to **module-level attributes on the library**,
one per provider, before it calls.

That is process-wide state. Today each workflow process serves one tenant, so it survives. In a
shared gateway process it would be a cross-tenant credential leak: one caller's key stays set and
serves the next caller.

**This pattern must not move to the gateway** — but it is not a prerequisite either. It exists
*because* nothing hands the handler a resolved connection; proper injection through the gateway is
what removes it. The handler is also reported unused and likely to be dropped. See `notes.md` for
why sequencing this ahead of its enabler produces a plan that cannot start.

### One dependency note

The library is declared only in the SDK's own project file, not the API's, though it resolves into
the API environment today. If routing moves into the API or a gateway service, that service must
declare it.

## What these two answers unblock

- The model plane is a **library integration, not a service**. No second deployment for routing.
- The package that converts callers is **small in file count and large in care**: one SDK file
  holds five of the six paths.
- The extraction must take **both copies** of the provider-settings builder, plus the completion
  call, and leave the observability callback where it is.
- Whatever the router object would have given us — retries, fallbacks, load balancing — is not
  currently in use and is not inherited by moving.

## What this revision changed

- **The count.** "Four paths" became six sites across three shapes. The chat path has three call
  sites, not one.
- **An attribution.** The first chat row named the `llm_v0` handler as the site going through the
  routing library's completion. It is in fact the one site that bypasses the shared wrapper and
  sets module-level globals — the opposite of the well-behaved path.
- **The router object.** Claimed as used; it is not instantiated anywhere.
- **The embeddings conclusion.** "The north port needs an embeddings route" was scope creep from
  a correct finding. Deferred with the evaluator path (D15).
- **The global-key conversion.** Called a prerequisite. It is an outcome of the conversion, not a
  gate in front of it.
