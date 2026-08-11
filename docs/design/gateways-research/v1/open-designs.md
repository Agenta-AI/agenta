# Open designs

Design questions still open, with what each hinges on. Settled items move to `decisions.md`;
things tried and replaced move to `notes.md`.

Most of this list closed in one pass. What remains needs a product call rather than an
engineering one.

---

## Open

### OD10. What is in the first increment of each gateway

Both gateways are being built. What is open is what each one does first, and the checklist in
`scope-checklist.md` is where that gets marked.

The MCP side has a shape: **the first checkpoint has no OAuth**, and OAuth becomes its own
checkpoint carrying consent, step-up and callback reachability together — the last one so it can
be tested in development at all. With the static secret kind also deferred, the first
checkpoint's reachable targets are our own servers and the fakes (D23), which is a complete set
rather than a gap.

**Blocks the work-package list**, which cannot be sequenced without it.

### OD2. Is a user's own secret the norm or the exception — parked

User-owned secrets are not implemented, so this waits until they are. The mechanism is designed
in `secrets.md` and the lookup already takes an owner (D10), so nothing is foreclosed.

Per-endpoint tokens arrive with this, not before.

### OD6. How an OAuth redirect reaches a firewalled deployment

An OAuth flow needs a redirect the user's browser can reach, and the modern registration
mechanism needs a public HTTPS URL serving client metadata. A firewalled deployment has neither.

**The three existing relay patterns do not solve it**, and `scope-checklist.md` records why: two
are server-to-server event delivery, one of those working only because the provider's own SDK
offers a subscribe call, and a browser redirect cannot travel down an outbound socket. Only
ngrok produces a reachable URL, and it is development-only by design.

**The real options:** a hosted relay that receives the redirect and holds the code while the
deployment polls outward for it, which keeps the deployment outbound-only but reintroduces a
cloud dependency; or documenting that OAuth-protected servers need a reachable deployment while
static-credential servers work everywhere.

Belongs to the OAuth checkpoint, not the first one.

### OD12. Should a clamped parameter be silent

A ceiling can reject the call or quietly lower the value. Silent clamping keeps a run working
and hides that it happened; rejecting is honest and breaks a harness that did nothing wrong.

**To establish** by looking at what comparable gateways do, rather than by assertion.

---

## Closed in this pass

- **MCP endpoint shape** — one URL per server, namespaced identifier, transparent pass-through
  (D16). A merged endpoint with renamed tools was rejected.
- **Step-up scopes** — scope selection at connect time plus an interaction at step-up (D17).
  Failing with an error was rejected; it is the same situation as a missing connection, where we
  already do not fail.
- **Dead secrets** — tools stay listed and the call fails (D18). Hiding tools was rejected.
- **New secret kinds** — `oauth_provider` and `oauth_grant`, two kinds rather than sub-kinds of
  one (D14). No static MCP kind in this scope, and no kind at all for the inbound credential.
- **The inbound credential** — minted, ephemeral, never stored, using the signer that already
  exists (D13).
- **Embeddings in the model registry** — deferred with the whole evaluator path, which is out of
  the current scope (D15).

## Closed earlier

- **Where the policy plane runs**, and **how a policy decision is cached** — both settled by the
  parallel credits design (`raw/related-work.md`).
- **The token store** — there is none; the gateways reference secrets by id (D3).
- **Spend attribution mechanism** — `secret_origin` carries it.
- **The model call-site count** and **whether the routing library runs in-process** —
  `raw/model-call-sites.md`.

## Not open questions

Two items previously listed here as prerequisites were neither prerequisites nor design
questions. Both are **outcomes the gateway enables**, and `notes.md` records why the reasoning
was backwards.
