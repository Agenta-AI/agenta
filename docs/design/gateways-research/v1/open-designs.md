# Open designs

Design questions still open, with what each hinges on. Settled items move to `decisions.md`;
things tried and replaced move to `notes.md`.

Most of this list closed in one pass. What remains needs a product call rather than an
engineering one.

---

## Open

### OD10. What is in the first increment of each gateway

Both gateways are being built. What is open is what each one does first.

`scope-checklist.md` lists every item for the LLM gateway, the MCP gateway, and the shared
policy core, so each can be marked in, out, or ordered.

One thing that narrows it: **containment is not a separate choice.** Refusing a call on
balance requires knowing who is calling, which requires the minted token, which means the
sandbox no longer holds a provider secret. Spend control cannot be built without containment
falling out of it; the reverse is not true.

**Blocks the work-package list**, which cannot be sequenced without it.

### OD2. Is a user's own secret the norm or the exception — parked

User-owned secrets are not implemented, so this is deferred until they are. The mechanism is
designed in `secrets.md` and the lookup already takes an owner (D10), so nothing is foreclosed
by leaving it open.

### OD6. Which existing relay pattern carries the OAuth callback

An OAuth flow needs a reachable redirect, and the modern registration mechanism needs a public
HTTPS URL serving client metadata. A firewalled deployment has neither.

**This is not a new problem and no relay needs inventing.** The codebase already solves the
same shape three ways, listed in `scope-checklist.md`: a provider-side relay with a routing key
so many developers share one registered webhook; a socket tunnel that delivers over a WebSocket
in development while the registered URL stays a placeholder; and an optional ngrok container,
gated on a token, present in the development compose files and absent from the production ones.

**Hinges on** which shape fits. The socket pattern needs no inbound reachability at all, which
is the constraint a firewalled deployment actually has.

### OD11. What the token carries beyond the principal

The token itself is not new: a 15-minute HS256 JWT carrying user, project, workspace and
organization, verified by decode with no database read, and already minted per run by the
workflow invoke prelude (D13).

What is open is the **target**, since the payload says who you are and nothing about what you
may reach.

**Does the permitted set ride the token?** Putting the model, the tools and the caps in the
payload keeps verification to a signature check, which is what makes the hot path cheap. The
cost is that anything signed is frozen until expiry, so revoking a permission mid-run does not
take effect until the next mint. At a 15-minute expiry that window is bounded but real.

**One token per target, or one per run?** One per target bounds a leak to one target, and
batch-minting makes it nearly free.

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
