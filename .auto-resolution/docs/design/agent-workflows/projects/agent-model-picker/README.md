# Agent playground: provider + model picker (harness-aware, inspect-driven)

Make the **agent** playground pick a **provider + model** the way the completion/chat playground
does, but **filtered to what the selected harness can actually reach**, with an explicit
**Agenta-auth vs self-managed** choice and a **connection picker** for the credential. The
per-harness reach (providers, models, connection modes) is published by the agent's `/inspect`
response and the frontend renders from it.

## The shape in one paragraph

`/inspect` already publishes `meta.harness_capabilities` (per harness: `providers`,
`deployments`, `connection_modes`, `model_selection`). This project **adds a per-provider model
list** to that surface (Pi: the vault-reachable providers' model ids; Claude: its alias list), and
**rewires the frontend to render from `/inspect`** instead of the current static hardcoded copy. The
model picker becomes one unified control (selecting a model sets both provider and model id),
filtered to the harness. The credential is chosen with a clear **Authentication** toggle — *Agenta*
(managed: pick the project-default or a named connection from the vault) or *Self-managed* (the
harness uses its own login; Agenta injects nothing). The connection rides in `model_ref.connection`
inside the config the playground already sends; no new request field and no new vault route.

## What already exists (do not rebuild)

The parent [../provider-model-auth/](../provider-model-auth/) project (PR #4815, **merged** to
`big-agents`) already shipped the backend and a *minimal* form:

- `ModelRef` (`provider` + `model` + `params` + `connection`) in the agent config, coerced from a
  bare string for back-compat.
- A connection resolver that reads the existing `GET /secrets/` and injects **one** least-privilege
  credential (replacing the whole-vault dump).
- `/inspect` `meta.harness_capabilities` (the per-harness `providers`/`deployments`/
  `connection_modes`/`model_selection` table) + server-side fail-loud reject.
- A minimal connection form: a grouped model picker (unfiltered), a separate free-text/select
  Provider field, a connection-mode select, a free-text slug, and a raw-JSON escape hatch.

This project is the **playground UX + the inspect model-list addition** that the parent explicitly
deferred.

## Read in this order

1. [context.md](context.md): why this exists, the exact merged state with `file:line`, goals,
   non-goals, the three decisions taken.
2. [research.md](research.md): the precise findings (inspect, the capability table, the model
   picker, the connection form, vault listing, the completion/chat pattern), with citations.
3. [plan.md](plan.md): the phased slices, backend through frontend, with the test strategy.
4. [status.md](status.md): current state, decisions, open items, risks. Source of truth.

## Related work

- [../provider-model-auth/](../provider-model-auth/): the backend `ModelRef`/connection resolver
  and the minimal form this project builds on.
- [../model-config/](../model-config/): how a requested model becomes settable on each harness (the
  Pi `auth.json`/`models.json` write, the custom-endpoint consumption). Out of scope here.
- [../harness-capabilities/](../harness-capabilities/): owns the general capability-table mechanism;
  this project extends the `providers`/`models` entries it consumes.
