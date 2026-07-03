# Plan

Five slices, each mapped to one gap. Two slices (1 and 5) are new to this project. Three
(2, 3, and part of 4) implement or extend designs the `model-config` sibling already wrote. The
recommended order front-loads the fastest unblock and keeps each slice independently shippable.

## Slice-to-gap map

| Slice | Gap | New or from a sibling | Where |
| --- | --- | --- | --- |
| 0 | 5 (Together env var) | new one-liner | `platform/secrets.py`, `platform/connections.py`, `connections/resolver.py` |
| 1 | 1 (deployment gate) | new | `platform/connections.py` |
| 2 | 2 (runner teaches Pi) | `model-config` Part 1 | `services/runner/src/engines/sandbox_agent/` |
| 3 | 3 (silent model drop) | `model-config` Part 2 | `services/runner/src/engines/sandbox_agent/model.ts`, `sandbox_agent.ts` |
| 4 | 4 (picker) | extends `model-config` Part 3 | `web/packages/agenta-entity-ui/...`, `capabilities.py` |

## Slice 0: fix the Together env var (Gap 5)

The independent quick win. Change `together_ai -> TOGETHER_API_KEY` in all three provider-to-env
maps (`platform/secrets.py:100`, `platform/connections.py:49`, `connections/resolver.py:38`). Add
the missing `minimax -> MINIMAX_API_KEY` to the two maps that omit it (`secrets.py`,
`resolver.py`), since `PI_VAULT_PROVIDERS` advertises `minimax` and a `minimax` key silently
produces no env var today. Audit every remaining entry against Pi's `getApiKeyEnvVars`.

This is behavior-preserving except for the two providers it repairs. It has no ordering
dependency, so it can land first or in parallel.

Tests: a unit assertion that the three maps agree (a cross-copy equality test, noted but not
written by the siblings), and that `together_ai` and `minimax` resolve to the Pi-correct env var.

## Slice 1: normalize the deployment of a known-direct custom provider (Gap 1)

The fastest unblock, and the whole reason this project exists. In `_custom_provider_candidate`
(`connections.py:274-309`), when the vault kind is in `_PROVIDER_ENV_VARS`, set
`deployment="direct"` instead of echoing the kind. Keep `azure`/`bedrock`/`vertex` as their cloud
surface (they stay fail-loud on Pi). Tighten `ResolvedConnection.deployment` to the closed
access-surface set (`direct`/`azure`/`bedrock`/`vertex`); drop the free `"custom"` echo (a custom
endpoint is `direct` plus an `endpoint`). The role analysis is in [design.md](design.md) Section 1.

After this, a custom OpenRouter or OpenAI connection passes Pi's `["direct"]` gate. Because
`resolved_env` already emits the provider's `*_API_KEY` (`connections.py:238-245`) and the runner
already forwards `request.secrets` into the Pi daemon env, a model id that is already in Pi's
built-in catalog (all 253 OpenRouter ids, the `openai/*` ids) becomes settable with no runner
change. This slice alone closes the headline "OpenRouter works as a provider_key but not as a
custom provider" complaint for any built-in id.

Custom base URLs and genuinely custom (non-built-in) ids still need Slice 2.

Tests: unit on `_custom_provider_candidate` (a known-direct kind resolves `deployment="direct"`,
provider set, endpoint and env intact; a cloud kind keeps its surface). Integration
(httpx-mocked resolver, fake runner): a custom OpenRouter connection with a built-in id no longer
raises `UnsupportedDeploymentError` and reaches the runner with `OPENROUTER_API_KEY` in `secrets`.

## Slice 2: teach Pi the custom provider in the runner (Gap 2, model-config Part 1)

Write, into the per-run agent dir the runner controls, and into `DAYTONA_PI_DIR` for the remote
path:

- `auth.json` from the resolved provider keys, each value a `"$ENV"` reference, merged with the
  login's copied `auth.json` so OAuth still works.
- `models.json` only when `resolved_connection.endpoint.baseUrl` is set or the selected model id is
  not a Pi built-in: one `providers.<provider>` block with `baseUrl`, `api`, `apiKey` (`"$ENV"`),
  and the one selected model id. The shape and its role analysis are in [design.md](design.md)
  Section 2.

Prerequisites inside this slice:

- Make "the run carries a resolved provider connection" a third reason to create and point at the
  per-run agent dir, alongside skills and system prompt (`pi-assets.ts:224`). Otherwise the write
  lands nowhere the daemon reads for the exact failing case (a plain model override).
- Local and Daytona parity: mirror `uploadPiAuthToSandbox` (`daytona.ts:77-94`) with a
  `models.json` uploader, and confirm the key reaches the sandbox env via `daytonaEnvVars`
  (`daytona.ts:31-46`).

All inputs already ride the wire (`resolved_connection` plus `secrets`); no wire change. This is
the runner half of the fix and it stays in `services/runner/src/engines/sandbox_agent/`.

Tests: unit that given `resolved_connection` with a base URL and a key, the runner writes an
`auth.json` referencing `"$OPENROUTER_API_KEY"` and a `models.json` with the base URL and the
selected id, and never a raw secret. Integration: a custom-base-URL run resolves the model rather
than falling back. Live acceptance (llm_required): a custom OpenRouter connection with a genuinely
custom id runs.

## Slice 3: fail loud on an unsettable model (Gap 3, model-config Part 2)

Fix `allowedModels` to read `c.value ?? c.id` (`model.ts:19-30`) so the allowed set is real. Raise
a typed `ModelNotSettableError` carrying the requested model and the allowed set when a requested
model cannot be set after the retry. Gate it behind `AGENTA_AGENT_MODEL_STRICT`, default `false`
first (warn and fall back, today's behavior), then flip to `true` once the QA matrix confirms the
common models are settable and the advertised default is reconciled. A no-model-requested run still
uses the harness default and is never an error. Keep the in-process Pi path consistent
(`engines/pi.ts` `pickModel` should raise the same error rather than silently substituting). The
role analysis is in [design.md](design.md) Section 4.

Tests: a requested model with no key raises and the concise error renders the available set; no
model requested still runs the default; strict off preserves today's fallback.

## Slice 4: surface custom-provider models in the picker (Gap 4)

Add `models?: string[]` to `VaultConnectionEntry` (`connectionUtils.ts:302-312`). Thread the vault
entries into `buildModelOptionGroups` (`:239-256`) or its `useModelHarness` caller, and merge each
reachable custom provider's models into the harness-filtered group, tagging provenance so the UI
labels a project-specific model. Apply the same harness reachability filter
`namedConnectionOptions` already uses. Land the static grouped-choice baseline first
(`model-config` Part 3 layer 1: give the agent `model` field real grouped choices from
`supported_llm_models`), which is independent and cheap. The picker-choices contract and its role
split are in [design.md](design.md) Section 5.

Tests: helper unit that a custom provider's models appear in the group for a harness that reaches
that provider and are absent for one that does not; a built-in-only picker is unchanged.

## Recommended order

1. **Slice 0** (Together env var). Independent, trivial, unblocks Together and Minimax now.
2. **Slice 1** (deployment gate). The fastest unblock: one resolver change makes a custom
   known-direct provider work on Pi for any built-in id, with no runner or frontend work.
3. **Slice 2** (runner write). Extends the reach to custom base URLs and genuinely custom ids.
   Contained to the runner.
4. **Slice 3a** (louder error, `allowedModels` fix, `AGENTA_AGENT_MODEL_STRICT` defaulting false).
   The safe half of the fail-loud fix.
5. **Slice 4** (picker), with the static grouped-choice baseline first.
6. **Slice 3b** (flip `AGENTA_AGENT_MODEL_STRICT` to strict) once the QA matrix is green.

Slice 1 is the single highest-value change and should ship first after Slice 0. Slices 0, 1, and 4
are new to this project; Slices 2 and 3 build the `model-config` design.

## Non-goals

- Bedrock, Vertex, and Azure consumption on Pi stays fail-loud. This project does not wire
  multi-var cloud credential delivery into Pi.
- No vault storage change: no new secret kind, no migration, no `/secrets` write path.
- No new `/run` wire field.
- The prompt/completion path is untouched.

## Appendix: the Pi startup-banner leak (separately shippable, not a slice)

`isBannerLine` (`services/runner/src/tracing/otel.ts:699-713`) does not match pi-acp's newer
`## Extensions` section or its `.js` extension paths, and `stripStartupBanner` (`:719-728`) strips
only a leading contiguous run, so the Extensions block and the trailing "New version available"
notice leak into replies. Fix `isBannerLine` to match the `Extensions` heading and a `.js` path
(or strip the whole banner block). Ship on its own lane; it does not block the five gaps. Full
detail in [research.md](research.md).
</content>
