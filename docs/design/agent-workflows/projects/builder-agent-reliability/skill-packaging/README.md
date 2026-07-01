# Packaging and distributing the "build agents with Agenta" skills

How Agenta should ship the skills that teach a user's coding agent (Claude Code, Codex,
Cursor) to build Agenta agents through the Agenta API. The goal a user should feel:
"install Agenta's create-agent skills, then start building Agenta agents from my terminal."

This document researches the distribution mechanism, not the skill content. The content
already exists as a proven lab kit (see [What we distribute](#1-what-we-distribute)). The
question is how a user installs it with the least friction and how Agenta maintains it with
the least duplication.

## Recommendation up front

Yes. Agenta can distribute these skills by pointing users at a GitHub repo, with **zero
installer code of its own**. Two point-at-a-repo models both work, and they are
complementary, not competing:

1. **Claude Code plugin marketplace.** Commit a `.claude-plugin/marketplace.json` to a
   public repo. A Claude Code user runs `/plugin marketplace add Agenta-AI/agenta-skills`
   then `/plugin install build-agenta-agent@agenta`. No registry, no token, no build step.
2. **Universal skill installers** (`npx skills`, `npx openskills`). The same repo, holding
   plain `SKILL.md` folders, installs into Codex, Cursor, Windsurf, and more via one
   command: `npx skills add Agenta-AI/agenta-skills`. Also zero installer code.

The recommended shape is **one public repo that serves both channels from a single skill
tree** (the pattern the real `numman-ali/n-skills` repo already uses). Agenta commits: a
`skills/build-agenta-agent/` folder (the playbook as `SKILL.md` plus the shell scripts),
one `.claude-plugin/marketplace.json`, and a `README.md` with the install one-liners.
Nothing is published to npm. Nothing needs CI beyond an optional validation check.

`openskills` (the tool the ask flagged) is real and viable, but for a "Claude Code **and**
Codex **and** Cursor" goal, Vercel's `npx skills` is the stronger universal installer
because it copies skills into each harness's native directory instead of relying on a
runtime shim. Lead with the Claude marketplace for Claude users and `npx skills` for
everyone else; keep `openskills` as a documented alternative.

The rest of this document backs each of these claims with the exact schemas, commands, and
files, then gives the migration ladder and the decisions the team must make.

---

## 1. What we distribute

### The seed

The content is the lab kit at `agent-creation-lab/kit/` (the working folder for this
project; it lives outside the `agenta` repo on purpose). It has two parts:

- `BUILD-AGENT.md` (~12 KB): the operator playbook. It tells an agent the shape of every
  Agenta agent config, a decision table for what a request needs, the ordered build loop
  (write config, create, test, schedule, report), how to write instructions for multi-tool
  and scheduled agents, and the hard rules that prevent the usual failures.
- `kit/scripts/` (12 shell scripts): thin wrappers over real Agenta API endpoints, so the
  agent never handles the API key or hand-rolls a request body. `build.sh` (create + test
  in one shot), `create-agent.sh`, `test-agent.sh`, `discover-tools.sh`,
  `discover-triggers.sh`, `list-connections.sh`, `create-schedule.sh`, `triggers.sh`,
  `check-tools.sh`, `archive-agent.sh`, `annotate-trace.sh`, and the shared `lib.sh`.

This kit is proven. The overnight validation runs collapsed a case that once took a builder
62 tool calls and ten minutes down to **one API call and 50 seconds** for a fresh Sonnet
subagent (see the project `status.md` and the lab `report.md`). That is the content we want
in front of users.

### It maps to one skill

A Claude/Codex/Cursor **skill** is exactly a `SKILL.md` (Markdown instructions with a
`name` + `description` frontmatter) plus optional bundled files under the same folder. The
lab kit fits that shape with no restructuring:

```
skills/build-agenta-agent/
  SKILL.md            # BUILD-AGENT.md, with a name/description frontmatter added
  scripts/
    lib.sh
    build.sh
    create-agent.sh
    test-agent.sh
    discover-tools.sh
    discover-triggers.sh
    list-connections.sh
    create-schedule.sh
    triggers.sh
    check-tools.sh
    archive-agent.sh
    annotate-trace.sh
```

The `SKILL.md` body references `scripts/<name>` by relative path, and every installer we
recommend copies the whole folder, scripts included. So the skill ships as one unit.

Frontmatter to add at the top of `SKILL.md`:

```yaml
---
name: build-agenta-agent
description: >-
  Turn a plain-language request into a working, tested Agenta agent. Use when the user
  wants to build, create, or schedule an Agenta agent through the Agenta API from their
  coding agent. Writes one config and runs a few bundled scripts.
---
```

Start with **one** skill, not four. The in-product build kit split the same procedure
across four cross-referencing skills, and that split is a leading suspect for why the live
agent wandered instead of taking the easy path (see the project `context.md`, open
questions). The lab deliberately reunified it into one ordered playbook and that is what
made cases cheap. Ship the single playbook first; split later only if it grows too large to
hold attention.

### What this is not

- **Not the in-product platform build kit.** `sdks/python/agenta/sdk/agents/adapters/
  agenta_builtins.py` holds four skills that run inside Agenta's own agent runtime and call
  platform tools (`find_capabilities`, `create_schedule`) as native tool calls. Those skills
  live inside the product. The skills in this document run in the **user's** terminal and
  call the Agenta HTTP API through shell scripts. The procedures overlap; the runtimes and
  the tool bindings do not. See [Relationship to the in-product skills](#relationship-to-the-in-product-skills).
- **Not the repo-development skills.** `.agents/skills/` (write-docs, plan-feature, and so
  on) help someone work on the Agenta codebase. Those are internal. These are a public
  developer artifact.

### Porting adaptations before shipping

The lab scripts target the lab's environment. Three changes turn them into a public skill:

1. **Credentials from environment, not a lab `.env`.** `lib.sh` currently sources
   `agent-creation-lab/.env`. Change it to read `AGENTA_API_KEY` and `AGENTA_HOST` (default
   the host to the Agenta cloud API) directly from the environment, and have `SKILL.md`
   tell the user to export them once. This is the one credential contract the whole kit
   needs.
2. **Target the product API, drop the lab-only inline rule.** The lab hits a low-level
   agent-service endpoint that does not hydrate a committed config, so it inlines the full
   config on every invoke. `BUILD-AGENT.md` already flags this as a lab detail: the
   product's public invoke path loads a committed reference server-side. The shipped scripts
   should call the product endpoints and drop the "always inline" instruction.
3. **State prerequisites.** The scripts need `bash`, `curl`, and `jq`. Put that in the
   skill's README and near the top of `SKILL.md` so a run fails loud with a clear message
   rather than a confusing `jq: command not found`.

None of these is a distribution decision; they are a one-time content edit during the port.

---

## 2. Two ways to point at a repo

Both models require zero installer code from Agenta. They differ in which tools they reach
and in the install UX.

| | Claude Code plugin marketplace | Universal skill installers (`npx skills`, `npx openskills`) |
| --- | --- | --- |
| Reaches | Claude Code only | Claude Code, Codex, Cursor, Windsurf, Aider, and ~40 more |
| User command | `/plugin marketplace add <owner/repo>` then `/plugin install <name>@<mkt>` | `npx skills add <owner/repo>` |
| Repo must contain | `.claude-plugin/marketplace.json` | plain `SKILL.md` folders (a `skills/` dir) |
| Install target | Claude's plugin cache (`~/.claude/plugins/cache/...`) | each harness's native skills dir |
| Updates | `/plugin update`, or auto-update on startup | `npx skills update` |
| Versioning | `version` field or git commit SHA | git ref / reinstall |
| Agenta's cost | commit files, no registry, no token | commit files, no registry, no token |
| Publish/CI | none required | none required |

The important structural fact: **the skill itself is portable; the marketplace that ships
it is Claude-only.** The `SKILL.md` folder follows the Agent Skills open standard
(agentskills.io), which about forty tools read, including Codex and Cursor. The
`marketplace.json` / `plugin.json` / `/plugin` layer is a Claude-Code-specific packaging
layer that Codex and Cursor do not parse. So the durable, cross-tool unit is the `SKILL.md`
folder in a git repo. Claude's marketplace is one delivery channel layered on top of it,
and the universal installers are the channel for everything else.

---

## 3. Option A: the Claude Code plugin marketplace

This is the "point at a GitHub repo, no installer code" path for Claude Code users, and it
gives the best in-product UX (a browsable menu, token-cost estimates, auto-update).

### How the pieces relate

- A **marketplace** is a catalog file, `.claude-plugin/marketplace.json`, that lists
  **plugins** and where to fetch each one.
- A **plugin** is a directory that can bundle skills, subagents, hooks, MCP servers, and
  more. Skills live under `<plugin>/skills/<name>/SKILL.md`.
- `/plugin install` installs **plugins**, not bare skills. So a skill reaches Claude's
  marketplace by being wrapped in a plugin. The wrapper is nearly free, and one trick (below)
  avoids duplicating any files.

### The marketplace schema, exactly

`marketplace.json` top-level fields: `name` (required, kebab-case, public-facing), `owner`
(required, `{name, email?}`), `plugins` (required array). Optional: `$schema`,
`description`, `version`, `metadata.pluginRoot`, `allowCrossMarketplaceDependenciesOn`,
`renames`.

Each plugin entry needs `name` and `source`. `source` takes five forms: a relative path
(`"./plugins/x"`, a dir inside the marketplace repo), or an object with a `source`
discriminator of `github` (`{repo, ref?, sha?}`), `url`, `git-subdir` (`{url, path}`, a
sparse clone of a monorepo subdir), or `npm`. An entry may also carry any plugin-manifest
field (`description`, `version`, `author`, `license`, `keywords`, `skills`, `hooks`, ...)
plus `strict`, `category`, and `tags`.

### The concrete files Agenta commits

The clean layout serves both the marketplace and the universal installers from **one skill
tree**, with no duplicated `SKILL.md`. The single-tree trick: point the plugin entry at the
repo root (`"source": "./"`), set `"strict": false` so the marketplace entry is the whole
definition (no separate `plugin.json` needed), and name the skill subdir explicitly.

Repo `Agenta-AI/agenta-skills`:

```
.claude-plugin/
  marketplace.json
skills/
  build-agenta-agent/
    SKILL.md
    scripts/*.sh
README.md
```

`.claude-plugin/marketplace.json`:

```json
{
  "$schema": "https://json.schemastore.org/claude-code-marketplace.json",
  "name": "agenta",
  "owner": { "name": "Agenta", "email": "team@agenta.ai" },
  "description": "Skills that teach your coding agent to build Agenta agents via the Agenta API.",
  "plugins": [
    {
      "name": "build-agenta-agent",
      "source": "./",
      "strict": false,
      "skills": ["./skills/build-agenta-agent"],
      "description": "Turn a plain-language request into a working, tested Agenta agent.",
      "version": "0.1.0",
      "author": { "name": "Agenta" },
      "homepage": "https://docs.agenta.ai",
      "license": "MIT",
      "keywords": ["agenta", "agents", "build", "llm"]
    }
  ]
}
```

That is the entire Claude-side commitment: one JSON file. The `skills/build-agenta-agent/`
folder is the same folder the universal installers read, so there is nothing to keep in
sync.

If you prefer the conventional "plugin in a subfolder" layout instead of the root trick,
add `plugins/build-agenta-agent/.claude-plugin/plugin.json` (only `name` is required) with
the skill under `plugins/build-agenta-agent/skills/`, and set `"source":
"./plugins/build-agenta-agent"`. That duplicates the folder location but is more familiar.
The root trick is better here because it keeps one canonical skill tree.

### Reserved-name gotcha

The marketplace `name` field cannot be `agent-skills` or `anthropic-agent-skills`; those
are reserved for Anthropic, along with names that impersonate official marketplaces. The
plain brand name `agenta` is free and is what a user types on install
(`build-agenta-agent@agenta`). The **repo** name is unrelated to the marketplace name, so
`Agenta-AI/agenta-skills` as a repo with `"name": "agenta"` inside is fine.

### Install UX, end to end

```
/plugin marketplace add Agenta-AI/agenta-skills     # bare owner/repo is accepted
/plugin install build-agenta-agent@agenta           # <plugin-name>@<marketplace-name>
```

`/plugin` alone opens an interactive menu (Discover / Installed / Marketplaces / Errors)
that shows a token-cost estimate and a "will install" inventory before the user confirms.
Non-interactive equivalents exist for scripting (`claude plugin marketplace add ...`,
`claude plugin install ...`). Plugin skills are namespaced, so the user invokes it as
`/build-agenta-agent:build-agenta-agent` and it never collides with the user's own skills.

### Auto-suggest from a project

A repo can prompt collaborators to install the marketplace when they trust the folder. In
`.claude/settings.json`:

```json
{
  "extraKnownMarketplaces": {
    "agenta": { "source": { "source": "github", "repo": "Agenta-AI/agenta-skills" } }
  },
  "enabledPlugins": { "build-agenta-agent@agenta": true }
}
```

This is useful for Agenta's own example repos and templates: clone the template, trust it,
get prompted to install the build skill.

### Versioning

Claude resolves a plugin's version from the first of: `version` in `plugin.json`, then
`version` in the marketplace entry, then the git commit SHA. Two policies:

- **Pin `version` and bump it per release.** Users only get updates when the string
  changes. Best for a public artifact where you want deliberate releases.
- **Omit `version`.** Every commit is a new version. Simplest for fast iteration.

Recommend pinning a semver `version` for a public developer-facing skill, so a random
commit does not ship to every user mid-edit.

### The limitation

This path is Claude Code only. Codex and Cursor do not read `marketplace.json`. Serving
them is Option B.

---

## 4. Option B: universal skill installers

These install plain `SKILL.md` folders from a GitHub repo into many harnesses. The source
repo needs no manifest, only `SKILL.md` files. Agenta's repo already satisfies this by
committing `skills/build-agenta-agent/`.

### `npx skills` (Vercel): the recommended universal path

`vercel-labs/skills` (npm package `skills`) is Vercel-backed, MIT-licensed, and the most
mature of the installers (tens of thousands of stars, dozens of releases). It **copies
skills into each harness's native directory**, so each tool discovers them the way it
already does, with no runtime shim.

```bash
npx skills add Agenta-AI/agenta-skills                          # interactive: pick agents + skills
npx skills add Agenta-AI/agenta-skills -a claude-code -a codex -a cursor
npx skills add Agenta-AI/agenta-skills --skill build-agenta-agent --agent '*'
npx skills update                                               # refresh
```

Native target directories it writes to:

- Claude Code: `.claude/skills/` (global `~/.claude/skills/`)
- Codex: `.agents/skills/` (global `~/.codex/skills/`)
- Cursor: `.agents/skills/` (global `~/.cursor/skills/`)
- OpenCode and ~70 more agents, each with its own path

It discovers `SKILL.md` files under `skills/` (and can also read a `.claude-plugin/
marketplace.json` if present). Because it copies into `.agents/skills/` (plural) for Codex
and Cursor, it lines up exactly with the directory convention Agenta already uses in its own
repo.

### `npx openskills`: the tool the ask named

`numman-ali/openskills` (npm package `openskills`) is real and does what the ask described.
It is younger and largely single-maintainer (Apache-2.0). Its model differs: instead of
copying into each harness's native dir, it writes an `<available_skills>` block into
`AGENTS.md` and the agent loads a skill body on demand by running `npx openskills read
<name>`. That makes it harness-agnostic (anything that reads `AGENTS.md`) at the cost of a
runtime shim.

```bash
npx openskills install Agenta-AI/agenta-skills      # GitHub owner/repo
npx openskills sync                                 # (re)write the AGENTS.md block
npx openskills list
npx openskills read build-agenta-agent              # agent loads the body this way
npx openskills update
```

Targets: `./.claude/skills/` by default, `~/.claude/skills/` with `--global`, and
`./.agent/skills/` with `--universal`. Note the directory name: openskills uses
**`.agent/skills` (singular)**, which does not match Codex's and Cursor's native
`.agents/skills` (plural). openskills gets away with this because it does not depend on the
harness scanning the folder; it routes through `AGENTS.md` plus the `read` shim. See
[The directory-mismatch footgun](#5-the-directory-mismatch-footgun).

### One repo can serve every channel

`numman-ali/n-skills` is a live proof that a single repo serves the Claude marketplace and
the universal installers at once. It commits `.claude-plugin/marketplace.json` (for
`/plugin`), plain skill folders, and an `AGENTS.md` (for openskills-style agents), and
documents install commands for Claude Code, Codex, and openskills against the same repo.
Agenta's recommended layout is the same idea with one skill instead of a catalog.

### Other installers, briefly

- `Karanjot786/agent-skills-cli` (`npx agent-skills-cli add owner/repo`): copies into
  native dirs for ~45 agents and has a lockfile / frozen mode. Less established than Vercel's.
- `degit` / `giget` one-liners (`npx degit Agenta-AI/agenta-skills/skills/build-agenta-agent
  .claude/skills/build-agenta-agent`): work against a plain repo with zero installer code,
  but are not skill-aware (no discovery, no multi-agent fan-out, no update tracking). Fine as
  a documented fallback, weakest ergonomics.

---

## 5. The directory-mismatch footgun

Different harnesses read skills from different directories. This is the trap the ask
flagged, and it is worth stating plainly.

| Harness / tool | Native skills directory (project scope) |
| --- | --- |
| Claude Code | `.claude/skills/` |
| Codex | `.agents/skills/` (plural) |
| Cursor | `.agents/skills/` (plural) |
| Agenta's own repo convention | `.agents/skills/` (plural), symlinked into `.claude/skills/` |
| `openskills --universal` | `.agent/skills/` (singular) |

Two mismatches hide here:

1. **Claude versus everyone else.** Claude reads `.claude/skills/`; Codex and Cursor read
   `.agents/skills/`. A single hand-checked-in tree cannot sit in both places without a
   symlink. Agenta already solves this in its own repo by keeping the canonical skill in
   `.agents/skills/<name>/` and symlinking `.claude/skills/<name>` to it. That works for a
   repo you control end to end, but it is not an "install into the user's project"
   mechanism, so it does not help distribution.
2. **`.agent` (singular) versus `.agents` (plural).** openskills writes `.agent/skills`;
   Codex, Cursor, Vercel's installer, and Agenta all use `.agents/skills`. If you told users
   to `openskills install --universal` and also expected Codex to natively pick the skill up
   from `.agents/skills`, it would not, because openskills wrote to a different folder and
   relies on its own `AGENTS.md` + `read` shim instead.

**How each distribution option handles multi-harness:**

- **Claude marketplace:** does not fan out. Claude only. It side-steps the mismatch by
  installing into Claude's own plugin cache, namespaced, never touching the shared dirs.
- **`npx skills` (Vercel):** handles it correctly and natively. It knows each harness's real
  directory and copies there, so `.claude/skills` for Claude and `.agents/skills` for
  Codex/Cursor both get the files, and each tool's native discovery finds them. This is why
  it is the recommended universal path.
- **`npx openskills`:** handles it by not relying on native discovery at all. It writes one
  `AGENTS.md` block plus `.agent/skills`, and every agent loads through `openskills read`.
  Consistent across harnesses, but it asks the user to adopt the openskills convention.

**Can a single source serve all?** Yes, if the source is the portable unit: a plain
`SKILL.md` folder in a `skills/` dir. From that one folder, `npx skills` fans out to every
harness's native directory, `openskills` bridges through `AGENTS.md`, and the Claude
marketplace wraps it as a plugin. The mismatch is a problem for **install targets**, and the
installers own that problem, so Agenta does not have to. Agenta's single job is to keep one
clean `skills/` tree. What a single source **cannot** do is serve Codex and Cursor through
the Claude marketplace, because that layer is Claude-only. That gap is covered by also
documenting `npx skills`, not by restructuring the source.

---

## 6. Repo home and single source

### Where the canonical source should live

Recommend a **dedicated public repo, `Agenta-AI/agenta-skills`**, as the single source of
truth for the coding-agent build skills. Reasons:

- **Clean marketplace target.** `/plugin marketplace add Agenta-AI/agenta-skills` clones the
  repo. With the recommended `"source": "./"` entry, Claude copies the whole repo into its
  cache. A small skills-only repo keeps that copy tiny; pointing the marketplace at the
  huge `Agenta-AI/agenta` monorepo would drag the whole thing in.
- **Independent release cadence.** These skills version with the shape of the Agenta API a
  user calls, not with an internal SDK or web release. A standalone repo gets its own tags
  and its own semver without coupling to the monorepo's release train.
- **Public artifact hygiene.** It is a developer-facing product. A focused repo is easier to
  star, fork, read, and link from docs than a subdirectory of a large monorepo.

If the team instead wants these skills versioned inside the monorepo, the alternative is a
top-level `agent-skills/` (or `sdks/agent-skills/`) directory, distributed one of two ways:
either add a marketplace entry with a `git-subdir` source and `/plugin marketplace add
Agenta-AI/agenta --sparse` (a sparse clone of just that subdir), or run a CI job that
mirrors the subtree out to the public `agenta-skills` repo. Both work; both add moving
parts a standalone repo avoids. Prefer standalone unless there is a strong reason to
co-version with the API code.

### Single-sourcing, the way the in-product catalog does it

The in-product skills already model the principle to copy: `agenta_builtins.py` defines each
skill body once, and the server-side `StaticWorkflowCatalog` imports the same constant, so
the embed path and the forced path stay one source of truth. The distribution here follows
the same principle, applied to install channels rather than runtime paths:

- The canonical skill lives once, as `skills/build-agenta-agent/`.
- The Claude marketplace entry does not copy the `SKILL.md`; it references the folder via
  `"skills": ["./skills/build-agenta-agent"]` with `"source": "./"`.
- `npx skills` and `openskills` read the same folder directly.
- Docs examples link to the same folder.

No file is duplicated across channels. The `"strict": false` + `"source": "./"` trick is the
mechanism that lets the marketplace point at the shared tree instead of demanding its own
copy under `plugins/`. That is the single-source win.

### Relationship to the in-product skills

The in-product `agenta_builtins.py` skills and these coding-agent skills share a lot of
**prose** (the config schema, the decision table, the discover to wire to schedule to test
procedure) but bind to different **runtimes** (in-product: native platform tool calls;
coding-agent: shell scripts over HTTP). Do not force one `SKILL.md` to serve both; the tool
bindings are genuinely different and a merged file would be full of conditionals. The
sustainable move, if drift becomes a real cost, is to extract the shared prose fragments
(the JSON config schema block, the decision table) into a single source that both artifacts
include or generate from, while each keeps its own runtime-specific steps. Treat this as an
open decision, not a day-one requirement (see [Open decisions](#9-open-decisions)).

---

## 7. CI

The headline: the point-at-a-repo paths need almost nothing.

- **Claude marketplace:** no registry, no token, no build step. Committing
  `.claude-plugin/marketplace.json` and the skill folder to a public repo is sufficient.
  Users clone it directly on `/plugin marketplace add`; updates are just pushes.
- **`npx skills` / `openskills`:** also nothing to publish. These installers read the GitHub
  repo directly. There is no Agenta-owned npm package and no token in this path. (`npx
  skills` and `npx openskills` are the users' tools, published by Vercel and by
  `numman-ali`; Agenta neither forks nor publishes them.)

The only path that would need an npm org and a publish token is distributing the plugin as
an `npm` source (`"source": {"source": "npm", ...}`) or publishing an installer of Agenta's
own. Neither is needed. Skip it.

What CI is **worth** adding (all optional, all cheap):

- **`claude plugin validate .`** on push: checks `marketplace.json` schema, duplicate names,
  path traversal, and skill frontmatter. Fails the build on a broken manifest before a user
  hits it.
- **Frontmatter lint:** assert every `skills/*/SKILL.md` has a `name` and `description`, the
  fields the universal installers key on. A five-line check.
- **`shellcheck` on `scripts/*.sh`:** the scripts are the risky part of this artifact; lint
  them.
- **Optional live smoke test:** run `build.sh` against a throwaway Agenta project using a CI
  secret key, to catch API drift. This is the only step that needs a secret, and it is a
  nice-to-have, not a gate.

Agenta's existing workflows (`.github/workflows/`) are release-branch, unit-test, styling,
and Railway deploy jobs. None publishes skills today, so a standalone repo means one small
new workflow (or none), not a change to the monorepo's CI. That is another point for the
standalone repo: its CI is self-contained.

---

## 8. Recommended path and migration ladder

Recommended distribution: **one public repo, `Agenta-AI/agenta-skills`, holding a single
`build-agenta-agent` skill, exposed through the Claude marketplace and `npx skills` at
once.** Concretely, the files Agenta commits are:

1. `skills/build-agenta-agent/SKILL.md` (the ported playbook, with frontmatter).
2. `skills/build-agenta-agent/scripts/*.sh` (the twelve ported scripts).
3. `.claude-plugin/marketplace.json` (the single JSON from section 3).
4. `README.md` (the per-harness install one-liners plus the `AGENTA_API_KEY` / `AGENTA_HOST`
   setup).
5. Optional: a generated `AGENTS.md` `<available_skills>` block for openskills-native
   agents, and a small CI workflow (section 7).

Migration ladder, low-effort first:

1. **Decide the two names.** Repo `Agenta-AI/agenta-skills`; marketplace `name: "agenta"`
   (confirm it is not on the reserved list, which `agent-skills` is).
2. **Port the kit** into `skills/build-agenta-agent/` with the three content edits from
   section 1.5 (env-var credentials, product API target, stated prerequisites). Add the
   frontmatter.
3. **Add `marketplace.json`** and a `README.md` with the three install commands. Run
   `claude plugin validate .` locally.
4. **Publish the repo public.** Test all three channels: `/plugin marketplace add` +
   `/plugin install`, `npx skills add`, `npx openskills install`.
5. **Write one docs page**, "Install the Agenta build-agent skills," with the per-harness
   one-liner and the credential setup. This is the user-facing front door.
6. **Later, if warranted:** split the single skill only if it outgrows attention; and fold
   what the coding-agent kit proved back into the in-product `agenta_builtins.py` skills
   (the real long-term payoff), single-sourcing shared prose per section 6.3.

Steps 1 to 4 are a day of work and no new infrastructure.

---

## 9. Open decisions

These are product and ownership calls the team must make; the research does not settle them.

- **Repo location.** Standalone `Agenta-AI/agenta-skills` (recommended) versus a monorepo
  subdir distributed by `git-subdir` or a mirror job. Standalone unless co-versioning with
  the API code is a hard requirement.
- **Marketplace name.** `agenta` is free and on-brand; confirm against the reserved list and
  claim it. It becomes the public install suffix (`build-agenta-agent@agenta`) and is hard
  to change later without a `renames` migration.
- **One skill or several.** Ship one playbook now (the lab evidence favors it). Decide the
  threshold at which splitting into getting-started / tools / triggers becomes worth the
  re-introduced cross-referencing.
- **Which installers Agenta endorses.** Recommended: Claude marketplace for Claude users
  plus `npx skills` for everyone else, with `openskills` documented as an alternative.
  Confirm the team is comfortable pointing users at third-party installers (`skills` is
  Vercel-backed and mature; `openskills` is younger and single-maintainer).
- **Scripts versus pure prose.** Keep the twelve shell scripts (they collapse the API
  plumbing and are why cases got cheap) at the cost of a `bash` + `curl` + `jq`
  prerequisite, or reimplement them in a more portable form. If broad reach matters more
  than the current speed, weigh a small Python or Node variant.
- **Credentials UX.** Standardize on `AGENTA_API_KEY` and `AGENTA_HOST` env vars, documented
  in the README and near the top of `SKILL.md`. Decide the default host (Agenta cloud) and
  how self-hosted users override it, and whether the key is per-project.
- **Versioning policy.** Pin a semver `version` and bump per release (recommended for a
  public artifact) versus omit it and let each commit ship.
- **Relationship to the in-product skills.** Keep the coding-agent skill and the
  `agenta_builtins.py` skills as parallel artifacts (recommended) versus invest now in a
  shared-prose single source. Revisit if the two visibly drift.
- **Codex and Cursor on day one, or Claude first.** The recommended layout supports all
  three from day one at no extra cost, so the only real question is how much of the launch
  messaging targets non-Claude harnesses.

---

## Sources

- Claude Code plugin marketplaces (schema, sources, versioning, CLI):
  https://code.claude.com/docs/en/plugin-marketplaces
- Claude Code plugins and plugin reference:
  https://code.claude.com/docs/en/plugins , https://code.claude.com/docs/en/plugins-reference
- Claude Code skills (SKILL.md, frontmatter, discovery):
  https://code.claude.com/docs/en/skills
- Real production marketplace file:
  https://github.com/anthropics/claude-code/blob/main/.claude-plugin/marketplace.json
- Agent Skills open standard (cross-tool scope):
  https://agentskills.io
- Vercel `skills` installer: https://github.com/vercel-labs/skills ,
  https://www.npmjs.com/package/skills
- `openskills` installer: https://github.com/numman-ali/openskills ,
  https://www.npmjs.com/package/openskills
- One-repo-serves-both example: https://github.com/numman-ali/n-skills
- OpenAI Codex skills: https://developers.openai.com/codex/skills
- The seed kit: `agent-creation-lab/kit/BUILD-AGENT.md` and `agent-creation-lab/kit/scripts/`
- In-product single-source pattern: `sdks/python/agenta/sdk/agents/adapters/agenta_builtins.py`
- Project context: `docs/design/agent-workflows/projects/builder-agent-reliability/`
  (`context.md`, `plan.md`, `status.md`, `build-notes.md`)
