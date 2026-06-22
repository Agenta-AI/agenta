# Proposal: a `skills` field on the neutral agent config

This proposes a `skills` field on the neutral `AgentConfig`, a sibling of `tools` and
`mcp_servers`, so an agent author can ship their own skill. The harness survey that justifies
the shape is in [research.md](research.md). This is a design proposal. It does not change
`dtos.py` or the runtime.

The proposal in one sentence: add a `skills: List[SkillConfig]` field whose entries are a
discriminated union over a `source` (`curated`: reference a platform skill by validated
registry name, what the runner already resolves; `workflow`: reference a versioned Agenta
workflow revision whose resolved data is a skill package; or `inline`: an author-provided
SKILL.md body plus optional files that ride the wire and are materialized into the agent dir).
It mirrors the `tools` union and unions with the harness's forced skills, keeping a hard line
between trusted curated names and untrusted author-controlled content.

This version folds in an xhigh Codex review. The corrections it forced: keep three distinct
type layers (config / wire / materialized, not one `ResolvedSkill`), keep curated-first as a
*no-wire-change* phase, give skills their own `wire_skills()` seam off the tool wire, drop the
`enabled` flag (the tools union has none), and two factual fixes covered below. The single most
important point: draw a hard boundary between trusted platform skill names and untrusted
author-controlled content. This revision also folds in product feedback: workflow-backed
skills are a source variant, and executable bundled files are controlled by sandbox policy with
a default-deny MVP posture.

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
**directory with a `SKILL.md`**: YAML frontmatter (`name` + `description`), a Markdown body,
and bundled `scripts/` / `references/` / `assets/` referenced by relative path, loaded
progressively. Pi, Claude Code, OpenCode, and Antigravity all read `name` and `description`;
Pi and Claude also honor `disable-model-invocation`. Pi has one extra surfacing rule in our
current runner path: it renders skills in the prompt only when the `read` tool is present. So
the portable config shape is **`name` + `description` + body + optional files**, and each
harness adapter maps that package to the filesystem location its harness loads.

## The schema

A new model, `SkillConfig`, mirrors the `ToolConfig` discriminated union (`agents/tools/
models.py`): a `source` discriminator and an `extra="forbid"` base. Three variants today:
platform-curated skills, workflow-backed skills, and inline skill content. When a variant
carries a skill `name`, it is strictly validated (the harness rule), and on the curated variant
it is a **registry key, not a path**. There is no `enabled` flag (`ToolConfig` has none either;
omit a skill to not ship it).

```python
# sdk/agents/skills/models.py  (new module, sibling of tools/ and mcp/)

# Harness skill-name rule (Pi/Claude/OpenCode/Antigravity): lowercase, digits, single
# hyphens, <=64 chars. Reused by all skill-package variants; on curated it also forbids path traversal
# (no `/`, no `..`, no absolute path) so an author can never point the runner at a host dir.
_SKILL_NAME = Field(min_length=1, max_length=64, pattern=r"^[a-z0-9]+(-[a-z0-9]+)*$")

class SkillConfigBase(BaseModel):
    model_config = ConfigDict(extra="forbid")

class CuratedSkillConfig(SkillConfigBase):
    """Reference a platform-curated / bundled skill by REGISTRY NAME. The name is a key the
    runner looks up under its skills root (services/agent/skills/<name>/); the pattern blocks
    path traversal, so an author can never name an arbitrary host directory. Only the name
    rides the wire; the runner resolves the bundled dir."""
    source: Literal["curated"] = "curated"
    name: str = _SKILL_NAME   # registry key, NOT a path

class SkillFile(BaseModel):
    """One bundled file laid beside SKILL.md, by relative path. `content` is inline text
    (UTF-8); a future `uri` variant can reference blob storage for binary assets. `path` is
    validated to a safe relative path (no leading `/`, no `..`) so a file cannot escape the
    skill dir on materialize."""
    model_config = ConfigDict(extra="forbid")
    path: str = Field(min_length=1, max_length=255)   # safe relative path, e.g. "scripts/foo.py"
    content: str = Field(max_length=200_000)          # UTF-8 (binary -> a later uri variant)
    executable: bool = False                          # chmod +x only if policy allows it

class InlineSkillConfig(SkillConfigBase):
    """An author-provided skill. The SKILL.md frontmatter + body and any bundled files
    ride the wire as content; the runner materializes them into a skill dir at run time.
    `name` and `description` are the two portable frontmatter fields (every harness reads
    them); `body` is the SKILL.md Markdown the runner writes after the composed frontmatter."""
    source: Literal["inline"] = "inline"
    name: str = _SKILL_NAME
    description: str = Field(min_length=1, max_length=1024)  # the trigger; required everywhere
    body: str = Field(min_length=1, max_length=50_000)      # the SKILL.md Markdown body
    files: List[SkillFile] = Field(default_factory=list)    # bundled scripts / references
    disable_model_invocation: bool = False  # Pi/Claude: hide from prompt, only /skill:name
    allow_executable_files: bool = False    # default deny; sandbox policy must also allow

class WorkflowSkillConfig(SkillConfigBase):
    """Reference a versioned Agenta workflow whose resolved data is a skill package.
    This is for custom workflows that are authored and versioned as skills. The backend
    resolves the workflow revision (including existing @ag.embed references) before the
    runner contract is built, then lowers the resolved package to the same materialization
    path as an inline skill. The runner does not get database access or workflow refs."""
    source: Literal["workflow"] = "workflow"
    workflow_revision_ref: Reference
    selector: Optional[str] = Field(
        default=None,
        description="Optional dot path inside the resolved workflow data when the skill package is nested.",
    )
    allow_executable_files: bool = False

SkillConfig = Annotated[
    Union[CuratedSkillConfig, WorkflowSkillConfig, InlineSkillConfig],
    Field(discriminator="source"),
]
```

(`source` vs `type`: the tools union uses `type`. Using `type` here would be the more literal
mirror and read identically to the playground's union dispatcher; `source` reads better as
"where the skill comes from." The proposal uses `source`; a reviewer preferring exact symmetry
with `ToolConfig` should use `type`.)

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

The list shape is still the right shape even with custom workflows. The list is the ordered set
of skills an agent asks for; the `source` on each item says where that skill package comes
from. A workflow-backed skill is therefore one list item, not a nested list. If a future custom
workflow intentionally produces a bundle of many skills, that should be a separate
`workflow_bundle` variant or an explicit expansion step, because hiding many materialized
skills behind one list item makes ordering, name collisions, and audit logs ambiguous.

### Field rationale

- **`source` discriminator, not a bare name list.** A bare `List[str]` would only ever name
  curated skills and could never carry an author's own SKILL.md. The union keeps the curated
  path (today's behavior, zero new wire) and adds workflow/inline author-content paths in one
  field, exactly the way `tools` keeps `builtin` next to `code` / `gateway` / `client`. It is
  the shape the rest of the config already uses, so the playground gets a typed editor for free
  (`AgentConfigSchema` lists `SkillConfig` like it lists `ToolConfig`).
- **`name` + `description` are the portable two.** Every harness reads them; the description
  is the trigger the model matches. They are required on the inline variant and length-bounded
  to the harness rule (≤64 / ≤1024), which the survey shows is common to Pi, Claude, OpenCode,
  and Antigravity.
- **`body` is the SKILL.md Markdown.** The runner composes the frontmatter from
  `name`/`description` and writes the body, so the author writes Markdown, not raw frontmatter.
  (`body`, not `instructions`, to avoid colliding with `AgentConfig.instructions`, which is the
  AGENTS.md and a different layer. If we later want authors to paste a full SKILL.md verbatim,
  add an optional `skill_md: str` that, when present, supersedes the composed frontmatter, a
  non-breaking addition.)
- **`files` carries bundled scripts/references inline.** This is what makes "skills with code"
  reachable (F-003). Inline UTF-8 content matches the runner's current Daytona uploader, which
  is text-only (`writeFsFile` takes a string body). Binary assets are a follow-up via a `uri`
  file variant.
- **`workflow` references custom workflows that are skills.** Some skills should be authored,
  embedded, reviewed, and versioned through Agenta workflows rather than pasted inline. The
  workflow variant points at a workflow revision, resolves existing `@ag.embed` references on
  the backend, selects the skill package from the resolved data, validates it as the same
  package shape as `inline`, and then lowers it to the runner materialization path. It does not
  give the runner workflow database access.
- **No `enabled` flag.** `ToolConfig` has none (a tool is shipped or it is absent from the
  list), so adding one to skills would not mirror the existing ergonomics. Omit a skill to not
  ship it.
- **`disable_model_invocation`** is the one extra-portable frontmatter field Pi and Claude both
  honor (hide from the prompt, invoke only via `/skill:name`). Carried so an author can ship a
  manual-only skill; ignored by a harness that does not support it.

### Recommended delivery model: support all three, lead with curated

Recommend shipping all three source variants, but in order:

1. **`curated` first.** It is a name on the wire and the runner already resolves it. This
   unblocks F-003's "name a platform skill" case with no new runner code and no new security
   surface. Crucially, curated-first **keeps the existing `skills?: string[]` wire**: the new
   `SkillConfig` is a config-layer concept that the SDK flattens to the current name list when
   every entry is curated, so the golden wire fixture and `protocol.ts` are untouched in phase
   one. It also generalizes the forced-skills mechanism: the forced set becomes "curated skills
   the author cannot remove," and an author's curated `skills` union into the same set.
2. **`workflow` and `inline` second.** These are the "author ships their own skill" paths.
   `workflow` is the better product shape when the skill is a reusable custom workflow revision;
   `inline` is the direct API/config shape. Both lower to author-controlled skill content and
   need runner materialization (below). Both must respect the sandbox/harness execution policy,
   with executable bundled files disabled by default for the MVP.

This mirrors how `tools` shipped: `builtin` (names) first, then `code` (author content with an
execution surface). Be honest about the split: phase one is a safe, useful selector; phase two
is where the headline capability and the real risk both live.

## How it maps to the wire and the runner

### Wire (`utils/wire.py` + `services/agent/src/protocol.ts`)

Keep three layers of type distinct (the proposal earlier conflated them under one
`ResolvedSkill` name, which was wrong, because a curated entry on the wire is *not* resolved):

- **`SkillConfig`** (config layer): the author-facing union above.
- **`WireSkill`** (wire layer): what rides `/run`. Phase two only.
- **`MaterializedSkill`** (`{name, dir}`, runner layer): the output of materialization, what
  the install paths consume. Internal to the runner; never on the wire.

**Phase one (curated): no wire change.** `AgentaAgentConfig` today emits `"skills":
list(self.skills)` (a `List[str]`) and `protocol.ts` declares `skills?: string[]`. When every
`SkillConfig` is curated, the SDK flattens it to that same `List[str]` of names. The wire, the
golden fixture, and `protocol.ts` are unchanged. `resolveSkillDirs` still maps each name to a
bundled dir.

**Phase two (workflow + inline): a deliberate wire-contract change.** Carrying author content
needs a richer `skills` field. The backend resolves `workflow` entries before building the
runner request, so the runner only sees `curated` names and already-resolved author skill
packages. Replace `skills?: string[]` with a discriminated `WireSkill[]`:

```ts
// protocol.ts (phase two): replaces `skills?: string[]`
type WireSkill =
  | { source: "curated"; name: string }
  | { source: "inline"; name: string; description: string; body: string;
      files?: { path: string; content: string; executable?: boolean }[];
      disableModelInvocation?: boolean; allowExecutableFiles?: boolean };
interface AgentRunRequest { /* ... */ skills?: WireSkill[]; }
```

On the Python side a `skills_to_wire` helper (sibling of `mcp_servers_to_wire`) serializes
curated and inline entries to a `WireSkill`. Workflow entries are resolved and lowered to the
inline wire package before that helper runs; unresolved workflow refs are a config/service
error, not a runner concern. Per `services/agent/CLAUDE.md` this touches the golden fixtures,
`protocol.ts`, `wire.py`, and both contract tests together, deliberately.

Back-compat: still accept a bare `["name", ...]` on input and coerce each string to a curated
entry, so already-stored configs and the forced-skill list keep working.

**Where it leaves the config (a layering fix).** Today `skills` is emitted inside
`AgentaAgentConfig.wire_tools()`, which was a shortcut: skills are not tools. Give the base
`HarnessAgentConfig` a `wire_skills()` method (sibling of the existing `wire_tools()` /
`wire_prompt()` / `wire_mcp()`), default empty, that a skill-loading harness overrides.
`request_to_wire` spreads `**config.wire_skills()` alongside the others. This moves skills out
of the tool wire and onto their own seam, so `PiHarness` (not just `AgentaHarness`) can emit
them.

### Runner (`engines/skills.ts`, `pi.ts`, `sandbox_agent.ts`)

`resolveSkillDirs` today takes `string[]` and returns bundled dirs. In phase two the contract
takes `WireSkill[]` and returns `MaterializedSkill[]` (a `{name, dir}` per skill),
materializing author-provided skill packages first:

- **curated** → unchanged: resolve the name against `SKILLS_ROOT`, return the bundled dir. The
  name is validated upstream (the `_SKILL_NAME` pattern), and `resolveSkillDirs` must **stop
  honoring absolute paths** for a curated name (today it does, see "Security"): a curated skill
  is a registry key, never a host path.
- **inline / resolved workflow** -> write a fresh dir under a per-run temp root: compose
  `SKILL.md` from `name`/`description`/`body`, then write each `files[]` entry at its relative
  `path` (re-validate it stays under the skill dir, create parent dirs, `chmod +x` only when
  `allowExecutableFiles` is true and the sandbox/harness policy allows execution). Return that
  dir.

All materialized skill dirs then flow through the existing install paths unchanged:
`additionalSkillPaths` for the in-process Pi engine (`engines/pi.ts`), `installSkillsLocal` /
`uploadSkillsToSandbox` into the Pi agent dir for the sandbox-agent engine (`engines/sandbox_agent.ts`). The
per-run agent dir isolation (`prepareLocalAgentDir`) and the Daytona fresh-sandbox property
already keep one run's skills out of the next, so author-provided skills inherit that isolation
for free.

### Composing with the forced Agenta skills

`AgentaHarness._to_harness_config` keeps forcing its skills, now unioned with the author's
skills, order-stable and de-duplicated by name. A `force_skills` helper sits next to
`force_tools` in `agenta_builtins.py`. Note the ordering: `force_tools` appends the forced set
*after* the author's tools (`list(builtin_tools) + AGENTA_FORCED_TOOLS`), so author entries
come first and a forced entry only adds when not already present. `force_skills` should follow
the **same author-first order** for consistency. A collision (author names a skill that is also
forced) must not silently drop one: the forced skill wins (the author cannot override a forced
skill's content) and the runner emits a visible warning, so the author is not surprised by a
name they thought they controlled. `PiHarness` and `ClaudeHarness` gain the same plumbing so a
plain-Pi or Claude run can also carry author skills (Pi loads them the same way; Claude's SDK
does not load SKILL.md, so the adapter logs and drops them, the same graceful degrade the
survey calls for; see "per-harness mapping" below).

### Resolving F-008 (the relative-path problem): corrected

An earlier draft claimed F-008 is "the model is never told the skill's location, so stamp the
absolute dir into the body." A code check disproves the premise. Pi **0.79.4 already emits the
skill's absolute location and a resolution instruction** in the system prompt. In
`dist/core/skills.js` `formatSkillsForPrompt` writes `<location>${skill.filePath}</location>`
per skill, and the skills preamble already says: *"When a skill file references a relative
path, resolve it against the skill directory (parent of SKILL.md / dirname of the path) and use
that absolute path in tool commands."* This is the same Pi version the QA run hit. So the path
**is** in the prompt and the guidance **is** there.

That changes the fix. F-008 is not a missing-data problem; it is that the QA model, given the
location and the instruction, still ran `scripts/foo.py` against cwd. Possible causes: the
location is on each skill's metadata line but not adjacent to the relative reference the model
reads in the body; or the model under-followed the global instruction. So the schema does not
"fix" F-008 by itself. Two honest options:

1. **Author-side, no runner change.** Document the convention for inline skills: in the `body`,
   reference scripts as `${SKILL_DIR}/scripts/foo.py` or instruct the model to read the
   `<location>` first. The runner can substitute a real `${SKILL_DIR}` token at materialize time
   (it knows the dir), which is the portable analogue of Claude's `${CLAUDE_SKILL_DIR}` and is
   a concrete, testable fix rather than relying on the model to follow a global hint.
2. **Verify first.** Before building anything, reproduce F-008 against current Pi and confirm
   whether the failure persists now that `<location>` + the resolution instruction are present
   (the finding predates a close read of this Pi version). The fix may already be a
   documentation-and-token change, not a prompt-stamping change.

Net: the skills schema makes author-provided skills *possible*; closing F-008 is a small,
separate, **verify-then-fix** task that the workflow/inline path should carry, not a guaranteed
side effect of the schema. The proposal no longer claims the schema resolves F-008 on its own.

## Security: executable skills follow the sandbox policy (F-010)

An inline or workflow-backed skill that ships `files` with a `scripts/` entry is
**author-supplied code that the model may be able to execute** through the harness's shell
tool. Whether it can execute is a sandbox/harness/agent policy decision, not a property of the
schema. For the MVP, executable bundled files default to **off** (`allow_executable_files:
False`), and the runner refuses to `chmod +x` or advertise script execution unless the selected
sandbox policy allows it.

When execution is allowed, skill scripts are a broader surface than typed `code` tools on two
axes:

1. **Potentially weaker isolation.** A `code` tool runs through a bounded executor: an
   allowlisted env (`BASE_ENV_ALLOWLIST` plus the tool's scoped secrets), a per-call timeout,
   and a temp-dir cwd (`services/agent/src/tools/code.ts`). A skill script may run through the
   harness shell. In the current Pi path, `getShellEnv` (`dist/utils/shell.js`) spreads the
   **entire `process.env`** into the shell, so the script inherits every var in that process
   unless the surrounding sandbox policy removes or proxies it. F-010 already flags that code
   tools need a real execution boundary; executable skills need the same boundary at the shell
   layer.
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
- **The curated path carries no new code surface.** Bundled skills are platform-reviewed and
  committed to the repo. This is another reason to ship curated first and keep executable
  author files default-deny.

The proposal does not solve F-010. It makes the decision explicit: author-controlled
executable skill files are off by default, and turning them on is a sandbox policy choice.

## Harness-neutral shape, per-harness mapping

The `skills` field stays harness-agnostic. Each Harness adapter maps it the way it maps tools:

- **Pi / Agenta**: load via the agent dir (`additionalSkillPaths` in-process; the agent dir's
  `skills/` over ACP). The forced `read` tool is what makes Pi surface them; the Agenta harness
  already forces `read`, and `PiHarness` would need to ensure `read` is present when skills are
  set (or the skills load but never appear, worth a validation warning).
- **Claude**: Claude Code loads skills from `.claude/skills/`, but the Claude *Agent SDK*
  path we drive does not load SKILL.md (per the survey). So `ClaudeHarness` logs and drops
  author skills today, the same graceful degrade it already does for Pi built-in tools. If we
  later drive Claude such that it reads `.claude/skills/`, the same resolved dirs map there.
- **A skill-less harness** (or Antigravity's SDK path): ignores the field. The neutral config
  never assumes the harness can load a skill; an unsupported harness drops it with a log, never
  an error.

## Playground / catalog surface

`AgentConfigSchema` (`sdk/utils/types.py`) gains a `skills: List[SkillConfig]` field next to
`tools` and `mcp_servers`, so the catalog type emits a typed editor and the playground renders
a skills control (a `SkillConfigControl`, sibling of the tool/MCP controls). The default config
in `schemas.py` adds `"skills": []`. The runtime `AgentConfig` stays permissive and coerces;
the catalog model is strict and describes. The *UI for authoring a skill* (the form, the file
upload) is out of scope here, as stated in the brief. This defines the schema the control
binds to.

## Scope and order of work

Recommended landing order, smallest reversible steps first:

1. **`SkillConfig` model + curated variant + `skills` on `AgentConfig`** (SDK only). Coerce a
   bare name list to curated entries. Parse `skills` in `AgentConfig.from_params` (today it
   parses only instructions/model/tools, plus MCP separately, so an unparsed `skills` would be
   silently dropped, the same way `mcp_servers` needed its own `_parse_mcp_servers_raw`). Union
   author curated skills with the forced set via a new `force_skills` helper in the three
   harness adapters. **The wire is unchanged** (curated flattens to the existing `string[]`).
   Move skills onto a `wire_skills()` seam off `wire_tools()`. This closes F-003 for the "name a
   platform skill" case with no runner change and no security surface.
2. **Catalog type + playground default** (`AgentConfigSchema`, `schemas.py`). The config is now
   author-editable for curated skills.
3. **Workflow + inline variants end to end**: workflow-revision resolution and selector
   validation, the wire change (golden + `protocol.ts` + `wire.py` + both contract tests,
   `WireSkill[]` replacing `string[]`), the runner materializer in `engines/skills.ts` (with
   curated-name path hardening), and the separate **verify-then-fix** for F-008. Keep
   executable files disabled by default, and enable them only through the sandbox/harness
   policy.
4. **Per-harness validation**: warn when skills are set but `read` is absent (Pi), or when the
   harness cannot load skills (Claude SDK path).

A safety fix worth pulling forward into step 1 regardless of phasing: `resolveSkillDirs`
(`engines/skills.ts`) today honors **absolute paths** for a skill name. The moment `skills` is
author-facing, that is a path-traversal vector (an author names `/etc/...` or a host dir). The
`_SKILL_NAME` pattern blocks it at the config layer, but the runner should also stop honoring
absolute paths for curated names. Land that with step 1.

## Recommendation

Implement, in the order above. Steps 1 and 2 are low-risk, reuse the existing tool-union and
forced-union machinery, and unblock the most common case (ship a curated skill) with no new
security surface and no wire change. They are worth doing now.

Step 3 (workflow/inline skills with author content) is the *actual* headline capability
("author ships their own skill"), and it is where the real risk lives: a wire-contract change,
workflow-reference resolution, and a possible shell-execution surface. Ship the content path
with executable files disabled by default. Do **not** allow executable bundled files before the
bash/shell sandbox policy (F-010) says where they run and what they can touch. Curated-only is
a complete, useful, and safe increment until then.

The single most important fix from review: keep a hard boundary between **trusted platform
skill names** (curated, a validated registry key) and **untrusted author-controlled content**
(workflow/inline, with executable files governed by sandbox policy). Everything else (the
type-name split, the `wire_skills()` seam, the F-008 correction, dropping `enabled`) follows
from drawing that line cleanly.
