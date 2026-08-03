# Research: the gaps, verified

The first pass verified five gaps on 2026-07-02. A second pass on 2026-07-14 re-checked them against
the working tree. Three gaps closed in the meantime. This doc leads with that dated re-verification,
then keeps the mechanism detail for the gaps that remain. It does not repeat the sibling research;
read `../model-config/research.md` for how Pi decides a model is available and
`../provider-model-auth/design.md` for the resolver and capability contracts.

## Re-verification (2026-07-14)

### Closed since 2026-07-02

- **The provider-to-env map drift.** The three hand-copied maps are gone. One canonical
  `PROVIDER_ENV_VARS` (`sdks/python/agenta/sdk/agents/capabilities.py:111-125`) is the source of
  truth, with `together_ai -> TOGETHER_API_KEY` and `minimax -> MINIMAX_API_KEY`. `platform/secrets.py`
  and `connections/resolver.py` import it instead of redefining it. A parity regression test pins
  this: `sdks/python/oss/tests/pytest/unit/agents/test_provider_env_vars_parity.py`. (Was Slice 0.)
- **The known-family deployment gate.** `_custom_provider_candidate`
  (`sdks/python/agenta/sdk/agents/platform/connections.py:330-335`) now sets
  `deployment = "direct" if provider is not None else provider_kind`. A custom connection whose kind
  is a known family (OpenRouter, OpenAI) resolves to `direct` and passes Pi's `["direct"]` gate with
  no runner or frontend change. (Was Slice 1, for the known-family case.)
- **The silent model drop.** `allowedModels` reads `c.value ?? c.id`
  (`services/runner/src/engines/sandbox_agent/model.ts:72`), so the allowed set is real for pi-acp.
  `applyModel` raises a typed `ModelNotSettableError` (`model.ts:9`) when a requested model cannot be
  set, and `AGENTA_AGENT_MODEL_STRICT` is wired for every harness, defaulting to true
  (`modelResolutionStrict` at `services/runner/src/engines/sandbox_agent.ts:374`, applied at
  `:1692-1696`). (Was Slice 3a. It shipped strict-by-default directly, not staged, so the planned
  "flip later" step is moot.)

### Still open

- **An arbitrary named OpenAI-compatible connection is rejected before it runs.** A custom
  connection whose kind is not in `PROVIDER_ENV_VARS` (an Ollama gateway, an in-house proxy)
  resolves with `provider=None`. It then dies at one of two gates depending on how the model was
  referenced:
  - A provider-prefixed ref dies pre-resolve in `_check_harness_pre_resolve` via
    `harness_allows_provider` (closed by default, `capabilities.py:281-284`), raising
    `UnsupportedProviderError` (`handler.py:117-119`).
  - A bare slug-named ref dies post-resolve in `harness_allows_deployment`
    (`capabilities.py:299-310`), raising `UnsupportedDeploymentError` (`handler.py:135-137`),
    because a provider-less record keeps `deployment=provider_kind`, which Pi does not list.
- **`ResolvedConnection` carries no slug.** The model (`connections/models.py:162-183`) and its wire
  form `to_wire()` (`:190-207`) carry `provider`, `model`, `deployment`, `credentialMode`, `env`,
  and `endpoint`, but no connection slug. Its docstring even states the harness adapter "never sees
  a vault, a connection, or a slug." Two custom connections with the same kind both resolve to the
  same `provider` and are indistinguishable at the runner (`connections.py:258-259`).
- **The runner writes no Pi `models.json`.** A grep of `services/runner/src/` for `models.json`
  returns zero. A custom base URL and genuinely custom model ids never reach Pi.
- **The runner copies the operator's personal login into a managed run.** `prepareLocalAgentDir`
  (`services/runner/src/engines/sandbox_agent/pi-assets.ts:475-490`) copies the operator's
  `auth.json` and `settings.json` into the per-run dir even for a managed run
  (`credentialMode="env"`) on the local path. The Daytona path deliberately never copies a personal
  `auth.json` (`daytona.ts:168-171`), so the two paths disagree today.
- **The suffix-match fallback can pick the wrong provider.** `pickModel`
  (`model.ts:49-59`) matches on the substring after the first `/`. When two providers advertise the
  same model suffix, it can select the first wrong one.
- **The picker never shows a project's custom-provider models.** `buildModelOptionGroups`
  (`web/packages/agenta-entity-ui/src/DrillInView/SchemaControls/connectionUtils.ts:283-324`) reads
  only the harness capability catalog. `transformSecret` produces a `models` array
  (`web/packages/agenta-entities/src/secret/core/transforms.ts:109`) that the secrets table consumes
  but the model picker does not. **The `VaultConnectionEntry` symbol the first plan named does not
  exist in `web/`.** It was a stale name. The picker work is out of scope here (it moves to
  `model-config` Part 3); this plan touches the UI only to rename the type label (below).

### The UI type label

The visible type "Custom provider" appears at three locations:

- `web/packages/agenta-entity-ui/src/DrillInView/SchemaControls/agentTemplate/ProviderCredentialsSection.tsx:87`
  and `:416`.
- `web/packages/agenta-entities/src/secret/core/types.ts:98`.
- `web/oss/src/components/pages/settings/Secrets/SecretProviderTable/index.tsx:206`.

This plan renames it to "OpenAI-compatible endpoint" at all three.

## Mechanism detail for the open gaps

### Why an arbitrary connection needs a family default

A provider-less custom record has no entry in `PROVIDER_ENV_VARS`, so `provider` stays `None` and no
`*_API_KEY` name is derived. The fix defaults such a record to the OpenAI-compatible family after the
trusted vault record resolves, keeps `deployment="custom"`, and lets Pi's capability table allow the
`(custom, openai-compatible)` pair. The base URL already rides `endpoint`; the key already rides
`env`. The design in [design.md](design.md) Section 1 works out the roles.

### Why the models.json must key by slug

Two custom connections can both resolve to the OpenAI-compatible family, and a provider-less one may
carry no provider at all. Keying `providers` by `resolved_connection.provider` would collide or fail
to produce a Pi provider id. Keying by the connection slug gives each connection a stable, unique Pi
identity. That is the reason the wire gains a slug field. [design.md](design.md) Section 2 and 3
carry the shape and the wire decision.

### Why a managed run must not copy the operator auth.json

`prepareLocalAgentDir` copies the operator's `auth.json` unconditionally. For a managed run, that
personal login state can authenticate the run with an operator subscription or the wrong provider.
The runner must instead build an isolated managed Pi directory that carries only non-credential
settings plus `models.json` with a `"$ENV"` apiKey reference, and leave the raw key in the daemon or
sandbox environment. [design.md](design.md) Section 2 specifies the isolated directory.

## Appendix: the Pi startup-banner leak (related, separately shippable)

This is not a slice here. `isBannerLine` (`services/runner/src/tracing/otel.ts`) strips Pi's startup
banner from replies, but its section-heading regex matches only `Context` and `Skills` and its path
regex requires a `.md` suffix. pi-acp's newer banner adds an `## Extensions` section with `.js`
extension paths, and `stripStartupBanner` strips only a leading contiguous run, so the Extensions
block and the trailing "New version available" notice leak into the reply. The fix extends
`isBannerLine` to match the `Extensions` heading and a `.js` path (or strips the whole banner block).
Track it on its own lane; it does not block this plan.
