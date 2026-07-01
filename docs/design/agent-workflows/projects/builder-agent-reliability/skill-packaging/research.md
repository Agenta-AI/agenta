# Research: how skills are packaged, distributed, and disclosed

Findings behind the plan. The chosen design lives in `plan.md`. This file records how each
mechanism works, including the options the plan does not use, so a later reader can revisit a
choice without re-doing the research. Sources are at the bottom.

## 1. The unit: a `SKILL.md` folder

A skill is a directory `<name>/` holding `SKILL.md` (YAML frontmatter plus a Markdown body)
and any bundled files (scripts, references, templates). Every installer we looked at copies
the whole folder, so bundled files travel with the skill. The body refers to bundled files
by relative path.

Discovery directories differ by harness:

- Claude Code reads `~/.claude/skills/<name>/` (user scope) and `./.claude/skills/<name>/`
  (project scope). Plugins also inject skills.
- Codex reads `.agents/skills/<name>/` (plural).
- Cursor reads `.agents/skills/<name>/` (plural).

This repo single-sources by keeping the canonical skill in `.agents/skills/<name>/` and
symlinking `.claude/skills/<name>` to it. That is a within-repo convenience for the two tools
contributors use. It does not distribute anything outside the repo, so it does not help a
user install a skill into their own project.

## 2. Progressive disclosure

Anthropic's own framing is three loading levels, tied to when content enters the context
window:

| Level | When loaded | Cost | Content |
| --- | --- | --- | --- |
| 1: Metadata | Always, at startup | ~100 tokens per skill | `name` + `description` frontmatter |
| 2: Instructions | When the skill triggers | Target under ~5k tokens | The `SKILL.md` body |
| 3+: Resources and code | On demand only | Effectively unlimited | Bundled files, read or executed only when accessed |

Size and field rules from the official docs:

- `name`: max 64 characters, lowercase letters/numbers/hyphens, no reserved words
  (`anthropic`, `claude`).
- `description`: max 1024 characters, non-empty, third person, stating both what the skill
  does and when to use it.
- `SKILL.md` body: keep under 500 lines for best performance (the authoring checklist states
  this explicitly); Level 2 target is under ~5k tokens.
- Claude Code truncates the combined description in its skill listing at 1,536 characters and
  scales the listing budget at about 1% of the model's context window.

There is no `files[]` frontmatter manifest. A skill is a directory; every file in it travels
with the skill and becomes reachable by being linked from `SKILL.md`. The official examples
use a `reference/` folder for read-on-demand docs and a `scripts/` folder for executables
(scripts run via bash, so their source never enters context, only their output). "Resources"
is a content type in the docs, not a mandated folder name. This repo's own skills use
`references/` (plural), so the plan follows that.

Authoring guidance the docs stress:

- Keep references one level deep from `SKILL.md`. Do not chain reference to reference; the
  agent may only preview a nested file.
- Put a table of contents at the top of any reference file over ~100 lines, so a partial read
  still sees the scope.
- Mark intent: "read `x.md`" for a document to load, "run `x.sh`" for a script to execute.

The recommended pattern (Anthropic's "high-level guide with references") is exactly a lean
`SKILL.md` index that links out to reference files. This repo already ships one:
`gitbutler-workspace-recovery` keeps the non-negotiables inline in `SKILL.md` and points to
`references/recovery-runbook.md` "when doing an actual repair."

"Skills within skills" is not a real nesting feature. The two real tools are sibling
top-level skills in one repo and reference files inside a skill. The only extra path level any
tool honors is an organizational catalog grouping (`skills/<category>/<name>/`), which is not
a skill inside a skill.

## 3. Multiple skills in one repo

Both channels support many skills in one repo:

- Claude marketplace: `marketplace.json` lists plugins, and each plugin entry carries a
  `skills` array (e.g. `"skills": ["./skills/review", "./skills/test"]`). Plugin skills are
  namespaced as `plugin-name:skill-name`, so many skills coexist without collision.
- `npx skills` (Vercel): `npx skills add owner/repo` discovers every `SKILL.md` under
  `skills/` (and under `.claude/skills/`, `.agents/skills/`, catalog subfolders, and the
  `.claude-plugin` manifests). When several skills exist and no filter is passed, it prompts
  the user to pick; `--skill <name>` (repeatable, or `--skill '*'`) selects explicitly.

So a repo does not need one folder per repository. One repo holds many sibling skills.

## 4. Channel A: the Claude Code plugin marketplace

- A marketplace is a git repo with `.claude-plugin/marketplace.json` listing plugins.
- A plugin is a directory that bundles `skills/`, `commands/`, `agents/`, `hooks/`, and MCP
  servers. Skills live under `<plugin>/skills/<name>/SKILL.md`.
- `/plugin install` installs plugins, not bare skills, so a skill reaches the marketplace by
  being listed in a plugin's `skills` array.

`marketplace.json` top-level fields: `name` (required, kebab-case, public-facing), `owner`
(required), `plugins` (required array). Each plugin entry needs `name` and `source`. `source`
can be a relative path (`"./"` or `"./plugins/x"`) or an object discriminated by `github`,
`url`, `git-subdir`, or `npm`. An entry can also carry plugin-manifest fields (`description`,
`version`, `license`, `keywords`, `skills`) plus `strict`, `category`, `tags`.

The single-tree trick: set `"source": "./"` and `"strict": false` so the marketplace entry is
the whole plugin definition (no separate `plugin.json`), and name the skill subdirs in
`skills`. This lets the marketplace point at the shared `skills/` tree instead of demanding a
copy under `plugins/`.

Reserved names: the marketplace `name` cannot be `agent-skills` or `anthropic-agent-skills`.
The plain brand `agenta` is free and becomes the install suffix (`build-agenta-agent@agenta`).
The repo name is unrelated to the marketplace name.

Install and versioning: `/plugin marketplace add Agenta-AI/agenta-skills` then `/plugin
install build-agenta-agent@agenta`. `/plugin` alone opens an interactive menu with a
token-cost estimate. Claude resolves version from `plugin.json`, then the marketplace entry
`version`, then the git SHA. Pinning a semver `version` gives deliberate releases; omitting it
ships every commit.

Limitation: this channel is Claude Code only. Codex and Cursor do not read `marketplace.json`.

## 5. Channel B: universal installers

### `npx skills` (Vercel), the chosen path

`vercel-labs/skills` (npm package `skills`) is Vercel-backed and MIT-licensed. It copies
skills into each harness's native directory, so each tool discovers them the way it already
does, with no runtime shim. It writes Claude Code's `.claude/skills/`, Codex's and Cursor's
`.agents/skills/`, OpenCode, and many more. It reads a plain repo (no manifest needed) and
also understands `.claude-plugin/marketplace.json` if present. Because it copies into
`.agents/skills/` (plural) for Codex and Cursor, it matches the directory convention Agenta
already uses.

### `npx openskills` (numman-ali), not chosen

`openskills` is real and does what an early ask described, but the plan does not use it. Its
model differs: instead of copying into each harness's native directory, it writes an
`<available_skills>` block into `AGENTS.md`, and the agent loads a skill body on demand by
running `npx openskills read <name>`. That makes it harness-agnostic (anything that reads
`AGENTS.md`) at the cost of a runtime shim. It writes `./.agent/skills` (singular) with
`--universal`, which does not match Codex's and Cursor's native `.agents/skills` (plural); it
gets away with that because it does not rely on native discovery. It is younger and largely
single-maintainer. It stays a documented alternative, not a channel Agenta endorses.

### Others, briefly

`Karanjot786/agent-skills-cli` copies into native dirs for many agents with a lockfile, but is
less established than Vercel's. `degit` / `giget` one-liners work against a plain repo with
zero installer code but are not skill-aware (no discovery, no fan-out, no update tracking);
fine as a last-resort fallback.

## 6. The directory mismatch (`.claude` vs `.agents`)

Harnesses read skills from different directories:

| Harness / tool | Native skills directory (project scope) |
| --- | --- |
| Claude Code | `.claude/skills/` |
| Codex | `.agents/skills/` (plural) |
| Cursor | `.agents/skills/` (plural) |
| Agenta's own repo convention | `.agents/skills/`, symlinked into `.claude/skills/` |
| `openskills --universal` | `.agent/skills/` (singular) |

Two traps hide here. First, Claude reads `.claude/skills/` while Codex and Cursor read
`.agents/skills/`, so a single hand-checked-in tree cannot sit in both places without a
symlink. Second, `openskills` writes `.agent` (singular), which does not match the `.agents`
(plural) that Codex, Cursor, and Vercel's installer use. This is a known footgun: some
installers write a directory the harness does not scan, so skills "install" but never appear.

The chosen design side-steps it. The Claude marketplace installs into Claude's own plugin
cache (Claude only, no shared dir touched). `npx skills` knows each harness's real directory
and copies there, so native discovery finds the files everywhere. The mismatch is a problem
for install targets, and the installer owns that problem. Agenta's single job is to keep one
clean `skills/` tree.

## 7. jq availability

The scripts use `jq`. `jq` is common but not near-universal, so a skill must check for it
rather than assume it:

- macOS shipped `jq` only starting with macOS 15 Sequoia (late 2024). Every earlier macOS
  lacks it; it was historically a Homebrew install.
- Linux base images and default desktop installs do not include `jq` (Ubuntu, Debian, Fedora,
  Alpine all need `apt-get install jq` / `dnf install jq` / `apk add jq`).
- `curl` is safe to assume on macOS and Linux desktops (slim container images sometimes ship
  only `wget`).
- `bash` exists everywhere, but macOS froze at bash 3.2.57 (2007) and its default interactive
  shell has been zsh since macOS 10.15. Scripts should avoid bash 4+ features (associative
  arrays, `mapfile`, `${var,,}`, `**` globstar) to run under macOS's stock bash.

Decision (baked into `plan.md`): keep `jq` and add a `check-prereqs.sh` preflight that
verifies `bash`, `curl`, and `jq`, prints the platform install command on a miss, and asks the
user to install it. Rewriting the scripts without `jq` was rejected because it would make every
script longer and more fragile.

## 8. Relationship to the in-product skills

Out of scope, and kept separate as products:

- The in-product platform build kit (`sdks/python/agenta/sdk/agents/adapters/
  agenta_builtins.py`, mirrored into the server catalog) runs inside Agenta's own agent
  runtime and calls platform tools as native tool calls. These packaging skills run in the
  user's terminal and call the Agenta HTTP API through shell scripts. Same prose overlap (the
  config schema, the decision table), different runtimes.
- The repo's own dev skills under `.agents/skills/` (write-docs, plan-feature) help
  contributors work on the codebase. They are not shipped to end users.

The three overlap only in the `SKILL.md` file format. If the shared prose between the
in-product kit and the packaging skill drifts enough to hurt, extract the common fragments
(the config schema block, the decision table) into one source both include. Until then, keep
them separate.

## Sources

- Agent Skills overview (levels, limits, structure):
  https://platform.claude.com/docs/en/agents-and-tools/agent-skills/overview
- Skill authoring best practices (500-line rule, reference/ + scripts/, one-level-deep):
  https://platform.claude.com/docs/en/agents-and-tools/agent-skills/best-practices
- Anthropic engineering, Agent Skills (progressive disclosure, bundled scripts):
  https://www.anthropic.com/engineering/equipping-agents-for-the-real-world-with-agent-skills
- Claude Code skills (directory layout, plugin namespacing, listing budget):
  https://code.claude.com/docs/en/skills
- Claude Code plugin marketplaces (schema, sources, versioning, CLI):
  https://code.claude.com/docs/en/plugin-marketplaces
- Claude Code plugins and reference:
  https://code.claude.com/docs/en/plugins , https://code.claude.com/docs/en/plugins-reference
- Vercel `skills` installer: https://github.com/vercel-labs/skills ,
  https://www.npmjs.com/package/skills
- `openskills` installer: https://github.com/numman-ali/openskills
- One-repo-serves-both example: https://github.com/numman-ali/n-skills
- jq shipped in macOS Sequoia: https://news.ycombinator.com/item?id=41560170
- jq install page: https://jqlang.org/download/
- Prior findings: `docs/design/agent-workflows/scratch/console/builder-kit/findings/skill-packaging.md`
- The seed kit: `agent-creation-lab/kit/BUILD-AGENT.md` and `agent-creation-lab/kit/scripts/`
- In-repo progressive-disclosure example: `.agents/skills/gitbutler-workspace-recovery/`
