# Open designs

Design questions that are still open, with what each hinges on. Settled items move to
`decisions.md`; things that were tried and replaced move to `notes.md`.

Ordered by how much else depends on them.

---

## OD1. New secret kinds — not a new store

**Status: narrowed. There is no new store to build.**

The gateway does not store credentials. It follows the established pattern: **the domain row
holds a `secret_id`, the secrets service holds the material, and the consumer resolves it at
use time.** Webhook subscriptions and SSO providers already work exactly this way — a
dispatcher resolves `secret_id` through the vault service and reads the key off the returned
DTO, and the secret itself never appears on the domain's own responses.

So the question is not "how do we store tokens" but **"which secret kinds do we add."** See
`secrets.md` for the proposal and the shape of the change.

Everything that made this look like a new component — encryption at rest, key management,
scoping, lifecycle — belongs to the secrets service and is already solved there. Adding a
kind touches the enum, a settings DTO, the discriminated union, and its validation branch.

**Still open:** whether the OAuth token set is one kind or two (a static credential and a
grant have different lifecycles), and the naming. Recorded in `secrets.md`.

---

## OD2. User-level secrets and the resolution order

**Status: designed, not implemented.** See `secrets.md`.

The design is settled on paper; what is open is the product default — whether a user
credential overriding a project one is the norm or the exception, and which upstreams should
forbid the shared fallback outright.

---

## OD3. One endpoint or one per MCP server

Either one gateway endpoint whose tool list merges every registered server, with names
namespaced to avoid collisions, or one endpoint per server.

**Hinges on** whether renaming tools is acceptable. Namespacing changes the names the model
sees, which affects prompts and any per-tool permission rules keyed on those names.

Header-based routing in the current MCP revision makes the merged endpoint cheap to
implement, so this is a naming and ergonomics question rather than a routing one.

---

## OD4. Step-up scope handling

A call can demand a permission the user never granted, and required scopes may depend on
the call's own arguments, so they cannot always be pre-granted.

Three options, recorded in `raw/credential-model.md`: over-request at connect time, fail
actionably and send the user back to the dashboard, or pause the run.

**Hinges on** how often it actually fires in practice, which we cannot know before running
real servers. Worth choosing a default now and revisiting with evidence.

---

## OD5. Where the policy plane runs relative to the data path

Carried from `decisions.md` D2. Splitting a thin data plane from a control plane in the API
is the leaning; the cached-decision mechanism is the part still to design.

---

## OD6. Self-hosted OAuth reachability

An OAuth flow needs a publicly reachable redirect URI, and the modern registration
mechanism needs a public HTTPS URL serving client metadata. A firewalled deployment has
neither.

Static-credential servers are unaffected. **Hinges on** whether we accept "static
credentials work everywhere, OAuth needs a reachable deployment" as the documented posture,
or invest in a relay.

---

## OD7. Dead-credential semantics

When a credential is revoked or unrefreshable, does the affected server's tools disappear
from the list or stay and fail? Disappearing is kinder to the model's context but makes the
tool list vary with credential health, which makes list caching harder — and the current
MCP revision explicitly encourages caching list results.

---

## OD8. Spend attribution when a user credential is used

If a call runs on a user's own provider credential, the cost lands on that user's account
rather than the organization's. Metering that records only the principal will attribute
spend to the wrong payer.

**Hinges on** OD2's outcome. If user credentials stay rare this is minor; if they become the
norm for models, the meter has to record which credential paid.
