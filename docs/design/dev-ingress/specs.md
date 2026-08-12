# The development ingress — specs

One public HTTPS address, in development, that reaches the API through Traefik.

Research: [research.md](research.md). Tasks: [tasks.md](tasks.md).

## One package, and why there is no breakdown

**No work packages.** The change is three edits that only make sense together — the
tunnel target, the selector that stops depending on tunnel order, and the
documentation of the capability that moves. Splitting them would land a repoint whose
selector still returns the wrong URL, which is worse than either half.

It is also small: two compose files, two env examples, one function, one call site,
three tests, three documents. A package structure would be ceremony over a diff that
one reviewer reads in one sitting.

## What it is for

Anything outside that has to reach this deployment: a platform posting a webhook, or
an authorization server fetching a document we serve. **Not** OAuth redirects — those
are browser navigations and need nothing (`research.md`).

Three consumers are already known: channels needs platform events; the MCP and model
gateways need the client-identity fetch; the remote-tools work wants to publish a
server URL into a sandbox.

## The target

### 1. The tunnel forwards to Traefik

`ngrok http seaweedfs:8333` becomes `ngrok http traefik:80`, in both development
compose files. Everything else about the service is unchanged: same `with-tunnel`
profile, same quiet exit when no token is set, same agent API on `0.0.0.0:4040`.

`NGROK_DOMAIN` pins a reserved domain when the operator has one.

**Every inbound route arrives on its normal path.** `/api/` is already routed in
development, in the self-host compose files, and in production, so no integration
needs a tunnel or a route of its own:

```text
/api/channels/slack/events/       a platform event or interaction
/api/triggers/composio/events/    already the production path
/api/billing/stripe/events/       today served by the vendor CLI instead
/api/<domain>/...                 whatever comes next
```

**Do not add a tunnel per integration.** The routing exists; only the target was wrong.

### 2. The tunnel selector matches on upstream, not on order

`discoverTunnelEndpoint` takes the store endpoint it is looking for and accepts only a
tunnel whose own upstream is that endpoint, compared on host and port so the agent's
spelling does not matter.

**No fallback to the first tunnel when a store endpoint is given.** A wrong endpoint is
worse than none, because none is already handled: the caller refuses the mount and says
so, to the operator through a warning and to the model through its guidance. With no
store endpoint supplied the old behaviour stands, so nothing else that calls it moves.

### 3. Publishing the store becomes an explicit arrangement

Two ways, and the first is what production does:

- **Point the store at a public endpoint.** Production runs no bundled store at all, so
  the sandbox reaches it directly. The self-host compose files document the middle
  case: publish the bundled store on its **own subdomain**, `Host`-only with no path
  rewrite, then point `AGENTA_STORE_ENDPOINT_URL` at it.
- **Run a second tunnel for the store.** Safe now that the selector is precise, and the
  operator's arrangement rather than something the compose file assumes.

## What it costs

**One configuration loses a convenience.** Daytona sandboxes with the **bundled**
in-network store no longer get a durable working directory: the mount is refused, the
operator is warned with the cause named, the model is told the folder is unreachable,
and the run continues on throwaway storage. Nothing is silent. Stated here rather than
discovered later.

**The development API becomes publicly reachable.** Everything Traefik serves is
exposed to whoever has the address, including the web interface. Channel ingress
verifies signatures; not every route does. Development-only, off without a token, and
still a real change in exposure.

**A tunnel provider may interpose a browser interstitial** on free plans for HTML
responses. It does not affect a provider posting to us. Verify against the plan in use
before relying on a browser path through the tunnel.

## What it does not change

- **Nothing in Traefik.** `/api/` already routes, in every compose file.
- **Nothing in production.** No tunnel exists there and none is added.
- **No API code, no new routes, no new configuration the API reads.**
- **The vendor-CLI patterns stay.** Stripe keeps its CLI; Composio keeps its socket in
  development and the real route in production. Neither needs this.

## Done when

- A provider on the internet can post to `/api/...` on this deployment.
- With no token set, nothing is published and no service loops.
- A sandbox mount either gets the store's own tunnel or is refused out loud — never
  another tunnel's URL.
- The two branches that need this can merge it without conflict.
