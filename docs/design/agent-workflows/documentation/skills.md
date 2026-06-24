# Skills

A skill is a procedure the agent loads on demand. Each one lives in its own folder as a
`SKILL.md` file with a short frontmatter (`name`, `description`) and a body of instructions.
The frontmatter description tells the agent when to reach for the skill. The body tells it how
to do the work. This keeps the always-loaded instruction layer small and pushes heavy
procedure into files that load only when a task matches.

This page explains the skills we use to build the agent-workflows feature and how they chain
across a feature's life. For the repo-wide rule on where instructions live, see the root
`AGENTS.md` section "How agent instructions are organized."

## Where skills live

Skills have two homes, and the home decides who shares them.

- **Shared skills** live in `.agents/skills/<name>/` and are symlinked into
  `.claude/skills/`. Git tracks them, so the team and every tool (Claude Code, Codex, Cursor)
  read the same procedure. Put a skill here when others should run it too.
- **Personal skills** live as real folders in `.claude/skills/<name>/`. Git ignores them, so
  they stay on one machine and never reach a branch. Put a skill here when it encodes your own
  workflow rather than a team contract.

A skill becomes invocable as a slash command by its `name`. The agent can also call a skill on
its own when a task matches the description, without being asked.

## The skills behind a feature's life

We build a feature in stages, and a skill drives each stage. The chain below is the spine. The
two anchor skills are `plan-feature`, which produces the plan, and `implement-feature`, which
turns that plan into a landed change.

```
plan-feature  ->  implement-feature  ->  write-pr-description
                        |
        implement-feature orchestrates, per slice:
        debug-local-deployment  ·  agent-workflows-qa  ·  agent-replay-test
        write-docs  ·  style-editing  ·  defer-todo  ·  but
```

### Plan: plan-feature

`plan-feature` (personal) opens a planning workspace under `docs/design/<project>/`. It
researches the repo first, then writes `context.md`, `plan.md`, `status.md`, and
`research.md`. That workspace is shared context for every later stage and for any human who
joins. `status.md` is the source of truth for progress and stays current to the end.

### Implement: implement-feature

`implement-feature` (personal) is the step after the plan. It does not write the whole feature
in one pass. Instead it orchestrates. The agent stays in the loop and spins a narrow subagent
for each phase: refresh the plan, implement a slice, review the diff, debug the slice against
the live stack until it works end to end, then improve the tests until they pass across the
matrix. Two rules hold throughout: every implementer is followed by a reviewer, and every fix
is followed by a retest. The skill leans on the four skills below for its debug, test, docs,
and branch phases.

### Debug: debug-local-deployment

`debug-local-deployment` (personal) drives the live Agenta stack on the dev box. It finds the
running port and compose project, logs into the playground in Chrome, reads container logs,
and hits the backend API with a project key. The debug phase of `implement-feature` runs this
skill in a loop: run, observe, fix, re-run, until the slice does what its acceptance check
says.

### Test: agent-workflows-qa and agent-replay-test

`agent-workflows-qa` (shared) defines the test matrix for the agent runtime. Its three axes
are the environment (in-process Pi, Rivet local, Rivet Daytona, and the local SDK), the
harness (`pi`, `agenta`, `claude`), and the capability under test. "Test with daytona, local
pi, and claude, on both the SDK and the UI" is exactly a walk across these cells. Each test
forces a capability with a token the model cannot guess, so a pass proves the capability ran.

`agent-replay-test` (shared) pins a green cell so it stays green. It captures one real `/run`,
redacts the volatile fields, and writes a test that replays the recorded runner response
through the real SDK and service code with no live LLM. These tests run cost-free in the
default CI lane.

### Document: write-docs and style-editing

`write-docs` (shared) carries Agenta's documentation voice and structure, grounded in the
Diátaxis framework. `style-editing` (personal) applies Joseph Williams' clarity principles:
real characters as subjects, active voice, old information before new, the strongest word
last. The document phase of `implement-feature` drafts with the first and revises with the
second.

### Park and ship: defer-todo, but, write-pr-description

`defer-todo` (shared) records work the agent cannot finish now, with a clean repro, so nothing
is lost. `but` (personal, global) runs every version-control operation through GitButler
instead of raw git, which the repo requires. `write-pr-description` (shared) writes the PR
title and body the way a staff engineer would, once the branch is ready to push.

## Adding a skill

Write the skill at the lowest scope that fits. A team contract is shared; a personal workflow
is local. Give it a frontmatter `description` that names the trigger, because that line is how
the agent decides to load it. Keep the body a procedure, not a reference dump. When a skill
grows heavy, split the reference into sibling files and let the `SKILL.md` point to them.
