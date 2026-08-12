# The development ingress

One public HTTPS address, in development, that reaches the API through Traefik.

Today the development tunnel publishes the **object store** and nothing publishes
the API. Two projects now need the opposite, and a third thing needs it too, so the
tunnel changes what it points at.

This document is the whole change: what it is for, what moves, what it costs, and
the one capability it takes away on purpose.

## Who needs it, and who does not

The distinction that decides this design: **who has to reach us.**

| direction | example | needs a public address? |
| --- | --- | --- |
| a provider calls us | Slack posts an event or a button click | **yes** |
| an authorization server fetches a document from us | the newer OAuth client-registration mechanism reads a client-identity URL | **yes** |
| a browser is sent back to us | any OAuth redirect after consent | **no** |

The third row is worth stating because it is the one people assume needs a tunnel.
It does not. A redirect is a browser navigation: the user is already looking at our
interface, so whatever address got them there is an address their browser reaches,
and the authorization server never fetches it. The gateways design settled that
separately and reached the same conclusion.

So this is not an OAuth change. It is an **inbound-delivery** change, and OAuth
benefits from it only in the one case where the authorization server itself fetches
something from us.

## Why one address covers all of it

Every inbound route already lives under `/api/`, and Traefik already routes
`PathPrefix('/api/')` to the API in development, in the self-host compose files, and
in production. So a single tunnel pointed at Traefik publishes every current and
future inbound path with no per-integration work:

```text
/api/channels/slack/events/       a platform event or interaction
/api/channels/bridge/events/      a bridged platform
/api/triggers/composio/events/    already the production path
/api/billing/stripe/events/       today served by the vendor CLI instead
/api/<domain>/...                 whatever comes next
```

**Do not add a tunnel per integration.** The routing already exists; only the tunnel
target is wrong.

## Why the address should be stable

The API composes its own public URLs. `root_path="/api"` is set unconditionally, and
Starlette's `base_url` includes the root path, so anything the API hands out — a
platform manifest, a redirect address, a server URL — comes out correct with no
configuration, **provided the request arrived on the public host**.

That is the whole reason to prefer a reserved domain over a rotating one. Addresses
we hand to a provider are registered on their side, once. A rotating host invalidates
every registration and turns every restart into re-registration work.

## What changes

### 1. The tunnel points at Traefik

`ngrok http seaweedfs:8333` becomes `ngrok http traefik:80`, in both development
compose files. Everything else about the service is unchanged: same `with-tunnel`
profile, same quiet exit when no token is set, same agent API on `0.0.0.0:4040`.

An optional `NGROK_DOMAIN` pins a reserved domain when the operator has one.

### 2. The tunnel selector stops depending on order

This is the part that is a fix rather than a repoint.

`discoverTunnelEndpoint` asks the agent API for its tunnels and returns **the first
one that is HTTPS**, with no check on what that tunnel actually forwards to. That is
correct only while exactly one tunnel exists and it happens to be the store's. Add
any second tunnel and the runner may hand a sandbox the wrong URL — and the sandbox
would then mount the platform's HTTP API as if it were an object store.

So the selector takes the store endpoint it is looking for and matches the tunnel
whose upstream address is that endpoint. **No fallback to the first tunnel:** a
wrong endpoint is worse than none, because none is already handled — the caller
refuses the mount and says so, to the operator and to the model.

### 3. Publishing the store becomes a separate, explicit arrangement

The store no longer rides this tunnel, and one remote-sandbox configuration loses its
convenience: **Daytona sandboxes with the bundled in-network store.** That combination
mounted a durable working directory over the tunnel and now will not.

Stated plainly rather than discovered: after this change that configuration refuses
the mount, warns the operator with the cause named, and tells the model the durable
folder is unreachable. The run continues on throwaway storage. Nothing is silent.

Two ways to restore it, and the first is what production does:

- **Point the store at a public endpoint.** Production runs no bundled store at all —
  there is no `seaweedfs` service in the production compose file — so the store
  endpoint is already a public address there and the sandbox reaches it directly. The
  self-host compose files document the middle case: publish the bundled store on its
  **own subdomain** through Traefik, `Host`-only with no path rewrite, then point the
  store endpoint at it.
- **Run a second tunnel for the store.** With the selector fixed this is safe, and it
  is the operator's arrangement rather than something the compose file assumes.

**The store cannot share one host by path.** S3 signatures cover the request path, so
a prefix that a proxy strips invalidates every request. The self-host compose file
already records this — its store router is `Host`-only for exactly this reason — and
it is why the store gets a host and not a subpath.

## What this costs

**The development API becomes publicly reachable.** Everything Traefik serves is
exposed to whoever has the address, including the web interface. Channel ingress
verifies signatures; not every route does. This is a development-only profile, off
without a token, and it is still a real change in exposure rather than a detail.

**A tunnel provider may interpose a browser interstitial** on free plans for HTML
responses. That does not affect a provider posting to us, and it can affect a browser
following a redirect. Verify against the plan in use before relying on the redirect
path through the tunnel.

## What this does not change

- **Nothing in Traefik.** `/api/` already routes, in every compose file.
- **Nothing in production.** No tunnel exists there and none is added. The store is
  already public and the API is already on a domain.
- **No new API code, no new routes, no new configuration read by the API.**
- **The vendor-CLI patterns stay.** Stripe uses its own CLI, in development and in
  production. Composio subscribes over its own socket in development and uses the
  real public route in production. Neither needs this, and neither is touched.
