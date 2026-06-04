# Compartmentalizing AGENTS.md: research and plan

## The problem

`AGENTS.md` at the repo root is 62.6 KB (1,766 lines). Claude Code warns above 40 KB
because a large always-loaded instruction file costs context and lowers how
reliably the model follows any single rule.

`CLAUDE.md` is a thin wrapper that does `@AGENTS.md`, so every Claude session loads
the full 62.6 KB.

Two separate failures are happening today, one per tool:

- **Claude Code** loads the whole file every session. The official guidance is to
  target under 200 lines per `CLAUDE.md`. We are at 1,766. Longer files reduce
  adherence, so rules late in the file get dropped in practice.
- **Codex** reads `AGENTS.md` directly and caps project docs at 32 KiB by default
  (`project_doc_max_bytes`). Our file is 62.6 KB. Unless that cap was raised, Codex
  reads only about the first half and silently drops the rest. Roughly everything
  from the back half of "Import Aliases" onward (Fern client, Code Placement,
  Package Unit Tests) never reaches Codex.

So this is not only a performance warning. Half the guidance is already invisible to
Codex.

## Key correction: `@import` does not fix this

The most common instinct is to split the file into sub-files and `@import` them. That
does **not** reduce context for Claude. From the Claude memory docs:

> Splitting into `@path` imports helps organization but does not reduce context,
> since imported files load at launch.

Imported files expand inline at session start. A root that `@import`s ten sub-files
loads exactly as much as one big file. Codex does not even use `@import`; it
concatenates nested `AGENTS.md` files up to its byte cap. So sub-files plus imports
solve nothing for either tool.

Only three mechanisms actually reduce always-on context. All three load content
**on demand** instead of at launch.

## The three mechanisms that actually work

### 1. Nested per-directory files (the portable, cross-tool answer)

- **Claude**: the root `CLAUDE.md` loads at launch. A `CLAUDE.md` inside a
  subdirectory loads only when Claude reads a file in that directory. Nested files
  are also re-checked, not the root, after compaction.
- **Codex / the AGENTS.md ecosystem**: agents read the nearest `AGENTS.md` in the
  directory tree; the closest one wins and each subproject ships tailored
  instructions. OpenAI's own main repo has 88 `AGENTS.md` files.

This is the one mechanism both tools share, so it is the backbone of any fix.
Frontend rules live in `web/`, backend rules live in `api/`, and neither loads while
you work in the other.

To make a nested directory serve both tools, put the content in `web/AGENTS.md` and
have `web/CLAUDE.md` re-import it (`@AGENTS.md`) or symlink to it. Same pattern the
root already uses.

### 2. Skills (`.claude/skills/<name>/SKILL.md`)

Skills follow the open Agent Skills standard (Claude Code, Codex CLI, Gemini CLI all
read it). They use progressive disclosure:

- Only the skill `name` and `description` are visible at all times. They cost a few
  tokens each.
- The full `SKILL.md` body loads only when the skill is used. Reference material in a
  skill costs almost nothing until needed.

On the user's question "skills, but then we want these used automatically": yes, skills
**can** fire automatically. Claude reads every skill's name and description and pulls in
the relevant one based on the request. The catch is that this is a heuristic on the
description text, not a guarantee. So:

- Use a **skill** for a multi-step **procedure** or for deep reference material that
  only matters sometimes (the package decision tree, the molecule pattern, the bridge
  patterns).
- Do **not** rely on a skill for a convention that must apply every time you touch a
  file type. For that, use mechanism 3.

Note from the monorepo docs: when many skills exist, descriptions get shortened, which
can strip the keywords Claude matches on. Keep descriptions short and lead with the
words a request would actually contain.

### 3. Path-scoped rules (`.claude/rules/*.md` with `paths:` frontmatter) — Claude only

A rule file with `paths:` glob frontmatter loads only when Claude works with a matching
file:

```markdown
---
paths:
  - "web/**/*.{ts,tsx}"
---
# Frontend API rules
- Use the Fern client, not raw axios.
```

This is the most deterministic option for "this convention auto-applies whenever you
edit these files." A rule with **no** `paths:` field loads at launch, same cost as
`CLAUDE.md`, so it only helps when scoped.

Limitation: `.claude/rules/` is Claude-only. Codex does not read it. For a convention
that must reach both tools, prefer a nested `AGENTS.md` (mechanism 1). Rules are a
Claude-specific power-up on top of that.

## How the tools differ (reference table)

| Mechanism | Claude Code | Codex / AGENTS.md tools | Loads when |
| --- | --- | --- | --- |
| Root instruction file | `CLAUDE.md` | `AGENTS.md` | Every session |
| `@import` sub-files | Expands at launch, no saving | Not used | Launch |
| Nested per-dir file | `CLAUDE.md` (on demand) | nearest `AGENTS.md` wins | Working in that dir |
| Path-scoped rule | `.claude/rules/` + `paths:` | Not supported | Touching matching files |
| Skill | name+desc always, body on demand | Agent Skills standard | When relevant / invoked |
| Exclude noisy files | `claudeMdExcludes` | raise/lower `project_doc_max_bytes` | n/a |

Cross-tool note: Claude Code reads `CLAUDE.md`, **not** `AGENTS.md`. Today the bridge is
the root `CLAUDE.md` doing `@AGENTS.md`. Keep that bridge in every directory that has an
`AGENTS.md` you want Claude to see.

## What the current file actually contains

| Section | Lines | Share | Real scope |
| --- | --- | --- | --- |
| Dev Environment Tips | 9 | 0.5% | cross-cutting |
| Environment Config Conventions | 6 | 0.3% | API only |
| Testing Instructions | 4 | 0.2% | pointer |
| Packs | 4 | 0.2% | pointer |
| PR instructions | 3 | 0.2% | cross-cutting |
| **API Architecture Patterns (OSS+EE)** | **324** | **18.3%** | **api/ only** |
| **Import Aliases Best Practices** | **1,124** | **63.6%** | **web/ only** |
| Frontend API: Fern Client | 79 | 4.5% | web/ only |
| Code Placement: Packages vs App | 30 | 1.7% | web/ only |
| Package Unit Tests | 181 | 10.2% | web/packages only |

The headline: about 85% of the file is scope-specific (either `web/` or `api/`), not
cross-cutting. That is exactly the content that should not be in an always-loaded root.
Only a handful of lines (dev tips, PR conventions, repo orientation) truly belong to
every session.

## Two problems found along the way

1. **Broken reference.** `AGENTS.md` points to
   `.claude/skills/agenta-package-practices/AGENTS.md` twice (lines 9 and 1558), but
   that skill does not exist. The "Code Placement" section says the skill is the source
   of truth for a ruleset that is not there. Worth fixing regardless of the wider
   reorg.
2. **No nesting yet.** There are zero nested `AGENTS.md` / `CLAUDE.md` files anywhere in
   `web/`, `api/`, or elsewhere. Everything is in the one root file. So we get none of
   the on-demand benefit that both tools support.

What already exists and works: 13 skills under `.claude/skills/` (these *are* taken into
account by Claude, both auto and via `/name`), `docs/packs/{hosting,testing}.md`, and
`docs/designs/testing/README.md`. The docs/ files are only seen when something links to
them and the agent follows the link. They are not auto-loaded.

## Recommended target structure

```
/CLAUDE.md                  -> @AGENTS.md  (+ any Claude-only notes)
/AGENTS.md                  -> SLIM root, cross-cutting only. Target < 150 lines / < 8 KB.
                               repo map, dev tips, env-config rule, PR conventions,
                               and pointers to the nested files below.

/web/AGENTS.md              -> frontend conventions (import aliases, data fetching,
/web/CLAUDE.md              ->   @AGENTS.md          styling, React, Fern client, package
                               placement, package tests). Loads only under web/.

/api/AGENTS.md              -> API architecture patterns (OSS+EE layering, domain
/api/CLAUDE.md              ->   @AGENTS.md          folder shape, endpoints, exceptions,
                               typed DTOs, migration seams). Loads only under api/.

/.claude/skills/agenta-package-practices/SKILL.md
                            -> the package vs app decision tree + @agenta/* conventions.
                               Fixes the existing broken reference. Loads on demand.

/.claude/rules/  (optional, Claude-only power-ups)
   fern-client.md           -> paths: web/**           "use Fern, not axios"
   package-tests.md         -> paths: web/packages/**   vitest layout rules
   api-layering.md          -> paths: api/**            router->service->dao direction
```

Why this shape:

- The root drops from 1,766 lines to roughly 120. Both tools load only the
  cross-cutting essentials every session. Codex stops truncating because the root fits
  well under 32 KiB.
- `web/AGENTS.md` absorbs the 63.6% + 10.2% + 4.5% + 1.7% that is frontend-only. It only
  enters context when you work under `web/`.
- `api/AGENTS.md` absorbs the 18.3% that is backend-only.
- The huge "Import Aliases" section can shrink further inside `web/AGENTS.md`: keep a
  short index and move the deep dives (molecule pattern, bridge patterns, entity
  selection, data fetching) into skills or lean on the package READMEs the section
  already links to. Those are reference material, not always-on facts.

### Sequencing

1. Create `.claude/skills/agenta-package-practices/SKILL.md` and fix the broken link.
   Smallest, self-contained, useful on its own.
2. Carve `api/AGENTS.md` + `api/CLAUDE.md` out of the API section. One clean scope.
3. Carve `web/AGENTS.md` + `web/CLAUDE.md` out of the frontend sections.
4. Slim the root to cross-cutting only, replace moved sections with one-line pointers.
5. Optional: add a few path-scoped `.claude/rules/` for the conventions that must fire
   on every matching edit (Claude only).
6. Verify with `/memory` that the root is small and the nested files load when you cd
   into `web/` or `api/`.

## Scoping update (after the user's answers)

The user confirmed all three tools run against this repo (Claude Code, Codex, Cursor)
and asked for a long-term, repo-wide workflow rather than a one-off web fix. The
durable model now lives in `playbook.md` next to this file. Three discoveries from the
scoping pass reshape it:

1. **Cursor reads `AGENTS.md` natively, root and nested subdirectories.** So a single
   nested `AGENTS.md` backbone serves all three tools at once: Codex native, Cursor
   native, Claude via a `CLAUDE.md` bridge. No tool-specific duplication needed for the
   core conventions.
2. **`agents/skills/` and `agents/docs/` are invisible to every tool.** Claude Code only
   auto-discovers skills under `.claude/skills/` (plus `~/.claude/skills` and plugins).
   The visible `agents/skills/` set (scan-codebase, triage-findings, resolve-findings,
   sync-findings, test-codebase) and `agents/docs/` are not auto-loaded by Claude,
   Codex, or Cursor. They only run if something explicitly reads them. This is the
   answer to "not sure the agents take these into account": they do not, today.
3. **`.cursorrules` is the deprecated single-file format.** It holds only dev-stack run
   commands, which overlap the `run-sh` skill. Cursor now prefers `AGENTS.md` + nested,
   so this content should move and `.cursorrules` can shrink to a pointer or go away.

Real top-level scopes that the model has to cover: `web/{oss,ee,packages,apps}`,
`api/{oss,ee,entrypoints}`, `hosting/`, `clients/` + `sdk/`, `docs/`, `examples/`,
`services/`, `chat-ui/`.

## Sources

- Claude Code memory: https://code.claude.com/docs/en/memory
- Claude Code skills: https://code.claude.com/docs/en/skills
- Claude Code monorepos / large codebases: https://code.claude.com/docs/en/large-codebases
- Codex AGENTS.md guide: https://developers.openai.com/codex/guides/agents-md
- AGENTS.md open standard: https://agents.md
- Codex AGENTS.md monorepo playbook: https://www.codegateway.dev/en/blog/agents-md-playbook-2026
- Cursor rules (.mdc activation modes): https://cursor.com/docs/rules
- Anthropic, Agent Skills / progressive disclosure: https://www.anthropic.com/engineering/equipping-agents-for-the-real-world-with-agent-skills
- Anthropic, effective context engineering: https://www.anthropic.com/engineering/effective-context-engineering-for-ai-agents
