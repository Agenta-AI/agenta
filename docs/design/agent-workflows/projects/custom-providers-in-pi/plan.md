# Plan

The goal is a named OpenAI-compatible model running through a Pi agent, with the connection slug as
its identity end to end. Three of the first plan's slices already landed. The rest is three slices in
dependency order, each independently shippable, each with tests. The banner-leak appendix stays a
separate lane.

## Landed already

- **Env-var map (old Slice 0).** One canonical `PROVIDER_ENV_VARS`
  (`sdks/python/agenta/sdk/agents/capabilities.py:111-125`) with `together_ai -> TOGETHER_API_KEY`
  and `minimax`. Parity test: `sdks/python/oss/tests/pytest/unit/agents/test_provider_env_vars_parity.py`.
- **Known-family deployment gate (old Slice 1).** `_custom_provider_candidate`
  (`sdks/python/agenta/sdk/agents/platform/connections.py:330-335`) resolves a known-family custom
  connection to `deployment="direct"`, which passes Pi's `["direct"]` gate.
- **Fail-loud model (old Slice 3a).** `allowedModels` reads `c.value ?? c.id`
  (`services/runner/src/engines/sandbox_agent/model.ts:72`); `applyModel` raises a typed
  `ModelNotSettableError` (`model.ts:9`); `AGENTA_AGENT_MODEL_STRICT` is wired for every harness and
  defaults to true (`sandbox_agent.ts:374`, applied at `:1692-1696`). This shipped strict-by-default
  directly, so the first plan's staged "flip to strict later" step (old Slice 3b) is moot.

## Slice 1: connection identity and gate (service)

Give a named OpenAI-compatible connection an identity and let it through Pi's gate.

- Add `slug` to `ResolvedConnection` (`connections/models.py:162-183`) and its wire form `to_wire()`
  (`:190-207`). Update the docstring, which currently states the adapter never sees a slug. The slug
  is the connection's identity, not a secret.
- Resolve a provider-less or unknown-kind custom connection to the OpenAI-compatible family with
  `deployment="custom"`, defaulting the family after the trusted vault record resolves. No stored
  schema change.
- Add the `custom` deployment to Pi's capability row, paired with the OpenAI-compatible protocol, so
  `harness_allows_deployment` (`capabilities.py:299-310`) and the pre-resolve provider check
  (`capabilities.py:281-284`) let a named connection through instead of raising
  `UnsupportedProviderError` / `UnsupportedDeploymentError` (`handler.py:117-119`, `:135-137`).

The role analysis is in [design.md](design.md) Sections 1 and 3.

Tests:

- Resolver unit tests: the slug rides the wire; an Ollama-style record (unknown kind, base URL, key)
  resolves to `deployment="custom"` and the OpenAI-compatible family and passes the Pi gate; a
  known-family record still resolves `direct` and is unchanged.
- A wire golden test for `ResolvedConnection` if one exists (the runner mirrors the wire in
  `protocol.ts` with a shared golden; update both sides and the golden together).

## Slice 2: teach Pi the connection (runner)

Write the Pi config and set the exact model.

- A pure model-config builder returns `{ files, exactModelId }`. `files` holds `models.json` keyed by
  `providers[<slug>]`, dialect `openai-completions`, `apiKey` as a `"$ENV"` reference, and the one
  selected model. `exactModelId` is `<slug>/<model>`. The shape and its role analysis are in
  [design.md](design.md) Section 2.
- Write `models.json` into the per-run Pi agent dir, local and Daytona alike. Make "the run carries a
  resolved provider connection" a reason to create and point at that dir, alongside skills and a
  system prompt.
- Build an isolated managed Pi directory for a managed run (`credentialMode="env"`): non-credential
  settings plus `models.json` only, never the operator's `auth.json`. This fixes the local path
  (`pi-assets.ts:475-490` copies it today) to match the Daytona path (`daytona.ts:168-171`).
- Pass `exactModelId` to `setModel`, bypassing the suffix-match fallback in `pickModel`
  (`model.ts:49-59`) that can pick the wrong provider.

All new inputs ride the slug added in Slice 1 plus the existing `resolved_connection` and `secrets`.

Tests:

- Builder unit tests: the content keys by slug, uses `openai-completions`, references `"$ENV"` and
  never writes a raw secret to disk, and returns the exact `<slug>/<model>` id.
- Managed-dir isolation test: a managed run's Pi dir has no operator `auth.json`.
- Daytona parity: the same `models.json` reaches the sandbox and the key reaches the sandbox env.
- Live acceptance (llm_required): a connection with a custom base URL and a custom model id runs.

## Slice 3: rename the UI type label (frontend)

Rename the visible type "Custom provider" to "OpenAI-compatible endpoint" at three locations:

- `web/packages/agenta-entity-ui/src/DrillInView/SchemaControls/agentTemplate/ProviderCredentialsSection.tsx:87`
  and `:416`.
- `web/packages/agenta-entities/src/secret/core/types.ts:98`.
- `web/oss/src/components/pages/settings/Secrets/SecretProviderTable/index.tsx:206`.

Nothing else in the picker changes. The picker expansion moves to `model-config` Part 3. See
[design.md](design.md) Section 5.

Tests: the settings secrets table and the provider-credentials section render the new label; no other
picker behavior changes.

## Order

1. **Slice 1** (service). The slug and the gate. Slice 2 depends on the slug on the wire.
2. **Slice 2** (runner). The `models.json` write, the isolated managed dir, and the exact id.
3. **Slice 3** (frontend). Independent of the other two; can land any time.

## Non-goals

- Bedrock, Vertex, and Azure consumption on Pi stays fail-loud.
- No vault storage change: no new secret kind, no migration, no `/secrets` write path.
- Exactly one new `/run` wire field: the connection slug. No others.
- The model picker expansion stays with `model-config` Part 3.
- The prompt/completion path is untouched.

## Appendix: the Pi startup-banner leak (separately shippable, not a slice)

`isBannerLine` (`services/runner/src/tracing/otel.ts`) does not match pi-acp's newer `## Extensions`
section or its `.js` extension paths, and `stripStartupBanner` strips only a leading contiguous run,
so the Extensions block and the trailing "New version available" notice leak into replies. Fix
`isBannerLine` to match the `Extensions` heading and a `.js` path (or strip the whole banner block).
Ship on its own lane. Full detail in [research.md](research.md).
