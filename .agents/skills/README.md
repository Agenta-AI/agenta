# Agent skills

This folder holds the repo's agent skills. Each skill is a folder with a `SKILL.md`. Its
frontmatter `description` says when an agent loads it. `shared/` holds references that
several skills use and is not a skill.

## How skills are wired

- The source of each skill is `.agents/skills/<name>/`. Codex reads this folder.
- `.claude/skills/<name>` is a symlink to `../../.agents/skills/<name>`. Claude Code reads it.
- The root `.gitignore` ignores both folders and allowlists each skill. A new skill needs two
  allowlist lines, `!.agents/skills/<name>/` and `!.claude/skills/<name>`, plus the symlink:
  `ln -s ../../.agents/skills/<name> .claude/skills/<name>`.
- When a new file does not show in `git status`, run `git check-ignore -v <file>` to find the
  missing allowlist line.

## Frontend

- `agenta-package-practices`: where frontend code goes (package or `web/mobile`) and how to
  use the `@agenta/*` packages.
- `mobile-app-structure`: feature folders, the `states/` convention, and data flow in
  `web/mobile`.
- `mobile-motion-patterns`: motion presets, when to animate, and reduced motion in
  `web/mobile`.
- `mobile-shadcn-conventions`: how `web/mobile` installs, themes and extends shadcn/ui, and
  builds chat UI on `@agenta/chat`.
- `test-design`: what to test and how to write tests for `web/mobile` and the `@agenta/*`
  packages.
- `verify-agenta-mobile`: drive the real app at `localhost:3000/m` in a browser and capture
  proof.

## Agent runtime and release

- `add-harness`: playbook for adding a new coding-agent harness to Agenta.
- `agent-release-gate`: wire-level QA harness for the agent runtime, run before an
  agent-workflows release.
- `sync-model-catalog`: refresh harness catalogs, provider model lists and recommended
  defaults.
- `update-llm-model-list`: audit the supported LLM model list in `assets.py` against
  litellm's registry.
- `write-template-playbooks`: write a per-use-case template playbook for the build-an-agent
  skill.

## Design and naming

- `design-interfaces`: classify interface fields by semantic role, for APIs, wire fields,
  configs and tool definitions.
- `naming-and-resources`: pick the name of a concept in every layer and give every stored item
  kind the same resource shape.

## Review

The four lenses share one contract: `shared/references/review-contract.md`.

- `review-correctness`: bugs, regressions, broken flows, concurrency, and migrations.
- `review-naming`: naming, consistency and layering in a change or a design.
- `review-simplify`: needless complexity in a change or a design.
- `review-slop`: avoidable, low-trust agent work in a change.
- `prepare-pr-review`: a plain-language review briefing for a GitHub PR.

## Findings

The five findings skills share one record (`findings.md`). The inputs, their defaults and the
shared rules are in `shared/references/findings.lifecycle.md`. The record's shape is in
`shared/references/findings.schema.md`.

- `scan-codebase`: a fresh-context scan of code and docs that records findings.
- `test-codebase`: run or inspect validation and record failures and missing coverage.
- `sync-findings`: align the record with local artifacts and, when asked, a GitHub PR.
- `triage-findings`: decide the next step with the user and turn findings into a plan.
- `resolve-findings`: implement the chosen fixes, one priority bucket at a time.

```text
                 Git / PR / Review Threads
                           ^
                           | sync-findings
                           v
Code + Docs -- scan-codebase --> Findings <-- test-codebase -- Tests / Runtime / Docs
                                    |
                                    v
                              triage-findings
                                    |
                                    v
                              resolve-findings
                                    |
                                    v
                           Code / Tests / Docs
```

## Writing and announcements

- `style-editing`: make prose plain and clear, with Williams' revision principles.
- `write-issue`: write and file Linear issues the Agenta way.
- `write-pr-description`: write PR titles and descriptions.
- `create-changelog-announcement`: write and publish changelog entries and the in-app What's
  New data.
- `write-social-announcement`: social posts for LinkedIn, X and Slack about a release or
  feature.
- `update-public-surfaces`: carry one change (a name, tagline, link or logo) to every
  user-facing place in the repo.

## Docs

- `write-docs`: style, voice and structure for the v2.0 docs under `docs/docs/`.
- `keep-docs-in-sync`: update the docs in the same PR as a code or contract change.
- `update-api-docs`: regenerate the API reference from the production OpenAPI spec.

## Repo operations

- `gitbutler-stacks`: GitButler mechanics for stacked lanes, PR bases and workspace recovery.
