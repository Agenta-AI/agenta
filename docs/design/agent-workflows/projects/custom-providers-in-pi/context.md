# Context

## Why this exists

A user selects a model and a provider for a Pi agent in the playground. The run should call that
model with that provider's credential. This works for a built-in provider once its `provider_key`
is stored, and, since this plan was first written, it also works for a custom connection whose kind
is a known provider family (a custom OpenRouter or OpenAI record now resolves to `deployment="direct"`
and passes Pi's gate). What still does not work is a **named OpenAI-compatible connection** whose
kind is not a known family: an Ollama gateway, an in-house proxy, any endpoint the user names
themselves. This plan makes that path work for Pi.

The original trigger was narrower. OpenRouter worked when stored as a `provider_key` but was rejected
when stored as a `custom_provider`. That specific inconsistency is fixed. Closing it exposed the
deeper requirement: the vault already lets a user store an arbitrary base URL, key, and model list,
but nothing carries that record through to Pi.

## What is already built (do not rebuild)

This project sits on top of two siblings.

- **`provider-model-auth` (BUILT, PR #4815 to `big-agents`).** It replaced the whole-vault
  credential dump with a deterministic single-connection resolver built from the existing
  `GET /secrets/` catalog (`sdks/python/agenta/sdk/agents/platform/connections.py`). It added the
  `ResolvedConnection` contract (`provider`, `model`, `deployment`, `credential_mode`, `env`,
  `endpoint`), the harness capability table (`sdks/python/agenta/sdk/agents/capabilities.py`), the
  pre-resolve and post-resolve capability checks, and the runner clear-then-apply of provider env.
  Its wire step emits `resolved_connection` on the `/run` contract, carrying `endpoint.baseUrl` and
  the selected model id.
- **`model-config` (DESIGNED, partly built).** It specifies the Pi per-run config write, the
  fail-loud unsettable-model path, and the model-choice surface. The fail-loud model already landed
  in the runner (strict-by-default, typed error). This project implements the `models.json` write.
  The model-choice picker stays with that sibling (Part 3).

## Current state

The gaps and their file references are re-verified in [research.md](research.md), including a dated
2026-07-14 pass that records which closed and which remain. In short:

- Closed since 2026-07-02: the env-var map drift (one canonical `PROVIDER_ENV_VARS`), the
  known-family deployment gate (known kind resolves `direct`), and the silent model drop (strict is
  on by default and raises a typed error).
- Still open: an arbitrary named OpenAI-compatible connection is rejected before it runs; the runner
  writes no Pi `models.json`; the runner copies the operator's personal `auth.json` into a managed
  run on the local path; and `ResolvedConnection` carries no slug, so two custom connections of the
  same kind are indistinguishable at the runner.

## Goals

1. A named OpenAI-compatible connection (arbitrary kind, arbitrary base URL, arbitrary model ids)
   runs on Pi.
2. The connection's slug identifies it end to end: the vault record, the resolver, the wire, and the
   Pi `models.json` the runner writes all agree on the same slug.
3. A custom base URL and genuinely custom model ids reach Pi through its per-run agent dir, local and
   Daytona alike, with no raw secret on disk.
4. A managed run never authenticates with the operator's personal login.

## Non-goals

- Bedrock, Vertex, and Azure consumption on Pi stays fail-loud, exactly as `provider-model-auth` and
  `model-config` already stage it. This project does not wire multi-var cloud credential delivery
  into Pi.
- No vault storage change: no new secret kind, no migration, no `/secrets` write path. This project
  reads the existing `provider_key` and `custom_provider` secrets.
- **Exactly one new `/run` wire field: the connection slug on `ResolvedConnection`.** Everything else
  the runner still derives from `resolved_connection` and `secrets`. (This replaces the first plan's
  "no new wire field" non-goal, which the models.json keying made impossible.)
- The model picker stays as it is in this plan. Its expansion moves to `model-config` Part 3.
- No change to the prompt/completion path. It keeps its own LiteLLM reader of the same vault.

## Constraints inherited from the codebase

- The Python service decides what to run; the runner runs it. The Pi `models.json` write is derived
  inside the runner from `request.secrets` and `resolved_connection`. The wire grows by one field
  (the slug) and no more.
- The runner TypeScript lives at `services/runner/src/`, not `services/agent/src/`. The
  `sandbox_agent.ts` monolith split into `services/runner/src/engines/sandbox_agent/{model,daemon,daytona,pi-assets}.ts`.
