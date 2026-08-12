# The development ingress — research

What already exists, checked against the code and the deployment repository rather
than inferred. Two claims in this project's first drafts were argued from what a
value looked like and both were wrong, so every statement here names its source.

## The distinction that decides everything: who has to reach us

| direction | example | needs a public address? |
| --- | --- | --- |
| a provider calls us | Slack posts an event or a button click | **yes** |
| an authorization server fetches a document from us | the newer OAuth client-registration mechanism reads a client-identity URL | **yes** |
| a browser is sent back to us | any OAuth redirect after consent | **no** |

The third row is the one people assume needs a tunnel. It does not. A redirect is a
browser navigation: the user is already looking at our interface, so whatever address
got them there is an address their browser reaches, and the authorization server never
fetches it.

**The gateways research reached this independently and closed it** — its `D26` and
`OD6` say the redirect needs nothing built, and they are right. So this work is an
**inbound-delivery** change. OAuth benefits only in the one case where the
authorization server itself fetches something from us.

## Three patterns already carry inbound events in development

None of them is reusable for an arbitrary provider, and each is worth knowing so
nobody proposes it again.

| what | mechanism | public URL? |
| --- | --- | --- |
| Stripe | the vendor CLI: `listen --forward-to http://api:8000/billing/stripe/events/` | no |
| Composio | `dispatcher_composio.py` subscribes over Composio's **own** WebSocket and forwards to the local ingress, HMAC-signed with the real secret so the true signature path runs | no |
| ngrok | a real tunnel — pointed at `seaweedfs:8333`, for remote sandbox mounts | yes, but only for the store |

The Composio dispatcher describes itself as the `stripe listen` equivalent. Both
depend on the provider offering a subscribe call. **An arbitrary platform offers
nothing equivalent**, which is why a tunnel is the only general answer.

Stripe's CLI runs in production too. Composio in production uses the real public
route. So both patterns are live, and a public inbound route is already normal.

## What production actually does

From the deployment repository, which is **not in this tree** and is the authority on
public URLs.

- **One public host**, `TRAEFIK_DOMAIN`, with an optional alias. `/` web, `/api/` api,
  `/services/` services, `/m` mobile. TLS per host.
- **`/api/` is routed and stripped**, and the api service sets `SCRIPT_NAME=/api`.
- **No `seaweedfs`, no `ngrok`, no Composio dispatcher.** The store is real S3.

So the tunnel is a development stand-in for a domain. Production needs none: the store
is already public and the platform is already on a domain.

## The API already composes its own public URLs correctly

`entrypoints/routers.py` creates the app with `root_path="/api"`, unconditionally, and
Starlette's `Request.base_url` builds its path from `app_root_path`. So
`request.base_url` is `<scheme>://<host>/api/`, which matches the public shape
production serves.

**Consequence:** anything the API hands out — a platform manifest, a redirect address,
a server URL — is correct with no configuration, *provided the request arrived on the
public host*. That is the whole argument for a reserved domain over a rotating one:
addresses we give a provider are registered on their side, once.

## The store cannot share one host by path

S3 SigV4 signs the canonical request path, so a prefix a proxy strips invalidates
every request. The self-host compose file already records this in its own words — its
store router is `Host`-only, *"which SeaweedFS S3 SigV4 requires"* — and publishes the
store on its own subdomain with `AGENTA_STORE_TRAEFIK_ENABLE` and
`AGENTA_STORE_DOMAIN`.

So: subpaths within the platform host, a separate host for the store. Production uses
each where it belongs.

## The store bucket is configuration, not a constant

`AGENTA_STORE_BUCKET`, and the defaults disagree: the API falls back to
`agenta-store`; the self-host compose passes the API an empty default while giving
SeaweedFS `agenta-store`. `AGENTA_STORE_NAMESPACE` exists as well. Any routing rule
written against a literal bucket name is wrong by construction.

## The tunnel is already conditional

`environment.ts` consults the tunnel only when `storeReachableFromSandbox()` is false,
and that returns false only for a bare compose service name, `localhost`, `.local`, or
a private range. A public store hostname means the tunnel is never asked for.

## The defect this uncovered

`discoverTunnelEndpoint` returns **the first https tunnel**, with no check on what it
forwards to:

```ts
const https = tunnels.find((t) => t.proto === "https" && !!t.public_url)?.public_url;
```

Correct only while exactly one tunnel exists and it happens to be the store's. Add a
second and the runner may hand a sandbox the platform's HTTP API as an object store —
a failure far from its cause.

**This stops being hypothetical the moment a second tunnel exists**, which is what this
work adds. A third is already designed: the remote-tools-delivery specs propose reusing
this same infrastructure to publish an MCP server URL into a sandbox.
