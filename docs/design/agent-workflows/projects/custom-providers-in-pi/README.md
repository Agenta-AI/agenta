# OpenAI-compatible models on the Pi harness

Let a user run an OpenAI-compatible model through a Pi agent. The user stores a connection (a base
URL, a key, and one or more model ids), picks that connection and a model in the playground, and
the run reaches the model. The connection's **slug** is its identity from the vault, through the
resolver, across the wire, into the Pi config the runner writes. Two connections that speak the same
protocol stay distinct because their slugs differ.

## What changed since the first plan

This plan was written on 2026-07-02 and revised on 2026-07-14 after code review. Three of the
original slices landed in the meantime, and six review comments reshaped the rest. See
[status.md](status.md) for the decision log and [research.md](research.md) for the dated
re-verification.

Landed already:

- The three provider-to-env maps are now one canonical `PROVIDER_ENV_VARS`
  (`capabilities.py:111-125`), with `together_ai -> TOGETHER_API_KEY` and `minimax`. The old
  Slice 0 is done.
- A custom connection whose kind is a known provider family resolves to `deployment="direct"`
  (`connections.py:330-335`) and passes Pi's `["direct"]` gate. The old Slice 1 is done for known
  families.
- The runner fails loud on an unsettable model by default: `allowedModels` reads `c.value ?? c.id`
  (`model.ts:72`), `AGENTA_AGENT_MODEL_STRICT` is wired for every harness and defaults to true
  (`sandbox_agent.ts:374`), and `applyModel` raises a typed `ModelNotSettableError`. The old
  Slice 3a is done, and it shipped strict-by-default directly, so the staged "flip later" step is
  moot.

## The gap that remains

A connection whose kind is **not** a known provider family (an Ollama gateway, an in-house proxy,
any named OpenAI-compatible endpoint) still fails before it runs. The runner also never writes a Pi
`models.json`, so a custom base URL and a genuinely custom model id never reach Pi. This plan closes
that path.

## The revised slices

1. **Service: connection identity and gate.** Add `slug` to `ResolvedConnection` and its wire form.
   A provider-less or unknown-kind custom connection resolves to the OpenAI-compatible family with
   `deployment="custom"`, and Pi's capability table allows the `custom` deployment. The known-family
   `direct` path stays as it landed.
2. **Runner: teach Pi the connection.** A model-config builder writes `models.json` keyed by
   `providers[<slug>]`, dialect `openai-completions`, `apiKey` as a `"$ENV"` reference, and the one
   selected model. The runner creates an isolated managed Pi directory (no operator `auth.json` on a
   managed run) on both the local and Daytona paths, and sets the exact `<slug>/<model>` id.
3. **UI: rename the type label.** Rename the visible type from "Custom provider" to
   "OpenAI-compatible endpoint" at the three UI locations.

The model picker expansion is out of scope. It moves to the `model-config` sibling (Part 3).

## Read in this order

1. [context.md](context.md): why this exists, what the siblings own, goals and non-goals.
2. [research.md](research.md): the gaps with verified file and line references, and the dated
   2026-07-14 re-verification of what closed and what remains.
3. [design.md](design.md): the contracts, each field classified by semantic role (the
   `design-interfaces` pass on paper).
4. [plan.md](plan.md): the sliced plan, in dependency order, with tests.
5. [status.md](status.md): current state, decisions, risks, next steps.

## Builds on

- [../provider-model-auth/](../provider-model-auth/): the connection resolver, the
  `ResolvedConnection` contract, and the harness capability table. This plan adds one field to that
  contract (the slug) and one allowed deployment to Pi's row.
- [../model-config/](../model-config/): the Pi per-run `models.json` write and the fail-loud model
  path. This plan implements the write and inherits the fail-loud model that already landed. The
  picker work (Part 3) stays with that sibling.
