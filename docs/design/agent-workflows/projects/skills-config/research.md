# Skills across coding-agent harnesses: a survey

This is the research half of the skills-config design. It surveys how four coding-agent
harnesses define a "skill", then names the common denominator and where they differ. The
schema proposal that builds on it is in [proposal.md](proposal.md).

The question we are answering: what is the portable shape of a skill, so Agenta can expose
`skills` on its neutral agent config next to `tools` and `mcp_servers`?

## TL;DR

Every harness that has skills converged on the same unit. A skill is **a directory whose
entrypoint is a `SKILL.md` file**: YAML frontmatter with a `name` and a `description`, then a
Markdown body of instructions. Bundled scripts and reference files sit beside `SKILL.md` and
the body references them by relative path. The agent always sees only `name` + `description`
up front (cheap), and reads the full body on demand (progressive disclosure). The description
is the trigger: the model decides to load a skill by matching the task to it.

The harnesses differ only at the edges: which extra frontmatter fields they parse (Claude
Code has the richest set; OpenCode, Pi, and Antigravity parse a reduced subset), where they
look on disk (scope precedence), how strict they are about validation, and how the skill gets
*into* the agent (filesystem discovery vs an upload API). All four (Claude Code, Pi,
OpenCode, and Google Antigravity) share the same `SKILL.md` directory unit. Antigravity adds
one useful confirmation: its SDK wires config programmatically and leaves file-based skills to
the IDE/CLI runner, the same config-vs-runner split we have.

## Claude Code (the reference model)

Claude Code's "Agent Skills" follow the open [Agent Skills standard](https://agentskills.io)
and extend it. This is the most mature model, so we treat it as the reference.

**Format.** A skill is a folder with a `SKILL.md` at its root: YAML frontmatter between `---`
markers, then a Markdown instructions body
(https://platform.claude.com/docs/en/agents-and-tools/agent-skills/overview). The standard
requires only two frontmatter fields:

- `name`: unique identifier or display label. Max 64 characters, lowercase letters + digits +
  hyphens, no XML tags, and may not contain the reserved words `anthropic` or `claude`
  (https://platform.claude.com/docs/en/agents-and-tools/agent-skills/best-practices).
- `description`: what the skill does and when to use it. Non-empty, max 1024 characters
  (API surface). This field drives whether the model loads the skill, so best practice is
  third person and explicit trigger keywords (same URL).

The Claude Code CLI surface parses a much larger optional frontmatter set, all of which are
Claude-Code-specific extensions, not part of the portable standard
(https://code.claude.com/docs/en/skills): `allowed-tools` and `disallowed-tools` (tool
gating), `disable-model-invocation` (manual `/name` only), `user-invocable` (hide from the
`/` menu), `when_to_use`, `argument-hint` / `arguments` ($-substitution), `model` / `effort`
(per-turn overrides), `context: fork` + `agent` (run the skill inside a subagent), `hooks`,
`paths` (glob gating of auto-activation), and `shell`. The docs do **not** define `license`,
`version`, or a `metadata` block for Claude Code SKILL.md.

**Directory layout.** "A skill is simply a folder with a `SKILL.md` file"
(https://github.com/anthropics/skills). The canonical structure
(https://code.claude.com/docs/en/skills):

```
my-skill/
├── SKILL.md           # required entrypoint
├── reference.md       # loaded on demand
├── examples/
│   └── sample.md
└── scripts/
    └── helper.py      # executed, not read into context
```

Conventional subdirs are `scripts/` (executable helpers), `references/` (reference markdown),
and `assets/` (templates). The body references bundled files by relative Markdown path
(`See reference/finance.md`) and invokes scripts by relative path
(`python scripts/fill_form.py ...`)
(https://platform.claude.com/docs/en/agents-and-tools/agent-skills/best-practices). On the
CLI, `${CLAUDE_SKILL_DIR}` resolves the skill's own directory so script paths work regardless
of cwd (https://code.claude.com/docs/en/skills). This is the kind of explicit path token the
F-008 verify-then-fix path may need if Pi's prompt-level `<location>` instruction is not
reliable enough.

**`allowed-tools`.** Pre-approves tools for use without a permission prompt while the skill is
active; it grants, it does not restrict. Space/comma list or YAML list, supports gated
patterns like `Bash(git commit *)`. Only honored on the CLI; it does **not** apply through the
Agent SDK (https://docs.claude.com/en/docs/agent-sdk/skills). There is no
`allowed-directories` field.

**Progressive disclosure (the 3-level model).** Metadata (`name` + `description`, ~100 tokens
per skill) is always in the system prompt. When a request matches a description, the agent
reads `SKILL.md` via bash to load the body (under 5k tokens). Bundled files load only when
referenced (scripts are executed, so their code never enters context, only output does);
this tier is "effectively unlimited"
(https://platform.claude.com/docs/en/agents-and-tools/agent-skills/overview). The
**description is the matcher**: it is how Claude chooses among 100+ skills.

**Discovery and scope.** Filesystem-based, by directory: personal `~/.claude/skills/<name>/`,
project `.claude/skills/<name>/`, plugin `<plugin>/skills/<name>/`, plus enterprise/managed.
Precedence is enterprise > personal > project, and any overrides a bundled skill of the same
name; plugin skills are namespaced `plugin:skill` (https://code.claude.com/docs/en/skills).
The directory name (not the `name` field) sets the slash command on the CLI. On the **API /
claude.ai surface** custom skills are *uploaded* instead: the Skills API (`/v1/skills`) or a
zip upload on claude.ai, and they "do not sync across surfaces"
(https://platform.claude.com/docs/en/agents-and-tools/agent-skills/overview). This
filesystem-vs-upload split is the central delivery question for us.

**Limits.** SKILL.md body recommended under 500 lines; `name` max 64; `description` max 1024
(API) / combined `description`+`when_to_use` truncated at 1536 in the CLI listing; no cap on
bundled content (unaccessed files cost zero tokens)
(https://platform.claude.com/docs/en/agents-and-tools/agent-skills/best-practices,
https://code.claude.com/docs/en/skills).

**vs. tools / MCP / commands.** A skill is *instructions/knowledge that load progressively*;
an MCP server provides *executable tools over a protocol*. Skills "complement" MCP by teaching
workflows (https://www.anthropic.com/engineering/equipping-agents-for-the-real-world-with-agent-skills).
On the CLI, custom slash commands were merged into skills (a skill is invocable as
`/skill-name`); a subagent is a separate context that a skill can run inside via `context:
fork`. The takeaway for us: **skills and tools are siblings, not substitutes.**

## Pi (one harness we run)

Pi (`@earendil-works/pi-coding-agent`, the version pinned in the runner is **0.79.4**)
implements the same Agent Skills standard, leniently. It is one of the harnesses our Agenta
runtime drives, so its contract is load-bearing without being the only contract the neutral
schema can assume. Sources are the package's own
`docs/skills.md`, the `dist/core/skills.d.ts` / `dist/core/resource-loader.d.ts` type
declarations, and the compiled `skills.js` / `system-prompt.js`.

**Format.** A skill is a directory containing a `SKILL.md` (the match is exact:
`entry.name === "SKILL.md"`). Frontmatter is YAML. The typed shape Pi reads
(`SkillFrontmatter` in `skills.d.ts`):

```ts
interface SkillFrontmatter {
  name?: string;
  description?: string;
  "disable-model-invocation"?: boolean;
  [key: string]: unknown;   // unknown fields ignored
}
```

Pi's `docs/skills.md` documents a wider frontmatter table (`name`, `description`, `license`,
`compatibility`, `metadata`, `allowed-tools` [experimental], `disable-model-invocation`), but
only `name`, `description`, and `disable-model-invocation` are surfaced on the materialized
`Skill` record. The rest fall through the index signature and are inert. So in practice **Pi
honors `name` + `description` + `disable-model-invocation`** and ignores `allowed-tools`.

**Constraints.** `name` max 64 chars, lowercase + digits + single hyphens; `description` max
1024 chars; `compatibility` max 500. Validation is lenient: a length or charset violation
produces a *warning* and the skill still loads. The one hard failure is a missing/empty
`description` (the skill is not loaded). Name collisions across locations: first found wins,
later dropped. No max skill count and no per-file size cap.

**The loader contract (this is what the runner drives).** `DefaultResourceLoader` takes, among
others (`resource-loader.d.ts`):

```ts
interface DefaultResourceLoaderOptions {
  cwd: string;                      // project-local skills
  agentDir: string;                 // global / user-scope skills
  additionalSkillPaths?: string[];  // explicit extra skill dirs (additive)
  noSkills?: boolean;               // disable default-location discovery
  skillsOverride?: (base) => base;  // post-process the resolved list
  // ...prompt/extension/context-file siblings
}
```

Default discovery, when not `noSkills`, loads exactly two roots: user scope
`join(agentDir, "skills")` (i.e. `~/.pi/agent/skills/`) and project scope
`<cwd>/.pi/skills/` (trust-gated). `additionalSkillPaths` is additive and bypasses the
trust gate, which is exactly how our runner loads bundled skills hermetically (`noSkills:
true` + `additionalSkillPaths`, see `engines/pi.ts`).

**Surfacing rule (verified).** Pi renders the skills section into the system prompt only when
the `read` tool is present (`system-prompt.js`: `hasRead = tools.includes("read")`; the
default tool set is `["read", "bash", "edit", "write"]`). No `read` tool, no skills section,
regardless of how many loaded. This is why `AGENTA_FORCED_TOOLS` forces `read`. Skills with
`disable-model-invocation: true` are excluded from the prompt but still callable via
`/skill:name`. The prompt carries only `name` + `description` (XML, escaped); the body is read
on demand. This is identical progressive disclosure to Claude.

**Net for us:** Pi and Claude share the same SKILL.md shape. Pi's effective field set is the
smaller `{name, description, disable-model-invocation}`. A later code check found that Pi
0.79.4 already includes each skill's `<location>` and a relative-path resolution instruction in
the prompt. So F-008 is not a missing-location problem; it is a verify-then-fix problem where
the model may still ignore the global instruction and run `scripts/foo.py` against cwd.

## OpenCode

OpenCode (the `sst/opencode` terminal agent) added Agent Skills with its own reduced loader.
It is useful as a second neutral data point.

**Format and locations.** One folder per skill with a `SKILL.md` inside, "loaded on-demand via
the native `skill` tool" (https://opencode.ai/docs/skills). OpenCode searches **six** roots,
including the Claude and `.agents` ecosystems, so it ingests Anthropic-formatted skills:

- `.opencode/skills/<name>/SKILL.md` (project) and `~/.config/opencode/skills/<name>/SKILL.md`
  (global)
- `.claude/skills/<name>/SKILL.md` and `~/.claude/skills/<name>/SKILL.md` (Claude-compatible)
- `.agents/skills/<name>/SKILL.md` and `~/.agents/skills/<name>/SKILL.md` (agent-compatible)

**Recognized frontmatter (only these).** `name` (required), `description` (required),
`license`, `compatibility`, `metadata` (string→string map); "unknown frontmatter fields are
ignored" (https://opencode.ai/docs/skills). Notably **`allowed-tools` is not recognized**:
the native loader (`packages/opencode/src/skill/index.ts`) parses only `name` and
`description`. Same name rules as the standard (1–64, `^[a-z0-9]+(-[a-z0-9]+)*$`, must match
the directory name); `description` 1–1024.

**Discovery and gating.** Project-local discovery walks up from cwd to the git worktree root.
Available skills appear as an `<available_skills>` block inside the `skill` tool's
description; the agent loads one with `skill({ name })`. Skill *permissions* live in config
under `permission.skill` (wildcard → `allow`/`deny`/`ask`), but there is **no top-level
`skills` config key**: skills are filesystem-discovered, not config-declared
(https://opencode.ai/docs/skills, https://opencode.ai/docs/config). The docs call out the
context-budget tradeoff explicitly: skills load lazily (cheap), MCP loads eagerly (expensive).

OpenCode's broader extension model is worth noting for the proposal's framing: skills, agents
(markdown-or-JSON personas), and commands (markdown-or-JSON prompt macros) are three distinct
surfaces, all using the same dual definition pattern (a markdown file in
`.opencode/<plural>/` OR an inline JSON object under the matching config key). Skills are the
filesystem-only one of the three.

## Google Antigravity

Antigravity (Google's Gemini-based agentic IDE + CLI + SDK) has **first-class `SKILL.md`
skills**, modeled on the same Anthropic pattern. This is the fourth confirming data point, not
an outlier as an earlier pass assumed.

**Format and layout.** A skill is "a directory-based package containing a definition file
(SKILL.md) and optional supporting assets (scripts, references, templates)" that stays dormant
and loads into context only when the request semantically matches its description
(https://codelabs.developers.google.com/getting-started-with-antigravity-skills). The
`SKILL.md` is YAML frontmatter + a Markdown body. Frontmatter fields: `name` (optional,
lowercase-hyphen, defaults to the directory name) and `description` (**mandatory, "the most
important field"**, the semantic trigger). Bundled assets sit in `scripts/`, `references/` /
`resources/`, `examples/`, `assets/` and the body invokes them by relative path
(`python scripts/query_runner.py "..."`)
(https://medium.com/google-cloud/tutorial-getting-started-with-antigravity-skills-864041811e0d).
This is the same shape as Claude, Pi, and OpenCode.

**Locations.** Global `~/.gemini/config/skills/`, workspace `<project-root>/.agents/skills/`
(plural `.agents`, the cross-tool convention), CLI plugins `~/.gemini/antigravity-cli/skills/`
(https://medium.com/google-cloud/tutorial-getting-started-with-antigravity-skills-864041811e0d).
Antigravity sits skills inside a three-level context hierarchy: **Rules** (always-on,
GEMINI.md / AGENTS.md), **Skills** (on-demand SKILL.md), and **Workflows** (user-invoked
`/name` slash commands), plus opaque **Knowledge Items** (persistent cross-session memory)
(https://www.kdnuggets.com/build-better-ai-agents-with-google-antigravity-skills-and-workflows).

**The SDK caveat (load-bearing for us).** The Python SDK (`google.antigravity`,
`LocalAgentConfig`) wires capabilities **programmatically** (`system_instructions`, `tools`,
`mcp_servers`, `policies`, `triggers`) and does **not** load `SKILL.md` / `AGENTS.md` /
workflow files. File-based skills are an IDE + CLI feature, not an SDK one
(https://github.com/google-antigravity/antigravity-sdk-python). This is the same split we have:
the *config* layer (programmatic, like our `AgentConfig`) is distinct from the *runner* layer
(filesystem-discovered skills). It validates the proposal's core move: carry skills as
structured config and let the runner materialize them to the filesystem the harness expects.

> Note: Antigravity is new (mid-2026) and its official docs render client-side, so the paths
> above come from Google Codelabs and reputable write-ups rather than direct doc text. The
> exact *rules* path is inconsistent across sources (`.agent/rules/` vs `.agents/`); skills and
> workflows are consistently under `.agents/`. The skill *format* (SKILL.md frontmatter +
> body + relative-path scripts) is consistent everywhere.

## The common denominator

Strip the per-harness extras and every skill-bearing harness agrees on this core:

| Concern | Common shape |
|---|---|
| Unit | a **directory** with a `SKILL.md` entrypoint |
| Identity | `name` (lowercase-hyphen, ≤64 chars) |
| Trigger | `description` (non-empty, ≤1024 chars): the model matches the task to it |
| Body | the Markdown after the frontmatter: the instructions |
| Bundled assets | sibling files (`scripts/`, `references/`, `assets/`) referenced by relative path |
| Disclosure | name+description always loaded; body on demand; assets on demand |
| Surfacing | requires a file-read tool to be present (Pi: `read`; Claude: bash-read) |

Where they differ:

- **Extra frontmatter.** Claude Code parses the richest set (tool gating, invocation control,
  subagent forking). Pi, OpenCode, and Antigravity parse a reduced `{name, description}` (+
  Pi's `disable-model-invocation`) and ignore the rest. `allowed-tools` is honored only by
  Claude Code CLI. A portable field set is therefore **`name` + `description` + body**, with
  `allowed-tools` as an optional best-effort hint.
- **Delivery.** Filesystem discovery by scope (Claude Code, Pi, OpenCode) vs. upload API
  (Claude API / claude.ai). Our runner already does the filesystem half; the open question is
  whether an author-provided skill rides the wire and is materialized to the filesystem.
- **Validation strictness.** Pi and OpenCode warn-but-load; Claude's API surface validates
  hard on upload. We should validate at config time and stay lenient at load time.
- **The relative-path contract.** Claude Code exposes `${CLAUDE_SKILL_DIR}`. Pi 0.79.4 exposes
  the skill `<location>` and a global relative-path instruction, but F-008 shows the model may
  still execute relative scripts against cwd. Any author-provided skill we deliver should verify
  this and, if needed, materialize a portable `${SKILL_DIR}` token in the body.

## What this means for Agenta (handoff to the proposal)

1. The portable `SkillConfig` shape is `name` + `description` + a SKILL.md body, plus
   optional bundled files. This is the intersection of all four harnesses; a harness with no
   skill loader (or the Antigravity SDK path) simply ignores the field.
2. We need three delivery models: **reference a platform-curated skill by name** (what the
   runner already resolves), **reference a workflow-backed skill** (a versioned Agenta workflow
   revision whose resolved data is a skill package), and **author-provided inline skill**
   (content that rides the wire and is materialized into the agent dir). A discriminated union
   on a `source` field, mirror of the `tools` `type` union, fits.
3. The schema must carry enough to support the F-008 verify-then-fix path (for example a
   materialized `${SKILL_DIR}` token if Pi's prompt instruction is not reliable enough) and
   must flag the F-010 security surface. A skill that ships executable scripts is
   author-controlled shell execution and should be disabled by default until the selected
   sandbox/harness policy allows it.
