# Skills in the agent config

How an agent author ships a **skill** (the SKILL.md unit: a directory with frontmatter
`name`/`description`, a Markdown body, and optional bundled scripts) through Agenta's neutral
agent config, as a sibling of `tools` and `mcp_servers`.

This is a research-and-design workspace. No code has changed. It defines the **config schema**
and how it flows to the runner; the UI for authoring a skill is out of scope. Read in order:

1. [research.md](research.md): how four harnesses (Claude Code, Pi, OpenCode, Google
   Antigravity) define a skill, with citations. The common denominator and where they differ.
2. [proposal.md](proposal.md): the `skills` field and `SkillConfig` schema, the wire/runner
   mapping, the security treatment, and the recommended landing order.

## Why this exists

Skills are hardcoded today. The Agenta harness forces one placeholder skill by name, and the
neutral `AgentConfig` has no `skills` field, so an author cannot ship their own (finding F-003
in [../qa/findings.md](../qa/findings.md)). The runner can already resolve and copy skill
directories; the capability dies at the config layer. This work adds the missing schema.

## The proposal in one paragraph

Add `skills: List[SkillConfig]` to the neutral `AgentConfig`. `SkillConfig` is a discriminated
union over a `source`, mirroring the `tools` union: **`curated`** references a platform skill by
a validated registry name (today's mechanism, no new wire, no new risk), **`workflow`**
references a versioned Agenta workflow revision whose resolved data is a skill package, and
**`inline`** carries an author-provided SKILL.md body plus bundled files over the wire for the
runner to materialize. The list shape still works: each list item is one requested skill, and a
workflow-backed skill is just another source variant. Ship curated first (a safe platform-skill
selector); ship workflow/inline second, because author-controlled skill content is where the
real execution risk lives. Default executable files off until the selected sandbox/harness
policy allows them. The hard rule throughout: a clean boundary between trusted curated names
and untrusted author-controlled content.

## A Codex review shaped this

An xhigh Codex pass corrected the first draft. Its verdict: right direction, not approvable as
first written. The fixes folded in: split the config / wire / materialized type layers (the
single `ResolvedSkill` name was wrong); keep curated-first as a *no-wire-change* phase (a draft
wrongly called it a wire change); give skills a `wire_skills()` seam off the tool wire; drop the
`enabled` flag (the tools union has none); harden the curated path against traversal
(`resolveSkillDirs` honors absolute paths today); add workflow-backed skills as a first-class
source; make executable skill files default-deny under the sandbox policy; and correct the
F-008 claim (Pi 0.79.4 already emits the skill `<location>` and a relative-path resolution
instruction, so F-008 is a verify-then-fix, not a guaranteed schema side effect). The single
most important fix: the trusted-name vs untrusted-content boundary.

## Related work in this repo

- [../adapters/agenta.md](../adapters/agenta.md): the forced-skills mechanism this generalizes.
- [../qa/findings.md](../qa/findings.md): F-003 (no author-facing skill), F-008 (relative script
  paths), F-010 (unsandboxed code execution) are the constraints the schema is designed around.
- The `tools` discriminated union (`sdks/python/agenta/sdk/agents/tools/models.py`) is the
  pattern this mirrors; `mcp/` is the other sibling field.
