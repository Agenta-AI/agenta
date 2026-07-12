# Research: how Agenta advertises harness models today

This document records the current state of harness model advertising, the experiments that
decide the schema, and every reader of the field we plan to change. All claims are traced to
a file and line so a later reader can re-derive them.

## TL;DR

Agenta publishes a hardcoded, flat list of model id strings per harness. For Claude that list
(`CLAUDE_MODEL_ALIASES`) is neither a subset nor a superset of the set the live Claude harness
actually accepts. It over-advertises ids the harness rejects and omits ids the harness accepts
(Fable). The only authoritative "which model can I select" set is the one the live harness
reports at session init. The published list is a stale guess. The fix is to stop treating the
published list as the gate, publish richer per-model data (label, description, real pricing,
curated ratings), and keep that data in a curated file maintained by a skill.

## Where the catalog lives today

`sdks/python/agenta/sdk/agents/capabilities.py` is the source of truth for what each harness
advertises. Two hardcoded lists drive it.

- Claude: `CLAUDE_MODEL_ALIASES` at `capabilities.py:91` is a flat list of eight alias strings
  (`default`, `sonnet`, `opus`, `haiku`, and their `[1m]` variants). It is published at
  `capabilities.py:192` as `models={"anthropic": list(CLAUDE_MODEL_ALIASES)}`.
- Pi: `_pi_models()` at `capabilities.py:126` builds `Dict[provider, List[str]]` from the
  litellm-derived `supported_llm_models` catalog (`assets.py`) for the eight vault providers,
  plus the explicit `openai-codex` ids in `PI_SUBSCRIPTION_MODELS` (`capabilities.py:67`).

Both feed `HARNESS_CONNECTION_CAPABILITIES` (`capabilities.py:172`), whose `models` field is
typed `Dict[str, List[str]]` (`capabilities.py:169`). The name equals the id: the picker has
nothing but a raw string to render.

## How a model gets selected at run time (the real gate)

The runner applies a requested model in `services/runner/src/engines/sandbox_agent/model.ts`.
`applyModel` (`model.ts:99`) calls `session.setModel(wanted)`, and on rejection retries once
against the harness's own ids via `pickModel` (`model.ts:49`). The `session` is a
`sandbox-agent` object, and `setModel` routes to `setSessionModel` in the sandbox-agent
package.

`sandbox-agent` validates the requested value against the harness's advertised config options
before it ever reaches the harness:

- `setSessionModel` -> `setSessionCategoryValue("model", value)`
  (`sandbox-agent/dist/chunk-TVCDKGSM.js:1508`).
- It reads the allowed values with `extractConfigValues(option)` (`chunk-TVCDKGSM.js:2754`),
  which returns the `value` of every entry in the model config option's `options` array.
- If the requested value is not in that set, it throws `UnsupportedSessionValueError`
  (`chunk-TVCDKGSM.js:1516`) with the message `... Allowed values: <list>`
  (`chunk-TVCDKGSM.js:609`). That is the exact "Allowed values: default, sonnet[1m], opus,
  opus[1m], haiku" string the runner surfaces.

So the gate is the harness's live config options, discovered at session init, not any list
Agenta publishes.

Where do those config options come from for Claude? The Claude harness runs behind the
`@agentclientprotocol/claude-agent-acp` adapter. Its `buildConfigOptions`
(`claude-agent-acp/dist/acp-agent.js:3400`) builds the model option's choices from
`models.availableModels` (`acp-agent.js:3421`), and `getAvailableModels`
(`acp-agent.js:3761`) derives that list from the Claude Code SDK's `initializationResult.models`
(`acp-agent.js:3016-3026`), optionally narrowed by a `settings.json` `availableModels`
allowlist. The runner sets no such allowlist, so the advertised set equals the SDK's full
reported model list for the running Claude Code build.

For Pi the same shape is filled by `get_available_models`, which lists `provider/id` for every
provider that has a credential Pi can see. That mechanism and its failure modes are documented
in the sibling project `../model-config/research.md`; this project does not re-derive it.

## Experiment 1: does the Claude harness accept ids it does not advertise? (the Fable finding)

Question: the owner can select Fable in the live Claude harness today, yet `CLAUDE_MODEL_ALIASES`
does not list Fable. Is the advertised set equal to the accepted set, or is one a subset of the
other?

Finding: neither. The published `CLAUDE_MODEL_ALIASES` and the live accepted set drift in both
directions, because they have different sources.

- The accepted set is whatever the live Claude Code SDK reports at session init
  (`acp-agent.js:3016-3026`), gated by sandbox-agent (`chunk-TVCDKGSM.js:1516`). This is the
  authoritative set. It is dynamic: it changes with the Claude Code build.
- `CLAUDE_MODEL_ALIASES` is a hand-maintained constant that has drifted from that set.

Concretely, against a live set of `{default, sonnet[1m], opus, opus[1m], haiku}` (the ids the
runner has reported):

- Over-advertised (published, rejected by the harness): `default[1m]` and `haiku[1m]`. The
  runner's `pickModel` cannot rescue these. Its context-hint tier only widens a bare request to
  a hinted id (`sonnet` -> `sonnet[1m]`), never the reverse (`model.ts:32-58`), so a published
  hinted id with no live hinted match fails with `ModelNotSettableError`. The published bare
  `sonnet` does resolve, because `pickModel` widens it to the live `sonnet[1m]`.
- Accepted but not advertised: Fable. The Claude Code SDK reports Fable in its model list, so
  the live config options include it and sandbox-agent accepts a `setModel` to it. Fable is a
  real Anthropic model. Pi's own generated catalog carries it as `claude-fable-5`
  (`@earendil-works/pi-ai` `models.generated`, `anthropic` block), with `name` "Claude Fable 5",
  `contextWindow` 1000000, and `cost.input` 10 / `cost.output` 50 per million tokens. The exact
  id spelling the Claude Code SDK reports for Fable (a bare alias such as `fable` versus a
  pinned `claude-fable-5`) was not probed live in this pass (see confidence note).

Design consequence: the curated catalog must never be the gate. A model is selectable if and
only if the live harness accepts it. The catalog only decorates whatever set is in play, and it
must be able to carry an entry for a model that is accepted but not advertised by default (the
Fable case). The schema expresses this with an `advertised` flag (see `design.md`).

Confidence: high on the mechanism (traced end to end through sandbox-agent and the ACP adapter
dist, and cross-confirmed by `../model-config/research.md:214-218`, which independently found
the Claude allowed set comes from the adapter exposing Claude Code's own aliases). Medium on the
exact live id spelling for Fable, because a live session probe against the running runner needs
an authenticated Claude session and was not run here to avoid disturbing the shared dev stack.
The skill (`plan.md`) makes that probe a routine, repeatable step.

## Experiment 2: what can we auto-derive from the Pi catalog?

Pi ships a generated catalog at `@earendil-works/pi-ai` `dist/models.generated.js` (pinned
version `0.80.6` in the runner). It is a nested map `MODELS[provider][id]`. Every entry carries:

- `id` (string) and `name` (a clean display name, e.g. "GPT-5.3 Codex Spark").
- `provider` (string) and `baseUrl`.
- `cost` `{ input, output, cacheRead, cacheWrite }` in price per million tokens.
- `contextWindow` and `maxTokens` (integers).
- `input` (modality array, e.g. `["text"]` or `["text", "image"]`).
- `reasoning` (bool) and, where relevant, `thinkingLevelMap`.

A real `openai-codex` entry (verbatim from the pinned catalog):

```json
{
  "id": "gpt-5.3-codex-spark",
  "name": "GPT-5.3 Codex Spark",
  "provider": "openai-codex",
  "baseUrl": "https://chatgpt.com/backend-api",
  "cost": { "input": 1.75, "output": 14, "cacheRead": 0.175, "cacheWrite": 0 },
  "contextWindow": 128000,
  "maxTokens": 128000,
  "input": ["text"]
}
```

The catalog also carries the `anthropic` provider block (`claude-opus-4-8`, `claude-sonnet-5`,
`claude-fable-5`, ...) with the same fields. Claude Code does not expose pricing or context
through its own config options, but Pi's catalog does. So the skill can seed Claude facts
(name, pricing, context window) from Pi's `anthropic` block even though the Claude harness never
reports them. That is the one place the two harnesses share a fact source.

Auto-derivable, per model, with no human judgment: `id`, `name`, `provider`, `pricing`
(input/output/cache), `context_window`, `modalities`. Not derivable: a cleaner display label
when `name` is still ugly, a one-line description, and the relative ratings. Those are curated.

## Every reader of the field we change

The field is `HARNESS_CONNECTION_CAPABILITIES[...].models`, published through the harnesses
catalog. Readers, so the migration breaks none of them:

- Builder: `capabilities.py:126-194` (`_pi_models`, `CLAUDE_MODEL_ALIASES`, the dict).
- Server publication: `harness_catalog_document()` (`capabilities.py:215`) ->
  `api/oss/src/resources/workflows/catalog.py:255` and `:262` -> `GET /catalog/harnesses/` and
  `/{ag_harness}`.
- Server-side consumer: `sdks/python/agenta/sdk/agents/platform/connections.py:23-52` imports
  `CLAUDE_MODEL_ALIASES` (as `_CLAUDE_ALIASES`) and `HARNESS_CONNECTION_CAPABILITIES`
  (`connections.py:109`) for the agent-layer capability checks.
- Default-harness schema: `sdks/python/agenta/sdk/utils/types.py:1082-1084` reads
  `HARNESS_CONNECTION_CAPABILITIES` for the default harness.
- SDK tests: `sdks/python/oss/tests/pytest/unit/agents/connections/test_capabilities.py`
  (asserts `models["anthropic"] == list(CLAUDE_MODEL_ALIASES)` at `:144`, and the per-harness
  `models` shape at `:116`, `:135`).
- Service test: `services/oss/tests/pytest/unit/agent/test_builtin_uri_binding.py:75`.
- Frontend: the harness-filtered agent model picker. See the frontend map in `plan.md`.

The frontend reads harness capabilities from the harnesses catalog
(`GET /catalog/harnesses/{ag_harness}`), not from `/inspect` `meta` (see the note at
`capabilities.py:204`). The classic prompt-playground model picker is a separate consumer that
reads the standalone `model` catalog type (`supported_llm_models`), not this field. The
migration must not touch that path. `plan.md` maps both precisely.

## Sources

- `sdks/python/agenta/sdk/agents/capabilities.py` (the catalog builder).
- `services/runner/src/engines/sandbox_agent/model.ts` (the runtime resolver).
- `services/runner/node_modules/.pnpm/sandbox-agent@0.4.2*/dist/chunk-TVCDKGSM.js` (the gate).
- `services/runner/node_modules/.pnpm/@agentclientprotocol+claude-agent-acp@0.58.1*/dist/acp-agent.js`
  (the Claude model list source).
- `services/runner/node_modules/.pnpm/@earendil-works+pi-ai@0.80.6*/dist/models.generated.{js,d.ts}`
  (the auto-derivable Pi facts).
- `../model-config/research.md` (independent confirmation of the Claude allowed-set source and
  the Pi availability mechanism).
</content>
