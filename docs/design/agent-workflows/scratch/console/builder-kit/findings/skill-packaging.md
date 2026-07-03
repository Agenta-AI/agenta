# Packaging + distributing the "build Agenta agents" skills (npx-style)

Research + recommendation, 2026-07-01. **Not implementation.**

## What we are packaging (and what we are NOT)

**In scope:** skills for a *user's own* coding agent (Claude Code / Codex / Cursor) that
teach it to **build Agenta agents via Agenta's public API**. The seed is the operator
playbook `agent-creation-lab/kit/BUILD-AGENT.md` plus its bash scripts
(`kit/scripts/*.sh`: `build.sh`, `create-agent.sh`, `test-agent.sh`, `discover-tools.sh`,
`create-schedule.sh`, `triggers.sh`, `check-tools.sh`, `lib.sh` …). Those scripts are thin
`curl` wrappers over Agenta HTTP endpoints; `lib.sh` reads `AGENTA_HOST` + `AGENTA_API_KEY`
from a `.env`. The install story is: *"drop Agenta's create-agent skill into my Claude
Code and start building Agenta agents."*

**Out of scope (do not conflate):**
- The **platform build-kit** skills the *in-product* agent runs — canonical content in
  `sdks/python/agenta/sdk/agents/adapters/agenta_builtins.py`, mirrored into the server
  catalog `api/oss/src/core/workflows/static_catalog.py`. Different audience (the running
  agent, not the user's IDE).
- The repo's **own** dev skills under `.agents/skills/` (write-pr-description, gitbutler,
  …). Those help contributors work on Agenta; they are not shipped to end users.

The three overlap only in file *format* (a `SKILL.md`). Keep them separate as products.

---

## 1. How skills are distributed today

### The unit: a `SKILL.md` folder
A skill is a directory `<name>/` containing `SKILL.md` (YAML frontmatter + Markdown body)
plus optional bundled files (scripts, references, templates). Frontmatter this repo uses
(see `.agents/skills/write-issue/SKILL.md`):

```yaml
---
name: write-issue
description: <one-line trigger the model matches on>
allowed-tools: Read, Edit, Write, Grep, Glob, Bash
user-invocable: true
---
```

Discovery locations, by harness:
- **Claude Code** reads `~/.claude/skills/<name>/` (user scope) and `./.claude/skills/<name>/`
  (project scope). Plugins also inject skills.
- **Codex** reads `.agents/skills/<name>/`.
- Cursor / others: their own rule/skill dirs.

This repo single-sources by keeping canonical content in `.agents/skills/<name>/` and
**symlinking** `.claude/skills/<name>` → `../../.agents/skills/<name>` (see the mixed
symlink/real dirs in `.claude/skills/`). That is a *within-repo* convenience for the two
tools contributors use; it does not distribute anything outside the repo.

### The "npx skills" installer pattern (what the ecosystem does)
An installer is just an **npm package with a `bin`** that copies bundled skill folders into
the user's skills dir. Mechanically:

1. `package.json` has `"bin": { "agenta-skills": "bin/cli.js" }`. Publishing it makes
   `npx agenta-skills …` (or `npx @agenta/skills …`) executable with no prior install —
   npx downloads the package to a cache and runs the bin.
2. The package ships the skill content inside itself (e.g. under `skills/build-agent/…`),
   listed in package.json `"files"` so it lands in the npm tarball.
3. `bin/cli.js` (`#!/usr/bin/env node`) resolves a **target dir** — project
   `./.claude/skills` by default, `~/.claude/skills` with `--global` — and `fs.cpSync`s the
   bundled folder(s) in. Fancier installers fetch remote content with `giget`/`degit`
   instead of bundling, write a small manifest for update/uninstall, and print next steps.
4. **Versioning** rides npm semver: `npx pkg` fetches the latest published version each run
   (unless pinned `npx pkg@1.2.0`); the installer can stamp a `.version` beside the skill so
   re-running upgrades in place.

Real examples in the wild: `openskills` (a "package manager for skills", installs to
`./.claude/skills`, `--global` → `~/.claude/skills`), `skills-claude` / `@devlab/skills-claude`
(`npx … install` copies to `.claude/skills/`), Vercel's `add-skill`, and many
`@scope/claude-skills` packages that bundle a `bin/cli.js`. **Known footgun** (multiple
write-ups): some installers default to `~/.agents/skills/` while Claude Code reads
`~/.claude/skills/`, so skills "install" but don't show up. If we ship an installer it must
target the **right dir per harness** (and can optionally write both, or a SessionStart hook
that bridges them).

### The native alternative: Claude Code **plugins + marketplaces**
Claude Code now has a first-class distribution channel that needs **no npm at all**:
- A **plugin** is a dir with `.claude-plugin/plugin.json` that bundles `skills/`,
  `commands/`, `agents/`, `hooks/`, `.mcp.json`.
- A **marketplace** is a git repo with `.claude-plugin/marketplace.json` listing plugins.
- Users run `/plugin marketplace add <owner/repo>` then `/plugin install <name>@<market>`,
  choosing user or project scope. Skills become available immediately.

Trade-off: the plugin/marketplace path is **Claude-Code-only** (Codex/Cursor ignore it) but
is zero-infra (just files in a git repo) and is the "blessed" UX. The npx-copy path is
**harness-agnostic** (can write `.claude/skills`, `.agents/skills`, Cursor dirs) but requires
publishing an npm package. They are not mutually exclusive.

---

## 2. Where the source should live in this repo

Constraints from the repo: monorepo with area roots (`web/`, `api/`, `sdk/`, `sdks/`,
`clients/`); **no top-level `packages/`** (that's `web/packages/`, all `private: true`);
`clients/` is reserved for *generated* API clients. The builder skill is
deployment-agnostic (public API + API key), language-agnostic (bash + Markdown), and is a
**product artifact**, not dev tooling — so it should not live under `.agents/skills/`
(that's contributor tooling) and not under `sdks/` (it isn't the Python SDK).

**Recommendation: a new top-level `builder-kit/` (or `skills/`) directory** with a clean
source/installer split:

```
builder-kit/                     # or: skills/
  README.md
  src/
    build-agenta-agent/          # THE canonical skill folder — one source of truth
      SKILL.md                   # = curated BUILD-AGENT.md as a skill body + frontmatter
      scripts/                   # build.sh, create-agent.sh, discover-tools.sh, lib.sh, …
      references/                # decision table, schema notes, verified-facts digest
  installer/
    package.json                 # name @agenta/skills (or create-agenta-agent), bin, files
    bin/cli.js                   # copy src/build-agenta-agent → target skills dir
  .claude-plugin/                # optional: plugin.json + marketplace.json for the native path
```

Rationale:
- **One canonical copy** of the skill (`src/build-agenta-agent/`); the installer and any
  release artifact are *derived* from it at build time. This mirrors the repo's existing
  single-source *principle* — `agenta_builtins.py` holds canonical platform-skill content
  and `static_catalog.py` imports it so the embed path and forced path can't drift. Apply
  the same rule here (canonical content in one place, packaging derives copies), but keep it
  a **separate tree** — the user-facing builder skill and the in-product platform skill are
  different products and should not share a file.
- A dedicated top-level dir keeps it out of the always-loaded `.agents/skills` contributor
  set and out of `sdks/`, and gives CI a single obvious thing to package.
- If we prefer not to add a top-level dir, the next-best home is `clients/skills/` (peer to
  the generated clients, since both are "things we hand to users to talk to the API"). Less
  ideal because `clients/` currently means codegen output.

The scripts should stay in the skill (they *are* the interface the playbook depends on), but
harden `lib.sh` for distribution: read `AGENTA_HOST`/`AGENTA_API_KEY` from the environment or
a user config, never bundle a `.env`, and fail loudly with a "run `agenta login` / set these
env vars" message. (Windows/`jq` dependency is an open question — see below.)

---

## 3. How CI would package + publish it

**Starting point:** the repo publishes **zero** npm packages today — every `@agenta/*`
package under `web/packages/` is `private: true`, and there is no `npm publish` in any
workflow (`.github/workflows/*`). The Python SDK ships to PyPI (`sdks/python` at `0.104.3`)
but with no publish workflow visible in-repo (done externally/manually). So a skills
installer would be the repo's **first npm publish** and needs new infra: an npm org/scope and
an `NPM_TOKEN` secret.

Sketch of the flow (new workflow, e.g. `.github/workflows/20-publish-skills.yml`):

1. **Assemble + validate** (a small build step): copy `builder-kit/src/build-agenta-agent/`
   into `installer/`'s published `files`; lint the frontmatter (`name`/`description`
   present, `name` kebab-case) and the bundled file paths (safe relative POSIX, no `..`,
   not `SKILL.md`) — reuse the same rules the SDK's `SkillFile` enforces so a skill that
   validates here also validates as an in-product skill template. Optionally run the scripts'
   `shellcheck`.
2. **Version**: bump `installer/package.json` version (independent semver from the app;
   drive from a git tag like `skills-v1.2.0` or `workflow_dispatch` input).
3. **Publish**, trigger on that tag / dispatch:
   - `actions/setup-node` → `npm publish --access public` with `secrets.NPM_TOKEN`, scope
     `@agenta`. (Matches the existing `setup-node` usage already in
     `11-check-code-styling.yml`, `12-check-unit-tests.yml`, etc.)
   - **and/or** cut a **GitHub Release** attaching a zipped skill folder, so a
     publish-free one-liner works too:
     `npx giget gh:agenta-ai/agenta/builder-kit/src/build-agenta-agent .claude/skills/build-agenta-agent`
     (giget/degit pull a subdir straight from the repo — no npm package required).
   - **and/or** commit `.claude-plugin/marketplace.json` so the native Claude path
     (`/plugin marketplace add agenta-ai/agenta`) works with **zero** publish infra. This is
     the cheapest first ship: it's just files in the repo.

Cheapest-first ladder: (a) marketplace.json in-repo (no infra) → (b) `npx giget` one-liner
off a GitHub Release (no npm org) → (c) full `npm publish @agenta/skills` (needs the org +
token). Ship (a)+(b) immediately; graduate to (c) when we want the polished `npx @agenta/skills`
UX and a stable name.

---

## 4. User-facing install story (the one-liner + what it drops)

**Recommended primary (harness-agnostic), once the npm package exists:**

```bash
npx @agenta/skills add build-agent          # → ./.claude/skills/build-agenta-agent/
npx @agenta/skills add build-agent --global # → ~/.claude/skills/build-agenta-agent/
npx @agenta/skills add build-agent --agents # also write ./.agents/skills (Codex)
```

Drops the `build-agenta-agent/` folder (SKILL.md + scripts/ + references/) into the chosen
skills dir. First run, the skill prompts the user for `AGENTA_HOST` + an API key (or reads
`AGENTA_API_KEY`). Then in Claude Code the user just says *"build an Agenta agent that
summarizes the text I paste"* and the skill's playbook drives `build.sh`.

**Zero-infra one-liner available today (no npm org needed):**

```bash
npx giget@latest gh:agenta-ai/agenta/builder-kit/src/build-agenta-agent .claude/skills/build-agenta-agent
```

**Native Claude path (Claude-only, zero publish infra):**

```
/plugin marketplace add agenta-ai/agenta
/plugin install agenta-builder
```

Package-name options to decide between: `@agenta/skills` with subcommands (`add build-agent`,
future `add eval-agent`), or the create-app convention `npx create-agenta-agent` (single
purpose, most familiar UX). The first scales to a catalog; the second reads best for the
headline "install and go" story.

---

## Open decisions to flag to the user

1. **npm org/scope.** Every `@agenta/*` package today is `private:true` and never published —
   we don't know if the `@agenta` npm org is claimed/owned. Confirm/claim it (and add an
   `NPM_TOKEN` secret) before committing to the `npx @agenta/skills` name. If unavailable,
   fall back to `create-agenta-agent` or the giget/marketplace paths.
2. **Which channel(s) to ship.** Recommend **both**: Claude plugin/marketplace (native,
   zero-infra, Claude-only) as the fast first ship, plus the npx/giget installer for
   Codex/Cursor coverage. Decide whether Codex/Cursor support is a launch requirement.
3. **Package name / shape.** `npx @agenta/skills add build-agent` (catalog, scales) vs
   `npx create-agenta-agent` (single-purpose, cleanest headline). Tied to #1.
4. **Scripts vs a real CLI.** The kit is bash + `jq` + `curl`. That's fine on macOS/Linux but
   weak on Windows and brittle to distribute. Decide whether to ship the bash scripts as-is
   now and replace them later with a thin cross-platform CLI (Node or the `agenta` Python
   CLI) that the skill calls instead.
5. **Auth at install time.** Bundle nothing secret. Decide the credential UX: raw env vars
   (`AGENTA_HOST`/`AGENTA_API_KEY`), or piggyback on an `agenta login` / existing SDK config
   so the skill inherits credentials.
6. **The `.agents` vs `.claude` dir footgun + a SessionStart hook.** Decide whether the
   installer writes only `.claude/skills`, only `.agents/skills`, both, or installs a
   SessionStart hook that bridges them (the durable fix the ecosystem converged on).
7. **Single-source enforcement.** Confirm the rule: canonical skill content lives once (in
   `builder-kit/src/`), and the npm tarball + release zip + marketplace copy are all derived
   by CI — never hand-edited copies that can drift (the lesson behind the
   `agenta_builtins.py` → `static_catalog.py` single-source).

Sources: [openskills (npm)](https://www.npmjs.com/package/openskills),
[skills-claude](https://npmx.dev/package/skills-claude),
[npx skills practical guide (dev.to)](https://dev.to/toyama0919/managing-ai-agent-skills-with-npx-skills-a-practical-guide-2an8),
[Claude skills not found after npx install (layer5)](https://layer5.io/blog/engineering/claude-code-skills-not-found-after-npx-install/),
[Discover and install plugins (Claude Code docs)](https://code.claude.com/docs/en/discover-plugins),
[Use plugins in Claude (Help Center)](https://support.claude.com/en/articles/13837440-use-plugins-in-claude).
