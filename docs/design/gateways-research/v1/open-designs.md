# Open designs

Design questions still open, with what each hinges on. Settled items move to `decisions.md`;
things tried and replaced move to `notes.md`.

Most of this list closed in one pass. What remains needs a product call rather than an
engineering one.

---

## Open

### OD10. The order the concerns arrive in

The gateway owns identity and permissions, governance, secrets, and metering and billing, and
they arrive incrementally (D12). Nothing says in which order.

**Hinges on** what the first version has to prove. The parallel credits and trial work implies
spend control first. The security argument — provider secrets leaving the platform into
agent-controlled sandboxes — implies secret containment first. These are not the same order.

**Blocks the work-package list**, which cannot be sequenced without it.

### OD2. Is a user's own secret the norm or the exception

The mechanism is designed (`secrets.md`): an owner on every secret, and three resolution modes
so an organization can mandate or forbid the shared fallback. The default is not decided.

**Hinges on** whether users bring their own provider secrets or consume an organizational one
under quota. The answer decides how much existing configuration is revisited when user-level
secrets ship.

Not urgent — everything is project-owned today, and D10 keeps the lookup ready either way.

### OD6. The self-hosted OAuth posture

An OAuth flow needs a publicly reachable redirect, and the modern registration mechanism needs
a public HTTPS URL serving client metadata. A firewalled deployment has neither.

Static-credential servers are unaffected. **Hinges on** whether "static secrets work
everywhere, OAuth needs a reachable deployment" is an acceptable documented posture, or whether
a relay is worth building.

### OD11. What a minted gateway token names

Inbound tokens are minted, ephemeral and never stored (D13), and one is minted per target. Two
details remain.

**Does one token name one server, or the whole permitted set?** One per server bounds a leak to
one server. A single token for the run is fewer moving parts. The batch-minting call makes the
first cheap, so this leans one-per-server unless something argues otherwise.

**What the audience claim contains.** The existing signer carries the principal but no target,
so the gateways need an audience so a token minted for one server cannot be replayed against
another. Its exact form is undecided.

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
