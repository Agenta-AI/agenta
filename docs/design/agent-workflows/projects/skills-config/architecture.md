# Skills: system architecture

How an agent skill flows through the system, from the config a user authors to the
`SKILL.md` the harness loads. Companion to `proposal.md` (the spec) and `build-notes.md`
(the implementation log). This doc is the architecture reference: the data model, the
resolution path, and the component boundaries.

## What a skill is

A skill is a reusable unit of instructions an agent loads on demand. It follows the
`SKILL.md` shape: a `name`, a `description`, a Markdown `body`, and optional bundled
`files`. The description is the trigger the model matches against the task. The body is the
procedure. Only the name and description stay in context at all times; the harness reads the
body and files only when the model decides the skill applies (progressive disclosure).

The runtime shape is one `SkillConfig`:

```
SkillConfig {
  name: str                      # ^[a-z0-9]([a-z0-9-]*[a-z0-9])?$, <= 64 chars
  description: str
  body: str
  files: [SkillFile]             # optional bundled files
  disable_model_invocation: bool # optional
  allow_executable_files: bool   # optional; gates executable files
}
SkillFile { path: str, content: str, executable: bool }
```

There is no type or source discriminator on a skill. A skill is either written inline or
pulled in by reference, and both resolve to the same `SkillConfig` before the agent runs.

## Two authoring shapes

The agent config carries a flat `skills` list, a sibling of `tools` and `mcp_servers`. Each
entry is one of two shapes:

1. **Inline.** A literal `SkillConfig` written directly in the config.
2. **Reference (`@ag.embed`).** A pointer to a stored skill, resolved server-side before the
   run. This is the existing embed mechanism the platform already uses for variants and
   environments, not a new slot:

   ```json
   {
     "@ag.embed": {
       "@ag.references": {"workflow": {"slug": "weather-oracle"}},
       "@ag.selector": {"path": "parameters.skill"}
     }
   }
   ```

   A bare `workflow` reference resolves to the latest revision. A `workflow_revision`
   reference with a `version` pins a specific one. The selector path `parameters.skill` is
   the canonical storage key for a skill's payload (see the data model below).

## Data model: a skill is a non-runnable workflow

A stored skill is a workflow artifact with `flags.is_skill = true` and no URI, so it is not
runnable. Its `SkillConfig` package lives at `data.parameters.skill`. `is_skill` sits in the
existing JSONB `flags` column alongside `is_application` / `is_evaluator` / `is_snippet`, so
it needs no migration. `is_snippet` is the precedent: a non-runnable, embeddable workflow.
`is_skill` is its own artifact family rather than a specialization of `is_snippet` so skills
get their own catalog, validation, and lifecycle.

Runnability stays interface-derived (`has_url` / `has_script` / `has_handler`). A skill has
none of those, so the runnable check already excludes it without a special case.

## End-to-end flow

```
agent config (skills: inline | @ag.embed)
        │
        ▼
ResolverMiddleware  ── resolves @ag.embed in the EFFECTIVE parameters
  (sdk/middlewares/running/resolver.py)   (inline request params, else the revision's)
        │  the embed resolver walks arrays, so @ag.embed inside skills[i] resolves
        ▼
wire_skills()  ── normalizes each entry to a concrete inline SkillConfig on the /run wire
  (sdk/agents/skills/wire.py, spread by request_to_wire)
        │
        ▼
runner /run  ── receives skills as resolved inline packages (no references on the wire)
        │
        ▼
skills materializer  ── composes SKILL.md + writes files into the sandbox skill dir
  (services/agent/src/engines/skills.ts)
        │
        ▼
harness  ── Pi loads SKILL.md; Claude SDK drops skills and logs a warning
```

The key boundary: **references resolve before the wire.** The runner only ever sees concrete
inline `SkillConfig` packages. It never resolves a reference and never reaches back to the
platform for a skill.

## Component responsibilities

- **`ResolverMiddleware`** (`sdks/python/agenta/sdk/middlewares/running/resolver.py`):
  resolves `@ag.embed` markers in the effective parameters. The effective source is the
  inline `request.data.parameters` when the caller sent them (the playground running an
  unsaved config, where there is no revision), otherwise the revision's. The embed resolver
  already traverses arrays, so a reference nested in `skills[i]` resolves on either path.
- **`wire_skills()`** (`sdks/python/agenta/sdk/agents/skills/`): the seam that turns the
  `skills` list into concrete inline packages on the `/run` wire. `SkillConfig` /
  `SkillFile` models and their validation live here.
- **Skills materializer** (`services/agent/src/engines/skills.ts`): composes the `SKILL.md`
  (YAML frontmatter + body), writes bundled files under the skill directory, validates
  `skill.name` against path traversal, rejects a `SKILL.md` clobber, and defaults executable
  files to deny.
- **Catalog + schema** (`sdks/python/agenta/sdk/utils/types.py`,
  `services/oss/src/agent/schemas.py`): the `skill_config` catalog type and the `skills`
  field on the agent config (a union of inline `SkillConfig` and an `@ag.embed` ref), so the
  default seeded config validates under raw/advanced schema validation.

## Platform skills via a reserved catalogue

Agenta's own managed skills are served from a code-defined **`PlatformWorkflowCatalog`** under a
reserved slug namespace (`_agenta.*`), not seeded per project. They stay ordinary `@ag.embed`
references; only resolution differs. A read-only platform revision provider sits at the
`WorkflowsService.fetch_workflow_revision` seam (injected from `api/entrypoints/routers.py`):
a `_agenta.*` slug returns a synthetic `WorkflowRevision` from code and never hits Postgres,
while every other slug takes the existing DB path. The default agent config embeds
`_agenta.agenta-getting-started`.

The synthetic revision carries `flags.is_skill=True`, `flags.is_platform=True`, the validated
`SkillConfig` at `data.parameters.skill`, no `uri`, and deterministic UUIDv5 IDs. `is_platform`
is the read-only signal: the SDK/client must not edit or delete the workflow, and the playground
renders it as a read-only platform entry. Versions live immutably in code; an artifact-level ref
resolves to `current`, a revision-level ref with a `version` pins one. Updating a catalogue entry
and deploying updates every project at once, with no per-project copy and no migration. A user
cannot create or shadow a `_agenta.*` slug (the prefix is reserved on create/edit and never falls
through to the DB). See `proposal.md` for the full design. The earlier per-project seeder and the
`is_locked` lock are removed.

## Executable files

Executable files are off by default. A bundled file runs only when its `executable` flag is
set, the skill sets `allow_executable_files`, and the sandbox policy allows execution. A
skill carries author-supplied content, and a script the model can run is a wider surface than
a typed tool, so the default is deny.

## Harness support

Skills load on the Pi-based harnesses (`pi` and `agenta`): the harness reads `SKILL.md` and
surfaces the skill to the model. The Claude SDK harness cannot load `SKILL.md`, so it drops
any attached skills and logs a visible warning at the non-Pi drop point
(`services/agent/src/engines/sandbox_agent/run-plan.ts`).
