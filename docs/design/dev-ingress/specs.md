# The development ingress — specs

**Add** a second development tunnel that publishes this deployment's ingress, beside the
one that publishes the object store. Each service is named for what it publishes:
`ngrok-fs` and `ngrok-api`. The store tunnel keeps its behaviour; only its name moves.

Research: [research.md](research.md). Tasks: [tasks.md](tasks.md).

## One package, and why there is no breakdown

**No work packages.** Two edits that only make sense together: the new tunnel, and the
selector that stops the runner picking a tunnel by list order. Landing the tunnel
without the selector is the one combination that breaks something — the runner would
find two tunnels and might hand a sandbox the platform's HTTP API as an object store.

It is also small: two compose files, two env examples, one function, one call site,
three tests.

## What it is for

Anything outside that has to reach this deployment: a platform posting a webhook, or an
authorization server fetching a document we serve.

**Not OAuth redirects.** Those are browser navigations and need nothing — the gateways
research settled that in its `D26`, and it is right (`research.md`).

Three consumers are already known: channels needs platform events; the model and MCP
gateways need the client-identity fetch; the remote-tools work wants to publish a server
URL into a sandbox.

## The target

### 1. Two tunnels, named for what they publish

`ngrok` becomes **`ngrok-fs`** — it publishes the object store, and its name should say
so. A new **`ngrok-api`** service publishes the ingress, forwarding to `traefik:80`.
Same `with-tunnel` profile, same token gate, same quiet exit-0 when no token is set.
`NGROK_API_DOMAIN` pins a reserved domain.

**The store tunnel keeps its behaviour exactly.** Same target, same token gate, same
comments — only the service name changes, and with it the one place that addresses it.
Daytona sandboxes with the bundled store keep their durable working folder.

**The rename has one consequence.** The runner asks a tunnel agent what it publishes, on
that agent's own admin API — which is what `AGENTA_MOUNTS_TUNNEL_API` names, the tunnel
agent's API rather than a tunnel to ours. Nothing sets it, so the runner uses its
compiled-in default, which was `http://ngrok:4040` and is now `http://ngrok-fs:4040`. The
environment variable stays an override. An operator with a stack already up also has an
orphaned `ngrok` container, which `--remove-orphans` clears.

**No variable names the ingress tunnel, and none should.** Nothing in the code discovers
that address: the store tunnel is discovered by the runner, the ingress tunnel is read off
the agent's dashboard once and registered with a provider by hand. `NGROK_API_DOMAIN` pins
the domain so that registration survives a restart, and that is its whole job.

**Every inbound route arrives on its normal path.** `/api/` is already routed in
development, in the self-host compose files, and in production, so no integration needs
a tunnel or a route of its own:

```text
/api/channels/slack/events/       a platform event or interaction
/api/triggers/composio/events/    already the production path
/api/billing/stripe/events/       today served by the vendor CLI instead
/api/<domain>/...                 whatever comes next
```

**Do not add a tunnel per integration.** One endpoint serves all of them.

### 2. Why two services rather than one agent with two endpoints

Two separate services keep the store tunnel's invocation as it is today, which is the
form already proven in this repo, and keep the runner's agent address pointing at an
agent that only ever lists the store. Neither tunnel can be handed the
other's URL.

**The cost is two simultaneous agent sessions.** If the tunnel plan allows only one, the
fallback is a single agent with two named endpoints — and the selector below makes that
arrangement safe. Both compose files say so where an operator will read it.

### 3. The selector matches on upstream, not on order

`discoverTunnelEndpoint` returned **the first https tunnel**, with no check on what it
forwarded to. That was correct only while exactly one tunnel existed. This work adds a
second, so it stops being correct here.

It now takes the store endpoint it is looking for and accepts only a tunnel whose own
upstream is that endpoint, compared on host and port so the agent's spelling does not
matter. **No fallback to the first tunnel when a store endpoint is given** — a wrong
endpoint is worse than none, because none is already handled: the caller refuses the
mount and says so, to the operator through a warning and to the model through its
guidance. With no store endpoint supplied the old behaviour stands, so nothing else that
calls it moves.

With two separate agents this is belt and braces. It is still the fix that makes a
second tunnel safe at all, and the one that makes the single-agent fallback possible.

## What it costs

**The development API becomes publicly reachable** when the tunnel is up. Everything
Traefik serves is exposed to whoever has the address, including the web interface.
Channel ingress verifies signatures; not every route does. Development-only, off without
a token, and still a real change in exposure.

**Two agent sessions**, as above.

**A tunnel provider may interpose a browser interstitial** on free plans for HTML
responses. It does not affect a provider posting to us. Verify against the plan in use
before relying on a browser path through the tunnel.

## What it does not change

- **What the store tunnel does.** Same target, same gate, same comments — the name
  changes and the runner's default address follows it. Nothing else.
- **Nothing in Traefik.** `/api/` already routes, in every compose file.
- **Nothing in production.** No tunnel exists there and none is added.
- **No API code, no new routes, no new configuration the API reads.**
- **The vendor-CLI patterns.** Stripe keeps its CLI; Composio keeps its socket in
  development and the real route in production.

## Done when

- A provider on the internet can post to `/api/...` on this deployment.
- A Daytona sandbox with the bundled store still mounts its durable folder — the
  regression check that matters most.
- With no token set, neither tunnel publishes anything and neither service loops.
- A sandbox mount gets the store's own tunnel, never the ingress one.
- The two branches that need this can merge it without conflict.
