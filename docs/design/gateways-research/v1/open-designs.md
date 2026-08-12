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

### OD6. OAuth on a deployment with no public IP — RECOMMENDED, see D26

**The framing was wrong and that mattered.** This was written up as a firewall problem. It is
not: the constraint is having no address the public internet can name — `localhost`, a home
network, a corporate LAN.

Splitting it by *who* needs to reach the deployment collapses most of it. The **browser** needs
the redirect, and the browser is usually on the same network as the deployment, so a private
address works. The **authorization server** needs to fetch a client identity document, and that
fetch comes from the internet — which is the part that genuinely breaks, and it is solved by
registering outbound instead, using the older mechanism that inverts the direction.

Only a deployment whose *browser* is also elsewhere needs the hosted code relay. D26 carries the
three situations, the relay's mechanism, and why holding the code is safe.

To establish at implementation time, none of it blocking: which authorization servers accept a
private-address redirect target; whether the older outbound registration is still accepted by the
servers we care about; the relay's retention window; and how an abandoned flow is collected.

Belongs to the OAuth wave, not the first one.

### OD12. Should a clamped parameter be silent — CLOSED

**No. A governance ceiling rejects, visibly. It never silently lowers a value.** Settled as D25;
the evidence is below, since the question was to be answered by looking at comparable gateways
rather than by assertion.

**The question conflates two different collisions**, and the ecosystem answers them differently.

*A stated value colliding with a physical limit.* Asking for more output tokens than the context
window can hold is impossible rather than forbidden. Here the direction of travel is to clamp:
the OpenAI-compatible reading treats the output ceiling as an upper bound rather than a demand,
and inference servers that reject instead are being asked to clamp so that callers who set a
safety cap are not punished for it. This case is the upstream's to handle, not ours.

*A stated value colliding with an operator's ceiling.* This is what our ceilings are, and every
comparable gateway rejects. A managed API gateway's token-limit policy answers a rate breach with
"too many requests" and an exhausted quota with "forbidden" — two distinct statuses, neither of
them a quiet edit. Another gateway's prompt-guard plugin answers a denied or non-allowed prompt
with "bad request", and its size limiter rejects the whole request rather than truncating it.

**Why that split is right for us and not merely conventional.** A governance ceiling exists to be
accounted for. Silently lowering a value produces a run whose output differs from what was asked
for, with nothing in the result explaining why — and the compliance claim the ceiling exists to
support becomes unverifiable from the caller's side. Worse, the caller cannot tell a policy
ceiling from a bad prompt, so the failure is invisible exactly where it is most expensive.

The objection that rejecting "breaks a harness that did nothing wrong" is real and is answered by
the error rather than by silence: the denial names the ceiling, the value asked for and the value
allowed, so the caller can retry correctly on the first attempt.

**Consequence for the north ports.** Both surfaces have externally-fixed error shapes, so this
needs a denial that fits inside them and still carries the three facts above. That is
`contract.md`'s open item on expressing a policy denial, and this closes half of it — the content
is settled even where the envelope is not.

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
