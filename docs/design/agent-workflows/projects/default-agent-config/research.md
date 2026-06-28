# Research: default agent config (tools + skills loaded by default, opt-out)

Grounded in code on branch `gitbutler/edit` (over `big-agents`), 2026-06-28. File paths are
absolute.

## The goal

When a user creates a new agent, the config should arrive pre-loaded with the platform
tools and the default Agenta skills. Workflow (reference) tools stay as they are. The user
can disable each default item, and ideally delete it. This is opt-out, not opt-in. UX and
debug-mode polish are out of scope for this design.

## 1. Where a new agent's default config comes from

There is one source of truth: `build_agent_v0_default(...)` in the SDK at
`/home/mahmoud/code/agenta/sdks/python/agenta/sdk/utils/types.py:1399`. Everything else
re-derives the seed from it. The default is concrete config baked into the stored revision
at create or commit time. It is not resolved by reference at run time.

What the builder returns today:

```python
{
  "instructions": {"agents_md": _DEFAULT_AGENTS_MD},   # friendly hello-world
  "llm": {"model": "gpt-5.5"},
  "tools": [],
  "mcps": [],
  "harness": {"kind": "pi_core"},
  "runner": {"kind": "sidecar", "interactions": {"headless": "auto"}},
  "sandbox": {"kind": "local"},
}
```

The builder takes an optional `skill_slug=` that adds one `@ag.embed` skill reference. No
caller passes it today, so a new agent gets `skills: []` and `tools: []`.

How the seed flows to every surface:

- SDK builder -> schema default at
  `/home/mahmoud/code/agenta/services/oss/src/agent/schemas.py:52`
  (`_DEFAULT_AGENT_TEMPLATE = build_agent_v0_default(...)`, attached as the
  `agent-template` schema `default`).
- Schema default -> catalog template parameters at
  `/home/mahmoud/code/agenta/api/oss/src/resources/workflows/catalog.py:107`
  (`_extract_schema_parameter_defaults` reads
  `parameters_schema.properties.agent.default` into `data.parameters`).
- Catalog template -> frontend pre-fill at
  `/home/mahmoud/code/agenta/web/packages/agenta-entities/src/workflow/state/appUtils.ts:189`
  (`createEphemeralAppFromTemplate` seeds `parameters` from `template.data.parameters`).
  There is no hardcoded default config in the frontend.
- New variant fork copies the base entity's `parameters` at
  `/home/mahmoud/code/agenta/web/packages/agenta-entities/src/workflow/state/commit.ts`.

Implication: adding defaults to `build_agent_v0_default` puts them on every new-agent
surface at once. It does not touch existing agents (correct for opt-out defaults).

The run-time fallback noted in the morning report is separate and thinner. When `/invoke`
runs by reference with no inline parameters, the API resolves the stored revision and uses
its baked `parameters` (`/home/mahmoud/code/agenta/api/oss/src/core/workflows/service.py`,
`_ensure_request_revision`). Only when `parameters.agent` is entirely absent does the
service fall back to file/class field defaults
(`/home/mahmoud/code/agenta/services/oss/src/agent/app.py:67`,
`AgentTemplate.from_params`). So by-reference invocation resolves a baked config; it does
not synthesize the platform tools or skills.

## 2. Platform tools in config

Catalog: `/home/mahmoud/code/agenta/sdks/python/agenta/sdk/agents/platform/op_catalog.py`,
`PLATFORM_OPS`. Exactly three reserved ops today:

| op | reads/mutates | default permission / approval |
| --- | --- | --- |
| `find_capabilities` | read | allow, no approval |
| `query_workflows` | read | allow, no approval |
| `commit_revision` | mutates (self only) | ask, approval required |

Tool list lives at `parameters.agent.tools`. The discriminator is `type`, with values
`builtin`, `gateway`, `code`, `client`, `reference`, `platform`. A platform entry is just:

```json
{ "type": "platform", "op": "find_capabilities" }
```

The catalog owns the description, endpoint, input schema, context bindings, and the per-op
permission and approval default. `PlatformToolConfig.needs_approval` is `Optional[bool] =
None`, so an unset entry keeps the catalog default (commit_revision stays approval-gated).

There is no wildcard or "all platform tools" today. To seed all of them you enumerate the
three entries, or have the builder iterate `PLATFORM_OPS.keys()`. Resolution turns a
platform entry into a direct `call` descriptor via
`/home/mahmoud/code/agenta/sdks/python/agenta/sdk/agents/platform/platform_tools.py`.

## 3. Skills in config and the default skills that exist

Skill model is `SkillTemplate` at
`/home/mahmoud/code/agenta/sdks/python/agenta/sdk/agents/skills/models.py`. One shape: an
inline SKILL.md package (`name`, `description`, `body`, `files`, `disable_model_invocation`,
`allow_executable_files`). A skill stored elsewhere is referenced by `@ag.embed` and
resolved server-side into the same shape.

Skills list lives at `parameters.agent.skills`, sibling to `tools`. An item is either an
inline `SkillTemplate` or a bare `{"@ag.embed": {...}}` reference.

Code-defined platform skills today: exactly one. Slug
`__ag__getting_started_with_agenta`, name `agenta-getting-started`. Source of truth is the
SDK constant `GETTING_STARTED_WITH_AGENTA_SKILL` in
`/home/mahmoud/code/agenta/sdks/python/agenta/sdk/agents/adapters/agenta_builtins.py`. It
is served read-only through `StaticWorkflowCatalog`
(`/home/mahmoud/code/agenta/api/oss/src/core/workflows/static_catalog.py`) under the
reserved `__ag__*` namespace (no DB, no per-project seed). The content is a placeholder.

Important nuance about how this skill reaches a run today:

- It is NOT seeded into stored config. `build_agent_v0_default` can add it via `skill_slug`
  but no caller does.
- It reaches runs through the harness, not config. The `pi_agenta` harness
  (`AgentaHarness`) unions `AGENTA_FORCED_SKILLS` into every run via `force_skills`
  (`/home/mahmoud/code/agenta/sdks/python/agenta/sdk/agents/adapters/harnesses.py:140`).
  This is always-on and cannot be disabled by the user.
- The default new-agent harness is `pi_core`, not `pi_agenta`. So a default new agent does
  not even get the getting-started skill today.

Forced skills (`force_skills`) and opt-out defaults are opposite intents. Forced means the
user can never remove it. The feature here wants present-by-default but removable. So this
feature cannot use `force_skills`; it must bake skills into the config.

FE control: `SkillTemplateControl` at
`/home/mahmoud/code/agenta/web/packages/agenta-entity-ui/src/DrillInView/SchemaControls/SkillTemplateControl.tsx`.
It renders `__ag__*` (static) skills read-only ("cannot be edited or removed").

## 4. Present-but-disabled vs removed: the model today

No `enabled` or `disabled` flag exists on tools, skills, or MCP servers. The model is
strictly present or absent. Top-level config is `AgentTemplate` at
`/home/mahmoud/code/agenta/sdks/python/agenta/sdk/agents/dtos.py:525` with `tools`,
`mcp_servers`, `skills` lists.

Nearby fields that are NOT a disable flag:

- `permission: "allow"|"ask"|"deny"` on tools and MCP. `deny` means present but never runs.
  It does not hide the tool from the model and does not exist on skills.
- `disable_model_invocation` on skills hides the skill from the model's auto-discovery but
  still loads it (invokable via `/skill:name`). Not a present-but-off switch.

Filtering before the runner is type-based only. `ToolResolver.resolve`
(`/home/mahmoud/code/agenta/sdks/python/agenta/sdk/agents/tools/resolver.py:115`) resolves
every tool present. `wire_skills` and `wire_mcp` emit every entry present. There is no
skip-disabled branch anywhere. So today the only way to turn an item off is to remove it.

Precedent for present-but-disabled elsewhere in agenta: the convention is `is_active: bool =
True` at the entity/row level (webhooks, triggers, gateway connections). Not used inside a
config list yet.

## Rename context (verified current)

Config nests under `parameters.agent`. The catalog type-ref is `agent-template` in code
(the doc `agent-config-schema.md` is stale and still says `agent_config`). `ModelRef.params`
is now `extras`. `permission_policy` rides `runner.interactions.headless`. The `/run` wire
is byte-identical; only the authoring shape changed.
