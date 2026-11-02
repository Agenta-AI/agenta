# The proxy and how it is routed

The bridge does not ship a proxy. It expects one, and this page says what it has to be.
The reference implementation is LiteLLM, an open source service that speaks the OpenAI
chat completions dialect, holds real provider credentials, and issues its own virtual
keys. Any service with the same properties would do. Deployment itself (compose files,
secret storage, certificates) is the operator's, and none of it lives in this repository.

## What the proxy must provide

| Capability | Why the bridge needs it |
| --- | --- |
| OpenAI-compatible chat completions | It is the request shape the runner already emits, which is what makes the seeded connection an ordinary custom provider connection |
| Virtual keys with a spend ceiling | The ceiling is the grant. It is the only thing that bounds one organization's total spend |
| A model allowlist per key | An explicit list, always. An omitted list means any model, and an empty list means none |
| Per-key concurrency and rate limits | See [design.md](design.md#per-key-concurrency-and-throughput-caps) |
| A key alias, unique | The bridge sets it to the organization id, which is what makes minting idempotent |
| Key metadata the key holder cannot change | The bridge stamps the organization id and an origin marker there. It is the unforgeable side of any later operator-side inspection |
| Teams with their own budget ceiling | Every minted key joins one team whose ceiling is the program's total exposure bound |
| Block and unblock a key, immediately and reversibly | The bridge blocks a key whose vault row failed to write. An operator blocks a key that is being abused |
| Per-key spend records | The accounting record for as long as the bridge runs |
| Issuance upper bounds | Configured caps on what any key may be issued with, so a policy payload cannot mint a key larger than the proxy allows |

Two configuration properties matter as much as the capabilities:

- **Budget enforcement must fail closed.** If the proxy's own database is unreachable, its
  default is usually to keep serving. That serves unmetered calls on the operator's
  credential. Configure it to refuse.
- **One instance, or a shared counter.** Budget enforcement is only sound across instances
  when they share spend state. Two unsynchronized instances each admit against their own
  view of a key's spend, which breaks the grant.

## Two addresses, one service

The bridge holds two URLs for the same proxy, and they are not interchangeable.

`PROXY_PUBLIC_URL` is stored on the seeded connection. A sandboxed run dials it from
outside the deployment's network, so it must be reachable from wherever sandboxes run.

`PROXY_ADMIN_URL` is the proxy's address on the private network. The minting client dials
it, so the master key never crosses the public edge.

The split exists because the public surface should be the inference paths and nothing
else. Publish the exact paths (chat completions, and the model probe the harness makes),
never a prefix: a prefix exposes the management routes that mint and delete keys. The
admin routes stay reachable on the private network alone.

## Where the public surface lives

Two routing shapes work, and the operator picks one per deployment.

**A path on the API host.** The proxy sits behind a path on the host the deployment
already serves, and the reverse proxy strips the prefix before the request reaches it.
Nothing new is provisioned: no DNS record, no certificate.

**A dedicated host.** The proxy gets its own hostname, serving the same paths bare. This
costs one DNS record and certificate coverage for the name.

They differ in exactly one property, and it only matters when the sandbox platform hides
credentials by scope. Daytona scopes a sandbox secret to an exact host, not to a path. On
a shared host, a secret scoped to that host is offered on every request the sandbox makes
to it, so a process inside the sandbox could in principle get its own organization's
virtual key echoed back by an unrelated endpoint on the same host. A dedicated host serves
nothing but the proxy, so no such endpoint exists.

Two consequences. A deployment on the path shape must ensure no endpoint on that host
echoes request headers or arbitrary request content back in a response. And the residual
exposure, if it happened, is one organization's own remaining grant, on one model, against
one proxy, with the vault read already closed.

Whichever shape is used, strip the proxy's own response headers at the edge. They can name
the upstream route the call was forwarded to, including operator-side identifiers, and
that response reaches the sandbox. The header names have to be enumerated, and the list
has to be re-checked whenever the proxy is upgraded.

## The seeded URL must be HTTPS

`effective_endpoint` rejects any connection base URL that is not absolute HTTPS
(`sdks/python/agenta/sdk/agents/connections/endpoints.py`, "model connection endpoint must
be an absolute HTTPS URL"). There is no override and no local exception.

This is a real constraint on local development. A proxy on `http://localhost` cannot be
seeded, because the resolver refuses the connection before any call is made. Put a
tunnel with a real certificate in front of it, and seed the tunnel's URL.

## What the sandbox sees

The virtual key is a credential, so the run path treats it as one. On Daytona, secrets are
substituted at the network edge: the sandbox environment holds a placeholder, and Daytona
swaps in the real value for one allowed host. Files, environment variables, and process
memory inside the sandbox never contain the value, so an agent that prints its environment
or greps its own disk finds the placeholder.

That controls reading, not spending. A run inside a live sandbox can still spend its own
organization's grant, for example by scripting many calls. Spending is bounded by the
grant, the per-key limits, and the team ceiling. Those bounds are the security model; the
hiding is defense in depth on top of them.
