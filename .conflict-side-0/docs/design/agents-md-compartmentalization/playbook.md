# Agent instructions: long-term workflow and conventions

This is the durable model for how agent instructions are organized in this repo, across
Claude Code, Codex, and Cursor. It is not a one-off cleanup of `AGENTS.md`. It is the
rule for where any new instruction goes and how the layers stay small over time.

Read `findings.md` next to this file for the diagnosis and the research behind it.

## One principle

Keep the always-loaded layer tiny. Push everything scope-specific or procedural into a
layer that loads on demand. Keep one source of truth per fact. Make the core portable so
all three tools read the same thing.

Every rule below follows from that principle.

## The four layers

| Layer | File | Loads | Read by |
| --- | --- | --- | --- |
| 1. Root convention | `/AGENTS.md` (+ `/CLAUDE.md` bridge) | Every session, every tool | All three |
| 2. Scoped convention | `<dir>/AGENTS.md` (+ `<dir>/CLAUDE.md` bridge) | When working in that dir | All three |
| 3. Procedure / reference | `.claude/skills/<name>/SKILL.md` | Name+desc always, body on demand | All three (Agent Skills standard) |
| 4. Path-scoped enforcement | `.claude/rules/*.md`, `.cursor/rules/*.mdc` | When editing a matching file glob | Claude / Cursor only |

The first three are portable. Layer 4 is a tool-specific power-up. You almost always
reach for layers 1 to 3 first.

## Layer 1 and 2: the nested AGENTS.md backbone

All three tools read `AGENTS.md`. Codex and Cursor read it natively at the root and in
subdirectories, nearest file wins. Claude does not read `AGENTS.md`; it reads `CLAUDE.md`,
so each `AGENTS.md` gets a `CLAUDE.md` bridge beside it.

Rules:

- Each `AGENTS.md` holds only the conventions for the directory it lives in. Backend
  rules live under `api/`, frontend rules under `web/`. Neither loads while you work in
  the other.
- The root `AGENTS.md` holds only cross-cutting facts: repo map, dev loop, PR
  conventions, the env-config rule, and one-line pointers down to the scoped files.
- Default to the lowest scope that fits. The root is the last resort, because it is the
  only file every tool pays for on every task.

### The Claude bridge: symlink by default

Claude reads `CLAUDE.md`. To make a nested `AGENTS.md` reach Claude, put a `CLAUDE.md`
beside it. Two ways:

- **Symlink** `CLAUDE.md -> AGENTS.md`. Zero drift, one file to edit. Use this by default
  (we are on Linux, so symlinks are fine).
- **`@AGENTS.md` import** in a real `CLAUDE.md`. Use this only when that directory needs
  Claude-specific notes the other tools should not see. A symlink cannot add extra lines.

The root already uses the import form so it can carry Claude-only notes. Nested
directories that have no Claude-only content should use the symlink.

## Layer 3: skills for procedures and heavy reference

A skill is the right home when content is a multi-step procedure or large reference that
only matters sometimes. The name and description always load (a few tokens), and the body
loads only when used. So reference material in a skill costs almost nothing until needed.

### No single directory is universal

The `SKILL.md` format is shared across tools, but the discovery directory is not:

- Claude Code scans `.claude/skills/` and `~/.claude/skills/`.
- Codex scans `.agents/skills/` from the working directory up to the repo root, plus
  `~/.agents/skills/`.
- Cursor, Antigravity, Copilot, and Gemini follow the open Agent Skills standard, which
  uses the `.agents/skills/` repo convention.

So a skill placed only in `.claude/skills/` reaches Claude alone. To reach every tool, the
real `SKILL.md` lives in `.agents/skills/<name>/` and a symlink exposes it to Claude at
`.claude/skills/<name>`. The repo already used this for `firecrawl`; this refactor adopts
it as the rule (`agenta-package-practices`, `write-docs`, `write-pr-description`).

### Committed status matters as much as discoverability

A skill only helps teammates and headless Codex/Cursor runs if it is committed. Before this
refactor only 5 of 13 `.claude/skills` were tracked, and the committed `agents/skills/`
findings set sat at a path Codex does not scan. Rules:

- Canonical home for a shared skill: `.agents/skills/<name>/` (real) + `.claude/skills/`
  symlink. Commit both. Note: this repo's `.gitignore` ignores all dot-paths (`.*` at
  line 64), so committing a skill requires `git add -f` for now (the existing tracked
  skills got in the same way). A future cleanup could un-ignore `.claude/skills/**` and
  `.agents/skills/**` so this is automatic.
- A skill that is referenced from any `AGENTS.md` must be committed, or the reference
  dangles on a clean clone.
- Keep a skill self-contained. Do not point it at machine-local paths such as the auto
  memory directory; inline the rule instead.
- Reference a skill by name from the relevant `AGENTS.md` only when it is committed, so a
  human or a tool that does not auto-fire still gets pointed there.
- Write the description to lead with the words a request would contain. When many skills
  exist, descriptions get shortened, and weak descriptions stop matching.

Local-only skills (personal or work-in-progress, such as `run-sh`, `deploy-to-preview`,
`plan-feature`, `style-editing`) stay in `.claude/skills/` and are never named from a
committed `AGENTS.md`.

Use a skill, not the always-loaded layer, whenever a section of `AGENTS.md` has grown
into a "how to do X" procedure rather than a "this is true" fact.

## Layer 4: path-scoped rules, thin and pointing up

`.claude/rules/*.md` (Claude) and `.cursor/rules/*.mdc` (Cursor) load when you edit a file
matching a `paths:` / `globs:` pattern. They are the most deterministic way to enforce
"this applies whenever you touch these files."

Rules:

- Use them only for path-scoped enforcement that must fire reliably. Do not use them as a
  second copy of the conventions.
- Keep each one thin: a few bullets plus a pointer to the `AGENTS.md` or skill that holds
  the detail. Duplicated prose rots; pointers do not.
- Codex has no equivalent. For Codex, the nested `AGENTS.md` is the enforcement. So never
  put a rule in layer 4 that does not also exist in a layer 1 to 3 file, or Codex will
  miss it.

## Size budgets

These keep the layers small for good, not just today.

- Root `AGENTS.md`: under 150 lines and under 8 KB. Every tool loads it every session.
- Any nested `AGENTS.md`: under 200 lines.
- The Codex chain (root plus the nearest nested file) must stay under 32 KB, Codex's
  default cap. With the budgets above it fits with room to spare.
- Skill bodies have no hard cap because they load on demand. Keep the front-matter
  description tight.

If a file approaches its budget, that is the signal to push content down a level or out
into a skill, not to raise the budget.

## The repo scope map

Where each `AGENTS.md` should live, given the real tree:

- `/AGENTS.md` (+ `/CLAUDE.md`): cross-cutting. Repo orientation, dev loop, PR
  conventions, env-config rule, pointers.
- `web/AGENTS.md` (+ bridge): frontend conventions shared by `oss`, `ee`, and `packages`:
  import aliases, data fetching, styling, React practices, the Fern client rule, package
  placement, and package tests. If the package-authoring rules grow, nest a
  `web/packages/AGENTS.md` under it.
- `api/AGENTS.md` (+ bridge): API architecture. Layering and dependency direction, the
  domain folder shape, endpoint conventions, domain exceptions, typed DTOs, migration
  seams.
- `hosting/AGENTS.md` (+ bridge): the dev-stack run commands. Absorbs the `.cursorrules`
  content and overlaps the `run-sh` skill, so point to the skill rather than copy it.
- `clients/AGENTS.md` and/or `sdk/AGENTS.md`: SDK and codegen conventions, including the
  Fern generate step and the `dist/` build rule that the root currently carries.
- `docs/AGENTS.md`: docs writing conventions. Mostly a pointer to the `write-docs` skill.
- `examples/`, `services/`, `chat-ui/`: add an `AGENTS.md` only when there is a real
  convention to state. Do not create empty scaffolding.

Not every directory needs a file. Create one when there is a convention that belongs only
to that directory.

## The maintenance workflow

This is the part that makes it last. When you have a new instruction, route it:

1. Is it a multi-step procedure or long reference used only sometimes? Put it in a
   **skill** under `.claude/skills/`. Point to it from the relevant `AGENTS.md`.
2. Does it only matter in one area or directory? Put it in that **directory's
   `AGENTS.md`**. Create the file plus a Claude bridge if it does not exist.
3. Must it auto-fire whenever someone edits a specific file glob, and is the tool Claude
   or Cursor? Add a **thin path-scoped rule** that points to the file from step 1 or 2.
4. Is it genuinely true in every area, every session? Only then does it go in the **root
   `AGENTS.md`**.
5. Is it a note for human maintainers, not the agent? Put it in a README or an HTML
   comment. Claude strips `<!-- ... -->` before the file enters context.

Standing rules:

- Default to the lowest scope that fits. Root is the last resort.
- Never `@import` to "organize" a long file. Imports expand at launch and save no
  context. Move the content down a level instead.
- One source of truth. If two places would state the same rule, pick one and have the
  other point to it.
- Directory owners maintain their `AGENTS.md`. Review `AGENTS.md` edits in PRs like code.
- Revisit after model upgrades. Delete workarounds a newer model no longer needs.

## Verifying it works

- Run `/memory` in Claude. The root should be small. A nested `AGENTS.md` should appear
  only after Claude reads a file in that directory.
- For Codex, check the root plus nearest file stays under 32 KB so nothing truncates.
- The Claude `InstructionsLoaded` hook can log exactly which files loaded and when, for
  debugging path-scoped rules and lazy nested files.

## Cleaning up today's legacy

These are the existing pieces the model has to absorb. They are not new work; they are
loose ends the reorg should close:

- **`.cursorrules`** (deprecated single-file): move its dev-stack commands into
  `hosting/AGENTS.md` or the `run-sh` skill. Cursor reads `AGENTS.md` natively now. Keep
  `.cursorrules` only as a short pointer, or delete it.
- **`agents/skills/*`** (invisible to all tools): decide per skill. Move or symlink the
  ones worth keeping into `.claude/skills/`, archive the rest. As-is, nothing loads them.
- **Broken reference**: `AGENTS.md` points to
  `.claude/skills/agenta-package-practices/` twice, but it does not exist. Create the
  skill so the pointer resolves.

## A note on duplication across tools

The temptation with three tools is to write rules three times: once in `AGENTS.md`, once
in `.claude/rules`, once in `.cursor/rules`. Do not. The nested `AGENTS.md` is the shared
source all three read. The tool-specific rule directories exist only for path-scoped
auto-enforcement, and even then they should point at the `AGENTS.md`, not restate it. One
fact, one home, many pointers.
