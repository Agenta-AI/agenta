# Repo findings: how a trial credential would actually reach a run

Verified against the working tree on 2026-08-02 by a code-reading pass. Every claim
below carries a file and line reference. This answers the "does it fit our runtime"
half of BRIEF.md (questions 4, 5, and part of 3). The OpenRouter API half is still open.

## The short version

Two facts decide the design.

1. **A route already exists that points a Pi run at an arbitrary OpenAI-compatible
   base URL, and it is already tested.** We do not need to build a new path to send
   trial runs through OpenRouter.
2. **That route pins the run to exactly one model, written per run by the runner, not
   chosen by the user.** This is a much stronger answer to the "we cannot limit which
   model they use" worry than expected, with one important limit described below.

## How credential resolution works today

`resolve_connection` lives at `sdks/python/agenta/sdk/agents/platform/resolve.py:95`, not
in `connections.py`. It delegates to `VaultConnectionResolver.resolve`
(`platform/connections.py:560`), which fetches the project's vault secrets over HTTP and
picks exactly one connection for the requested model.

The resolved object is `ResolvedConnection`
(`sdks/python/agenta/sdk/agents/connections/models.py:162`). Its `env` dictionary is the
only channel that carries secrets, and it is deliberately masked in any dump and never
emitted on the wire.

There are exactly two connection modes, `agenta` and `self_managed`
(`connections/models.py:29`). What might sound like a third, "custom", is a different
axis called `Deployment`: `direct`, `custom`, `azure`, `bedrock`, `vertex_ai`
(`connections/models.py:39`).

## How the credential reaches the sandbox

The runner assembles the environment at
`services/runner/src/engines/sandbox_agent/environment-setup.ts:176`, where
`Object.assign(env, plan.secrets)` applies the resolved provider keys.

For Daytona specifically, that local `env` is **not** what reaches the sandbox. The
sandbox gets a separately built map from
`services/runner/src/engines/sandbox_agent/daytona.ts:35-48`, spread into the sandbox
create call at `provider.ts:74`. Only `plan.secrets` and the Pi extension environment
travel. This matters: any new variable a Daytona run needs must ride in the resolver's
`env`, not in the local daemon environment.

One consequence worth flagging separately: `ANTHROPIC_BASE_URL`, which the Claude path
sets into the local `env` at `runtime-policy.ts:85-89`, therefore does not appear to
reach a Daytona sandbox. That should be verified before anyone relies on it.

## Base URL override: only one route exists

I searched the runner and the SDK for `OPENAI_BASE_URL`, `OPENAI_API_BASE`, and
`baseURL`. There are **zero hits**. There is no environment-variable base URL override
for Pi anywhere in the stack.

The only mechanism is a per-run `models.json` file the runner writes, built by
`buildPiModelConfigPlan` at
`services/runner/src/engines/sandbox_agent/pi-model-config.ts:85`. It is hard-gated at
lines 89-94 and applies only when all four hold:

- the harness is Pi (`pi_core` or `pi_agenta`),
- `provider === "openai"`,
- `deployment === "custom"`,
- `connection.mode === "agenta"`.

When it applies, the base URL comes from the per-run wire field `endpoint.baseUrl`
(`services/runner/src/protocol.ts:486`). A missing base URL is a terminal error, never a
silent fallback (`pi-model-config.ts:111-117`).

The emitted document (`pi-model-config.ts:135-147`) looks like this:

```
{ providers: { <slug>: { baseUrl, api: "openai-completions",
                         apiKey: "$OPENAI_API_KEY",
                         models: [ { id: <model> } ] } } }
```

It is written to the local run directory (`pi-assets.ts:658`) or uploaded to
`/home/sandbox/.pi/agent/models.json` on Daytona (`daytona.ts:154-169`). When there is no
plan, the runner deletes any stale file from a reused sandbox (`daytona.ts:243`).

The dialect is fixed: `PiProviderApi = "openai-completions"`
(`pi-model-config.ts:15-16`). That is the OpenAI chat completions API, not the Responses
API. OpenRouter speaks exactly this dialect, so **the proposal's worry about needing a
new API dialect field disappears on this route.**

## The model pinning, and its real limit

For a custom-provider run the runner overrides the requested model entirely
(`environment.ts:1032-1036`):

```
const wantedModel = piModelConfig && piModelConfig.models.length > 0
  ? `${piModelConfig.providerId}/${piModelConfig.models[0].id}`
  : request.model;
```

So the run is pinned to the single model in the plan, using a fully qualified name. The
comment at `environment.ts:1022-1031` explains why the qualified form is required: a bare
name would suffix-match Pi's built-in `openai/<model>` and silently route to
api.openai.com instead of our endpoint.

**The limit, stated plainly.** This is configuration, not a security boundary. The
sandbox is user-controlled. An agent with a shell tool can read `OPENAI_API_KEY` out of
its own environment and call any model at the base URL directly, ignoring `models.json`
entirely. So model pinning stops honest users and the product surface. It does not stop
someone who is trying. The financial bound has to come from the credential itself, which
is why the OpenRouter key limit is the piece that matters.

Two things would each raise this bar, and both are worth pricing in the recommendation:
the Daytona Secrets work (#5277) makes the key value unreadable in the first place, and
an OpenRouter-side model restriction on the key, if one exists, would make the bypass
useless. Whether OpenRouter supports that is still unverified.

## OpenRouter is already a first-class provider here

It appears across the whole stack: the backend provider enums
(`api/oss/src/core/secrets/enums.py:30` and `:52`), the generated Python and TypeScript
clients, the environment-variable maps on both sides
(`sdks/python/agenta/sdk/agents/capabilities.py:127`,
`services/runner/src/engines/sandbox_agent/daemon.ts:149`), the frontend provider list
and icon, and about 540 entries in the curated agent model catalog
(`sdks/python/agenta/sdk/agents/data/pi_models.generated.json`).

Notably, there is **no hardcoded OpenRouter base URL in product code**. On the direct
path the URL comes from Pi's own vendored catalog. On the custom path it comes from the
stored connection.

## The three ways an OpenRouter model can be reached today

**Path A, direct.** A vault `provider_key` of kind `openrouter`. The key lands in
`OPENROUTER_API_KEY` and Pi resolves the model against its own vendored catalog. This
works today and QA exercises it (cell P1 in
`.agents/skills/agent-release-gate/resources/qa_product.py:157`). The base URL is Pi's,
not ours, so we cannot redirect it.

**Path B, custom OpenAI-compatible.** A vault `custom_provider` record with
`kind = "custom"` and `url = "https://openrouter.ai/api/v1"`. The resolver normalizes
this to `provider = "openai"` and `deployment = "custom"`
(`platform/connections.py:268-275`), the key rides `OPENAI_API_KEY`, and the runner
writes the per-run `models.json` with our base URL and our single pinned model. This also
works today, is exercised by QA cell P2 (`qa_product.py:175`), and is pinned by a replay
test with a recorded fixture
(`sdks/python/oss/tests/pytest/integration/agents/test_custom_connection_replay.py:115-164`).

**This is the route a trial credential should take.** It needs no new runner contract,
no new dialect field, and no new base URL mechanism.

**Path C, a trap to avoid.** A `custom_provider` record whose `kind` is `openrouter`
rather than `custom`. The resolver normalizes it back to `deployment = "direct"`
(`platform/connections.py:377-382`), which means the stored base URL is carried on the
resolved connection but **no runner code consumes it**, because the `models.json` builder
requires `deployment === "custom"`. The URL is silently inert. Pinned by
`sdks/python/oss/tests/pytest/unit/agents/platform/test_connections_http.py:222-262`.

## One loose end found along the way

On Path A, `selected_model_id` (`platform/connections.py:250-261`) returns the model
without its `openrouter/` prefix for a direct provider-key candidate. The runner then
recovers it by suffix matching in `pickModel` (`model.ts:49-59`). That works, but it is
the same class of silent collision that `environment.ts:1022-1031` warns about for the
custom path. It is not blocking for this project, since the recommendation uses Path B,
but it is worth an issue.

## What this changes about the proposal

The design proposal in `docs/design/activation-credits/` assumed the runner would need a
new explicit API-dialect field, because its gateway would speak the OpenAI Responses API
and the runner speaks only chat completions. On the OpenRouter route that requirement
disappears: the runner already speaks the dialect OpenRouter uses, over a path that is
already built and tested.
