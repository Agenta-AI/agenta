# Open designs

Design questions still open, with what each hinges on. Settled items move to `decisions.md`;
things tried and replaced move to `notes.md`.

Grouped by who decides. Within each group, ordered by how much else depends on the answer.

---

## Prerequisites — neither is a design question

Both block work rather than shape it. They are recorded here because they gate everything
below.

**The secrets read surface is not safe.** The read route returns plaintext material to any
caller holding the view permission, and the agent path resolves straight through it, past the
gates. Every claim here assumes resolution through the secrets service is safe. Parallel work
on bring-your-own secrets names the fix as its own first task, so coordinate rather than fix it
twice. See `open-reviews.md` OR14.

**One handler sets provider keys as module-level state.** One tenant per process makes it
survivable today. A shared gateway process makes it a cross-tenant leak. Convert it before
anything shares a process. See OR13.

---

## Group A — decidable without a product call

### OD3. One MCP endpoint, or one per server

Either one endpoint whose tool list merges every registered server, with names namespaced
against collisions, or one endpoint per server.

**Hinges on** whether renaming tools is acceptable. Namespacing changes the names the model
sees, which affects prompts and any per-tool rule keyed on a name.

Header routing makes the merged form cheap, so this is an ergonomics question, not a routing
one. **Most depended-on item in this group** — it decides what an agent's MCP configuration
looks like.

### OD4. Step-up scope handling

A call can need a permission the user never granted, and the required scopes can depend on the
call's own arguments, so they cannot always be pre-granted.

Three options: over-request at connect time, fail actionably and send the user to the
dashboard, or pause the run. The specification prefers least privilege with incremental
step-up; an agent platform may reasonably prefer fewer interruptions.

**Hinges on** how often it fires in practice, which we cannot know before running real
servers. Choose a default now and revisit with evidence.

### OD9. Do embeddings share the model registry

Two callers use embeddings rather than chat (`raw/model-call-sites.md`). They share the secret
and the provider with chat. They differ in request shape and in what a meter records.

**Hinges on** whether one registry entry can carry both modalities without a branch at every
use, or whether a second entry kind is cleaner.

### OD7. Dead-secret semantics

When a secret is revoked or cannot refresh, do that server's tools disappear from the list, or
stay and fail?

Disappearing is kinder to the model's context. It also makes the tool list vary with secret
health, which fights the list caching the current protocol revision encourages.

### OD1. One new secret kind, or two

Narrowed, not closed. The proposal is two — a static kind and a grant kind — because they have
different lifecycles and because a grant is not MCP-specific. The single-kind alternative is
recorded in `secrets.md`.

**Coordinate before deciding.** The bring-your-own-secrets track is adding kinds for sandbox
providers and the gateway provider key to the same table. Design the kinds once.

---

## Group B — needs a product decision

### OD10. The order the concerns arrive in

D12 gives the gateway all six concerns and says they arrive incrementally. Nothing says in
which order.

**Hinges on** what the first version must prove. The parallel efforts imply spend control
first. The security argument implies secret containment first. These are not the same order.

### OD2. Is a user secret the norm or the exception

The mechanism is designed (`secrets.md`); the default is not. Is `user_optional` the norm and
`project_only` the exception, or the reverse?

**Hinges on** whether users bring their own provider secrets or consume an organizational one
under quota. Both are implementable. The answer decides how much existing configuration is
revisited when user-level secrets ship.

### OD6. The self-hosted OAuth posture

An OAuth flow needs a publicly reachable redirect, and the modern registration mechanism needs
a public HTTPS URL serving client metadata. A firewalled deployment has neither.

Static-credential servers are unaffected. **Hinges on** whether "static secrets work
everywhere, OAuth needs a reachable deployment" is an acceptable documented posture, or whether
a relay is worth building.

---

## Closed since the last revision

- **Where the policy plane runs.** Settled by the parallel credits design: its own process,
  from the same image and codebase, with its own workers and stream timeouts, so two writes
  commit in one local transaction. An internal HTTP hop is rejected because it adds a network
  dependency to every stream. See `raw/related-work.md`.
- **How a policy decision is cached.** The signed run token carries it. Same source.
- **The token store.** There is none; the gateways reference secrets by id (D3).
- **Spend attribution mechanism.** `secret_origin` carries it. Only the meter key remains, and
  that belongs with OD10.
- **The model call-site count** and **whether the routing library runs in-process.** Both in
  `raw/model-call-sites.md`.
