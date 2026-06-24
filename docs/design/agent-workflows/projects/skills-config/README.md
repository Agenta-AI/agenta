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

Add `skills: List[SkillConfig]` to the neutral `AgentConfig`. `SkillConfig` is one shape: an
inline skill package (`name`, `description`, a SKILL.md body, optional bundled files, two
behavior flags). There is no `source` or `type` discriminator. To reference a skill that lives
elsewhere, the author places an `@ag.embed` object in the list, the same reference mechanism the
platform already uses for prompts; the resolver inlines it into a `SkillConfig` before the
runner sees it. Platform default skills are not a special path. The platform seeds them as
locked workflow revisions at project creation and embeds them like anything else, so "forced"
becomes a project-creation concern, not a config concept. Resolution is server-side and finishes
before the runner, which only ever materializes concrete packages. Executable bundled files
default off until the selected sandbox/harness policy allows them.

## How the schema collapsed to one shape

Two reviews and a design decision shaped this. An xhigh Codex pass corrected an early draft that
carried a single `ResolvedSkill` name and a wire change for the platform-skill path. Then the
key simplification landed: there are no first-party "curated" skills that need their own type,
and no separate workflow-reference slot. Both were "point at a skill that lives elsewhere,"
which is exactly what `@ag.embed` already does, including array traversal (verified:
`find_object_embeds` / `set_path` resolve an embed at `skills[0]` in place). So the three-variant
`source` union collapses to one inline shape plus the generic embed reference. The running
middleware resolves embeds only on the revision path today, not on inline parameters; the fix is
to resolve the effective parameters inside `ResolverMiddleware` so both paths resolve
(array-safe), which keeps `skills` strict-typed and fixes the gap for every workflow service.
A skill that is referenced (rather than written inline) is stored as a non-runnable workflow
artifact: a new `is_skill` family flag (sibling of `is_snippet`), payload at `parameters.skill`,
pulled in with the canonical selector `@ag.selector[path: parameters.skill]`. Kept
from the reviews: the `wire_skills()` seam off the tool wire, dropping the `enabled` flag, the
F-008 correction (Pi 0.79.4 already emits the skill `<location>` and a relative-path resolution
instruction, so F-008 is a verify-then-fix), and executable files default-deny under the sandbox
policy. The hard rule: a skill is content; trust is enforced upstream (a platform-locked
revision, or the author's own embed) and execution is governed by sandbox policy.

## Related work in this repo

- [../adapters/agenta.md](../adapters/agenta.md): the forced-skills mechanism this generalizes.
- [../qa/findings.md](../qa/findings.md): F-003 (no author-facing skill), F-008 (relative script
  paths), F-010 (unsandboxed code execution) are the constraints the schema is designed around.
- The `tools` / `mcp/` fields (`sdks/python/agenta/sdk/agents/tools/models.py`) are the sibling
  fields this sits next to. Skills do not copy their discriminated-union shape: a skill is one
  inline shape, and references reuse `@ag.embed` instead of a `source` variant.
- The `@ag.embed` resolver (`api/oss/src/core/embeds/`, SDK
  `agenta.sdk.middlewares.running.resolver`) is the reference mechanism reused for skills.
