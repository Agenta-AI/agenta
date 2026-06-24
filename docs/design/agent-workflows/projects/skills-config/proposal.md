# Proposal: a `skills` field on the neutral agent config

This proposes a `skills` field on the neutral `AgentConfig`, a sibling of `tools` and
`mcp_servers`, so an agent author can ship their own skill. The harness survey that justifies
the shape is in [research.md](research.md). This is a design proposal. It does not change
`dtos.py` or the runtime.

The proposal in one sentence: add `skills: List[SkillConfig]`, where a `SkillConfig` is one
shape (an inline skill package: `name`, `description`, a SKILL.md body, and optional bundled
files), and any entry can instead be an `@ag.embed` reference that the existing embed resolver
inlines into that same shape before the runner sees it.

There is no `source` or `type` discriminator and no separate "curated" variant. A skill is
either written inline or referenced through `@ag.embed`, the same reference mechanism the
platform already uses for prompts. Platform default skills are not a special path either. The
platform seeds them as locked workflow revisions when a project is created, then embeds them
like any other reference.

This version folds in two earlier reviews and a design decision that collapsed the schema. The
load-bearing points: reuse `@ag.embed` instead of inventing a parallel reference slot, resolve
embeds server-side before the runner, keep the runner working only with concrete materialized
packages, and hold a hard line between trusted skill content (a platform-created locked
revision, or an embed the author owns) and the execution surface that author-controlled files
open up.

## Why now

Today skills are hardcoded. `AgentaHarness._to_harness_config` sets
`skills=list(AGENTA_FORCED_SKILLS)`, and `AGENTA_FORCED_SKILLS` is a single placeholder
`["agenta-getting-started"]` (`adapters/agenta_builtins.py`). The neutral `AgentConfig`
(`dtos.py`) exposes `tools` and `mcp_servers` but no `skills`, the playground catalog type
`AgentConfigSchema` (`sdk/utils/types.py`) has no `skills`, and any `skills` a caller sends is
dropped. The runner is already capable of more. `resolveSkillDirs` resolves named dirs and
`installSkillsLocal` / `uploadSkillsToSandbox` copy them recursively, scripts included, but
nothing upstream lets a user name one. This is finding **F-003**: the capability exists in the
runner and dies at the config layer.

## What we keep from the survey

Every skill-bearing harness (Claude Code, Pi, OpenCode, Antigravity) agrees on the unit: a
**directory with a `SKILL.md`**. That is YAML frontmatter (`name` + `description`), a Markdown
body, and bundled `scripts/` / `references/` / `assets/` referenced by relative path, loaded
progressively. Pi, Claude Code, OpenCode, and Antigravity all read `name` and `description`. Pi
and Claude also honor `disable-model-invocation`. Pi has one extra surfacing rule in our
current runner path: it renders skills in the prompt only when the `read` tool is present. So
the portable shape is **`name` + `description` + body + optional files**, and each harness
adapter maps that package to the filesystem location its harness loads.

## The schema

There is one model, `SkillConfig`. It is the inline skill package: the portable frontmatter
fields, the body, optional bundled files, and two behavior flags. There is no discriminator,
because there is only one shape.

```python
# sdk/agents/skills/models.py  (new module, sibling of tools/ and mcp/)

# Harness skill-name rule (Pi/Claude/OpenCode/Antigravity): lowercase, digits, single
# hyphens, <=64 chars.
_SKILL_NAME = Field(min_length=1, max_length=64, pattern=r"^[a-z0-9]+(-[a-z0-9]+)*$")

class SkillFile(BaseModel):
    """One bundled file laid beside SKILL.md, by relative path. `content` is inline text
    (UTF-8); a future `uri` variant can reference blob storage for binary assets. `path` is
    validated to a safe relative path (no leading `/`, no `..`) so a file cannot escape the
    skill dir on materialize. `content` is untrusted author code; see Security."""
    model_config = ConfigDict(extra="forbid")
    path: str = Field(min_length=1, max_length=255)   # safe relative path, e.g. "scripts/foo.py"
    content: str = Field(max_length=200_000)          # UTF-8 (binary -> a later uri variant)
    executable: bool = False                          # chmod +x only if policy allows it

class SkillConfig(BaseModel):
    """An inline skill package. The SKILL.md frontmatter + body and any bundled files ride
    the wire as content; the runner materializes them into a skill dir at run time. `name`
    and `description` are the two portable frontmatter fields (every harness reads them);
    `body` is the SKILL.md Markdown the runner writes after the composed frontmatter.

    To reference a skill instead of writing it inline, place an `@ag.embed` object in the
    `skills` list (or in any field below). The embed resolves, server-side and before the
    runner, into a value of exactly this shape. See "How references work"."""
    model_config = ConfigDict(extra="forbid")
    name: str = _SKILL_NAME
    description: str = Field(min_length=1, max_length=1024)  # the trigger; required everywhere
    body: str = Field(min_length=1, max_length=50_000)      # the SKILL.md Markdown body
    files: List[SkillFile] = Field(default_factory=list)    # bundled scripts / references
    disable_model_invocation: bool = False  # Pi/Claude: hide from prompt, only /skill:name
    allow_executable_files: bool = False    # default deny; sandbox policy must also allow
```

Then on the neutral config (the only change to `dtos.py`, shown for context, **not made
here**):

```python
class AgentConfig(BaseModel):
    instructions: Optional[str] = None
    model: Optional[str] = None
    tools: List[ToolConfig] = Field(default_factory=list)
    mcp_servers: List[MCPServerConfig] = Field(default_factory=list)
    skills: List[SkillConfig] = Field(default_factory=list)   # NEW: sibling of the two above
    harness_options: Dict[str, Dict[str, Any]] = Field(default_factory=dict)
```

The list is the ordered set of skills the agent asks for. Each item is one skill. An item can
arrive as an `@ag.embed` object that resolves to a `SkillConfig`, but after resolution every
item is a `SkillConfig`. So `skills` can be typed strict, provided resolution runs before
parsing (see "Where resolution happens"). If a future reference intentionally produces a bundle
of many skills, model that as an explicit expansion step, not a nested list, so ordering, name
collisions, and audit logs stay unambiguous.

### Field rationale

- **One shape, no discriminator.** A skill is content. The earlier draft carried a `source`
  union with `curated`, `workflow`, and `inline` variants. Two of those collapse: `curated`
  and `workflow` were both "point at a skill that lives somewhere else," which is exactly what
  `@ag.embed` already does. So the union becomes a single inline package plus the generic embed
  reference. This removes a parallel `workflow_revision_ref` + `selector` pair that re-derived
  `@ag.references` + `@ag.selector`.
- **`name` + `description` are the portable two.** Every harness reads them; the description is
  the trigger the model matches. They are length-bounded to the harness rule (<=64 / <=1024),
  which the survey shows is common to Pi, Claude, OpenCode, and Antigravity.
- **`body` is the SKILL.md Markdown.** The runner composes the frontmatter from
  `name`/`description` and writes the body, so the author writes Markdown, not raw frontmatter.
  `body`, not `instructions`, avoids colliding with `AgentConfig.instructions`, which is the
  AGENTS.md and a different layer. If we later want authors to paste a full SKILL.md verbatim,
  add an optional `skill_md: str` that supersedes the composed frontmatter when present. That is
  a non-breaking addition.
- **`files` carries bundled scripts/references inline.** This is what makes "skills with code"
  reachable (F-003). Inline UTF-8 content matches the runner's current Daytona uploader, which
  is text-only (`writeFsFile` takes a string body). Binary assets are a follow-up via a `uri`
  file variant.
- **No `enabled` flag.** `ToolConfig` has none. A skill is shipped or it is absent from the
  list.
- **`disable_model_invocation`** is the one extra portable frontmatter field Pi and Claude both
  honor (hide from the prompt, invoke only via `/skill:name`). It is carried so an author can
  ship a manual-only skill, and ignored by a harness that does not support it.

## Data model for a skill (a non-runnable workflow)

A referenced skill is stored as a workflow artifact, not a new domain. The workflow model
already carries artifact families through `flags` (`api/oss/src/core/workflows/dtos.py`):
`is_application`, `is_evaluator`, `is_snippet`. Runnability is interface-derived: `has_url`,
`has_script`, `has_handler`. A snippet is the existing non-runnable, embeddable family, the
content you pull in through `@{{...}}` / `@ag.embed`.

A skill is the same idea with a richer payload. Add a distinct family flag, `is_skill` (sibling
of `is_snippet`), rather than overloading `is_snippet`, because a skill's payload shape and its
authoring form differ from a plain snippet. A skill artifact has no executable interface (no
URI, none of `has_url` / `has_script` / `has_handler`), so it is non-runnable by construction.
It is a sibling of a snippet at the family-flag level, but not identical underneath: a snippet
carries a managed URI (`agenta:custom:snippet`), while a skill has none. Because the
flag-derivation default for a URI-less workflow is `is_evaluator=True`
(`sdk/engines/running/utils.py` `infer_flags_from_data`), a skill must be committed with an
explicit `flags` object that sets `is_skill=True` and `is_evaluator=False`. A skill is excluded
from `/invoke` and the playground run surfaces, and `is_skill` joins the artifact query flags so
skills list and manage separately.

Reuse, not reinvention:

- A skill is a workflow artifact / variant / revision, so it inherits versioning, commit /
  retrieve / log, and fork from the Git pattern for free.
- The embed resolver needs zero changes. A skill **is** a `workflow_revision`, which the
  reference family already supports, so `@ag.references[workflow_revision.slug=my-skill,
  version=v3]` resolves with no new code.

Storage and the canonical selector. The `SkillConfig` package lives nested under a stable key in
the revision's parameters, at `parameters.skill`, conforming to a new `skill_config` catalog
type that drives the authoring form (the same way `agent_config` drives the agent form via
`CATALOG_TYPES`). Nesting under `skill`, rather than making the whole `parameters` the package,
leaves room for skill-level metadata in the same revision later without colliding with the
package. Every skill embed therefore uses one canonical selector, `@ag.selector[path:
parameters.skill]`, so the seeding code and the playground emit the same reference and an author
never hand-writes the path. A code check confirms why the selector is part of the contract and
not optional: the object-embed resolver extracts a selector path from `revision.data`, and with
no selector it inlines the whole `revision.data` (parameters, uri, and all), which is not what a
skill embed wants.

Platform default skills are `is_skill` artifacts the platform seeds at project creation and
locks from edit and delete, then embeds with that canonical selector. Trust comes from the
platform authoring the revision and locking it. That is why a default skill is trusted and an
author-authored skill is not.

## How references work (`@ag.embed`)

A skill that lives elsewhere is referenced with the existing embed mechanism, not a new field.
The author puts an `@ag.embed` object in the `skills` list:

```json
"skills": [
  {
    "@ag.embed": {
      "@ag.references": {"workflow": {"slug": "my-skill"}},
      "@ag.selector": {"path": "parameters.skill"}
    }
  }
]
```

Reference the skill at the **artifact** level (`workflow`), which resolves to its latest
revision. This is the right shape for "use this skill." Do **not** use `workflow_revision` with
a bare slug and no version: a `workflow_revision` slug matches the revision's own hash slug, not
the author-facing artifact slug, so a bare revision slug fails to resolve (live E2E found this
500s, including for the seeded default skill, now fixed to `workflow`). To pin a specific
version, use `{"workflow_revision": {"slug": "my-skill", "version": "v3"}}`, where the
normalization resolves the artifact slug plus version.

The resolver replaces that list entry, in place, with the value found at the selector path,
which is a `SkillConfig`-shaped object. Embeds may also appear inside a skill field (for
example, a `body` that pulls a snippet from another revision). The same resolver handles both.
This reuses depth and cycle limits, the error policy, two-hop selectors, and the snippet
syntax, all of which already exist.

**Platform default skills are embeds too.** There is no first-party skill type. When a project
is created, the platform seeds its default skills as workflow revisions and locks them from edit
and delete, then embeds them in the agent config like any other reference. "Forced" stops being
a config concept. It becomes "the platform injected these embeds and the author cannot remove
them, and the underlying revision is locked." The skill schema does not need to know any of
this. Seeding and locking are a separate workstream named in "Scope and order of work".

### Where resolution happens

Resolution is server-side and finishes before the runner request is built. The runner never
receives an `@ag.embed`, a workflow reference, or database access. It only ever sees concrete
`SkillConfig` content.

Two facts about the existing resolver decide the wiring, both verified against the code:

1. **The embed resolver already traverses arrays.** `find_object_embeds`,
   `find_string_embeds`, and `find_snippet_embeds` recurse into lists and build indexed paths
   such as `skills.0`; `set_path` writes the resolved value back into the list index. An
   `@ag.embed` sitting at `skills[0]` resolves and is replaced in place today. No new
   array-traversal code is needed.
2. **The running middleware resolves embeds only on the revision path, not on inline
   parameters.** `ResolverMiddleware` calls `resolve_embeds` on `revision.parameters`, but
   `resolve_revision` builds that revision from `request.data.revision` or the running context,
   never from inline `request.data.parameters`. When the playground runs an unsaved config
   (parameters inline, no revision reference), `revision` is `None` and the resolution block is
   skipped. So the handler cannot assume embeds are already resolved.

The fix lives in the shared resolver, not in the agent handler. Today `ResolverMiddleware`
resolves embeds only on `revision.parameters`. Change it to resolve on the *effective*
parameters, the ones that will actually drive the handler, whether they came from a revision or
inline:

```python
# ResolverMiddleware.__call__, after revision resolution / reference hydration
if not request.data:
    request.data = WorkflowRequestData()
if revision and not request.data.parameters:
    request.data.parameters = revision.parameters

resolve_flag = (request.flags or {}).get("resolve", True)
if resolve_flag and request.data.parameters and _has_embed_markers(request.data.parameters):
    request.data.parameters = await resolve_embeds(
        parameters=request.data.parameters,
        credentials=ctx.credentials or request.credentials,
    )
    if revision:
        revision.parameters = request.data.parameters
```

This is a central fix, not an agent-specific one. Every workflow service (completion, chat,
agent) then resolves inline-param embeds the same way it already resolves revision embeds. The
asymmetry today is an incidental gap: resolution was attached to the `revision` object, and
inline params are a fallback the block never covered. It is not a deliberate choice. The
existing `flags.resolve` (default true) stays the opt-out for a caller that wants raw tokens.
Because the embed resolver already walks arrays, an `@ag.embed` inside `parameters.skills[i]`
resolves on both paths.

With this fix the agent handler needs no special `resolve_embeds` call, and `AgentConfig.skills`
is concrete at parse time, so it is typed strict as `List[SkillConfig]`. The one caveat is blast
radius. This is shared middleware, so the change needs the existing wire and golden tests plus a
new case for inline-param embed resolution, to confirm no service regressed.

## How it maps to the wire and the runner

### Wire (`utils/wire.py` + `services/agent/src/protocol.ts`)

Two layers of type stay distinct:

- **`SkillConfig`** (config + wire layer): the inline package above. By the time the wire is
  built, every entry is a resolved `SkillConfig`. The same shape rides `/run`.
- **`MaterializedSkill`** (`{name, dir}`, runner layer): the output of materialization, what
  the install paths consume. Internal to the runner, never on the wire.

There is no `curated` name on the wire and no discriminated `WireSkill` union. Because
references resolve server-side into concrete packages, the wire carries one shape: the
`SkillConfig`. `protocol.ts` declares it directly:

```ts
// protocol.ts: skills always ride as resolved inline packages
interface WireSkill {
  name: string;
  description: string;
  body: string;
  files?: { path: string; content: string; executable?: boolean }[];
  disableModelInvocation?: boolean;
  allowExecutableFiles?: boolean;
}
interface AgentRunRequest { /* ... */ skills?: WireSkill[]; }
```

On the Python side a `skills_to_wire` helper (sibling of `mcp_servers_to_wire`) serializes the
resolved `SkillConfig` list to `WireSkill[]`. Per `services/agent/CLAUDE.md` this touches the
golden fixtures, `protocol.ts`, `wire.py`, and both contract tests together, deliberately.

This is a deliberate replacement of the current `skills?: string[]` wire. The old wire carried a
list of names that the runner resolved against `SKILLS_ROOT`. That path goes away. There are no
runner-resolved names anymore, because there is no curated-by-name concept. If we want to keep
the old `string[]` accepted on input for back-compat during migration, coerce each string to a
curated-equivalent embed or a seeded package at the service boundary, then drop it once stored
configs are migrated.

**Where it leaves the config (a layering fix).** Today `skills` is emitted inside
`AgentaAgentConfig.wire_tools()`, which was a shortcut: skills are not tools. Give the base
`HarnessAgentConfig` a `wire_skills()` method (sibling of `wire_tools()` / `wire_prompt()` /
`wire_mcp()`), default empty, that a skill-loading harness overrides. `request_to_wire` spreads
`**config.wire_skills()` alongside the others. This moves skills out of the tool wire and onto
their own seam, so `PiHarness` (not just `AgentaHarness`) can emit them.

### Runner (`engines/skills.ts`, `pi.ts`, `sandbox_agent.ts`)

`resolveSkillDirs` today takes `string[]` and resolves names against `SKILLS_ROOT`. In the new
model the contract takes `WireSkill[]` and returns `MaterializedSkill[]` (a `{name, dir}` per
skill). For each skill the runner writes a fresh dir under a per-run temp root: it composes
`SKILL.md` from `name`/`description`/`body`, then writes each `files[]` entry at its relative
`path` (re-validating it stays under the skill dir, creating parent dirs, and `chmod +x` only
when `allowExecutableFiles` is true and the sandbox/harness policy allows execution). It returns
that dir.

The name-resolution branch and absolute-path handling are removed. The runner no longer maps a
name to a bundled dir, so the old path-traversal vector (an author naming `/etc/...` for a
"curated" skill) is gone by construction.

All materialized skill dirs then flow through the existing install paths unchanged:
`additionalSkillPaths` for the in-process Pi engine (`engines/pi.ts`), `installSkillsLocal` /
`uploadSkillsToSandbox` into the Pi agent dir for the sandbox-agent engine
(`engines/sandbox_agent.ts`). The per-run agent dir isolation (`prepareLocalAgentDir`) and the
Daytona fresh-sandbox property already keep one run's skills out of the next, so author-provided
skills inherit that isolation for free.

### Composing with the forced Agenta skills

The forced set is no longer a list of names in the adapter. It becomes the platform default
skills that the project-creation step seeds and embeds (see "How references work"). By the time
`AgentaHarness._to_harness_config` runs, those defaults are already resolved `SkillConfig`
entries in the author's config, so the adapter does not need a separate `force_skills` name
list. If we still want a runtime guarantee that a default skill is present even when an author's
stored config predates seeding, the adapter can union a resolved default package into the list,
order-stable and de-duplicated by name, with the default winning a name collision and the runner
emitting a visible warning. `PiHarness` and `ClaudeHarness` gain the same plumbing so a plain-Pi
or Claude run can also carry skills. Pi loads them the same way. Claude's SDK does not load
SKILL.md, so the adapter logs and drops them, the same graceful degrade the survey calls for.

### Resolving F-008 (the relative-path problem)

An earlier draft claimed F-008 is "the model is never told the skill's location, so stamp the
absolute dir into the body." A code check disproves the premise. Pi **0.79.4 already emits the
skill's absolute location and a resolution instruction** in the system prompt. In
`dist/core/skills.js`, `formatSkillsForPrompt` writes `<location>${skill.filePath}</location>`
per skill, and the skills preamble already says: *"When a skill file references a relative path,
resolve it against the skill directory (parent of SKILL.md / dirname of the path) and use that
absolute path in tool commands."* This is the same Pi version the QA run hit. So the path **is**
in the prompt and the guidance **is** there.

That changes the fix. F-008 is not a missing-data problem. The QA model, given the location and
the instruction, still ran `scripts/foo.py` against cwd. Two honest options:

1. **Author-side, no runner change.** Document the convention for inline skills: in the `body`,
   reference scripts as `${SKILL_DIR}/scripts/foo.py` or instruct the model to read the
   `<location>` first. The runner can substitute a real `${SKILL_DIR}` token at materialize time
   (it knows the dir), which is the portable analogue of Claude's `${CLAUDE_SKILL_DIR}` and is a
   concrete, testable fix rather than relying on the model to follow a global hint.
2. **Verify first.** Reproduce F-008 against current Pi and confirm whether the failure persists
   now that `<location>` and the resolution instruction are present.

Net: the skills schema makes author-provided skills *possible*; closing F-008 is a small,
separate, **verify-then-fix** task that the inline path should carry, not a guaranteed side
effect of the schema.

## Security: executable skills follow the sandbox policy (F-010)

A skill that ships `files` with a `scripts/` entry is **author-supplied code that the model may
be able to execute** through the harness's shell tool. Whether it can execute is a
sandbox/harness/agent policy decision, not a property of the schema. For the MVP, executable
bundled files default to **off** (`allow_executable_files: False`), and the runner refuses to
`chmod +x` or advertise script execution unless the selected sandbox policy allows it. This is
the same posture for an inline skill and for one resolved from an embed, because both land as
the same materialized content.

The trust story is no longer "platform-reviewed repo content." It is two cases, both enforced
upstream of the runner:

- **A platform default skill** is a workflow revision the platform created and locked. Trust
  comes from the platform authoring it and the revision being non-editable, not from a repo
  bundle.
- **An author skill** (inline, or an embed the author owns) is author-controlled content. It is
  untrusted, and its executable files are governed by the sandbox policy.

When execution is allowed, skill scripts are a broader surface than typed `code` tools on two
axes:

1. **Potentially weaker isolation.** A `code` tool runs through a bounded executor: an
   allowlisted env (`BASE_ENV_ALLOWLIST` plus the tool's scoped secrets), a per-call timeout,
   and a temp-dir cwd (`services/agent/src/tools/code.ts`). A skill script may run through the
   harness shell. In the current Pi path, `getShellEnv` (`dist/utils/shell.js`) spreads the
   **entire `process.env`** into the shell, so the script inherits every var in that process
   unless the surrounding sandbox policy removes or proxies it.
2. **Looser invocation.** A `code` tool is a declared, schema-bounded call the model makes by
   name with typed arguments. A skill script is **arbitrary shell the model composes at will**:
   the SKILL.md tells it `run scripts/foo.py`, and it does, with any arguments and any followup
   commands. There is no schema boundary on what runs.

Design constraints:

- **Gate executable skill files behind the sandbox/harness policy.** The relevant control is
  what the shell can touch (env, network, filesystem), which is a broader surface than the
  `code`-tool executor. Default deny for MVP; allow only when the selected sandbox explicitly
  supports shell execution for author-controlled files.
- **Treat materialized script files as untrusted.** The resolver should tag them with their
  provenance so the execution layer can apply the shell policy, and the `SkillFile` schema
  carries a doc note that `content` is untrusted code.

The proposal does not solve F-010. It makes the decision explicit: author-controlled executable
skill files are off by default, and turning them on is a sandbox policy choice.

## Harness-neutral shape, per-harness mapping

The `skills` field stays harness-agnostic. Each Harness adapter maps it the way it maps tools:

- **Pi / Agenta**: load via the agent dir (`additionalSkillPaths` in-process; the agent dir's
  `skills/` over ACP). The forced `read` tool is what makes Pi surface them; the Agenta harness
  already forces `read`, and `PiHarness` would need to ensure `read` is present when skills are
  set (or the skills load but never appear, worth a validation warning).
- **Claude**: Claude Code loads skills from `.claude/skills/`, but the Claude *Agent SDK* path
  we drive does not load SKILL.md (per the survey). So `ClaudeHarness` logs and drops skills
  today, the same graceful degrade it already does for Pi built-in tools. If we later drive
  Claude such that it reads `.claude/skills/`, the same resolved dirs map there.
- **A skill-less harness** (or Antigravity's SDK path): ignores the field. The neutral config
  never assumes the harness can load a skill; an unsupported harness drops it with a log, never
  an error.

## Playground / catalog surface

`AgentConfigSchema` (`sdk/utils/types.py`) gains a `skills: List[SkillConfig]` field next to
`tools` and `mcp_servers`, so the catalog type emits a typed editor and the playground renders a
skills control (a `SkillConfigControl`, sibling of the tool/MCP controls). The default config in
`schemas.py` adds `"skills": []`. The runtime `AgentConfig` stays permissive and coerces; the
catalog model is strict and describes. Because a referenced skill is an `@ag.embed`, the
playground reuses whatever embed-authoring affordance the config editor already has for embeds,
rather than a skill-specific reference picker. The *UI for authoring an inline skill* (the form,
the file upload) is out of scope here, as stated in the brief. This defines the schema the
control binds to.

## Scope and order of work

Recommended landing order, smallest reversible steps first:

1. **`SkillConfig` model + `skills` on `AgentConfig` + the middleware embed fix** (SDK). Add the
   inline `SkillConfig` model. Parse `skills` in `AgentConfig.from_params` (today it parses only
   instructions/model/tools, plus MCP separately, so an unparsed `skills` would be silently
   dropped, the same way `mcp_servers` needed its own `_parse_mcp_servers_raw`). Fix
   `ResolverMiddleware` to resolve embeds on the effective parameters (inline or revision), so
   embeds resolve on both paths and `skills` is concrete at parse time. Move skills onto a
   `wire_skills()` seam off `wire_tools()`. Add a contract test for inline-param embed
   resolution.
2. **Wire + runner materializer** (`wire.py`, `protocol.ts`, golden fixtures, both contract
   tests, `engines/skills.ts`). Replace `skills?: string[]` with the resolved `WireSkill` shape.
   Rewrite `resolveSkillDirs` to materialize concrete packages and drop name/absolute-path
   resolution. Keep executable files disabled by default.
3. **Catalog type + playground default** (`AgentConfigSchema`, `schemas.py`). The config is now
   author-editable for inline skills, and embed references reuse the existing embed editor.
4. **`is_skill` workflow family + lock + seeding.** Add the `is_skill` artifact family flag
   across the API DTOs, the SDK flag models, and the SDK flag-derivation, committing skills with
   explicit `is_skill=True, is_evaluator=False` (a URI-less workflow otherwise derives
   `is_evaluator`). Add the `skill_config` catalog type (payload at `parameters.skill`) and a
   `skills` field on the `AgentConfigSchema` catalog twin. Add a lock mechanism, which does not
   exist today: an `is_locked` flag on the JSONB workflow flags plus service-layer guards on
   edit / commit / archive (no migration needed). Seed the platform default skills as
   `is_skill=True, is_locked=True` revisions at project creation (mirror `create_default_evaluators`
   off `commoners.py`), with fixed canonical slugs, and inject the canonical
   `@ag.selector[path: parameters.skill]` embed into the service default agent config
   (`_DEFAULT_AGENT_CONFIG`). This replaces `AGENTA_FORCED_SKILLS` and is the home for what used
   to be "forced skills."
5. **Per-harness validation + F-010 + F-008**: warn when skills are set but `read` is absent
   (Pi), or when the harness cannot load skills (Claude SDK path); enable executable files only
   through the sandbox/harness policy; carry the separate verify-then-fix for F-008.

## Recommendation

Implement in the order above. Steps 1 through 3 deliver the inline-skill capability and the
reference path together, because references are just `@ag.embed` plus the one resolution call,
and the array traversal they need already exists in the resolver. There is no separate "curated
selector" phase, because there is no curated-by-name concept anymore.

Step 4 (seeding locked default skills at project creation) is what replaces the hardcoded forced
skill. It is the product mechanism for "every project ships with these skills and the author
cannot remove them," and it lives in project creation, not in the agent config schema.

Hold the line on execution. Author-controlled executable skill files stay off by default. Do
**not** allow them before the bash/shell sandbox policy (F-010) says where they run and what
they can touch.

The single most important property: a skill is just content, referenced or inline, resolved to
one shape before the runner. Trust is enforced upstream (a platform-locked revision, or the
author's own embed) and the execution surface is governed by sandbox policy. Everything else
(dropping the `source` union, reusing `@ag.embed`, the `wire_skills()` seam, the F-008
correction) follows from collapsing the schema to that one idea.
