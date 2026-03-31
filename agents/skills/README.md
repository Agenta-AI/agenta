# Findings Skills

This folder contains the canonical skill definitions for findings-driven review work in this repo.

The workflow is organized around five generic skills:

1. `scan-codebase`
2. `test-codebase`
3. `sync-findings`
4. `triage-findings`
5. `resolve-findings`

The split is by activity, not by a CR/QA lane name:

- `scan-codebase` is verification-oriented review from code and docs into findings
- `test-codebase` is validation-oriented execution from tests and runtime behavior into findings
- `sync-findings` keeps GitHub and the findings record aligned
- `triage-findings` is the discussion and planning layer
- `resolve-findings` is the execution layer back into code, tests, and docs

All skills accept optional `path=`.

- If `path` is provided, use that local design or findings folder.
- If `path` is omitted, infer it and state the inferred value before starting.

Preferred master document:

- `findings.md`

Shared references:

- `shared/references/findings.schema.md`
- `shared/references/findings.lifecycle.md`

## Diagram

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

## Invocation

For Codex:

- invoke a skill with `$skill-name`
- `agents/skills/` is the canonical source, but Codex auto-discovers from `~/.codex/skills`
- if a skill does not appear under `$`, refresh the symlink or install it into `~/.codex/skills` and reload Codex

For Claude:

- invoke a project skill with `/project:skill-name` when your Claude client exposes project skills that way
- otherwise use the Claude project skills picker after reloading the project
- `.claude/skills/` contains the Claude-facing wrappers for the canonical skills in `agents/skills/`

## Skills

### `scan-codebase`

Use for a fresh-context scan of code and docs that turns review observations into findings.

Parameters:

- `path=<local-folder>` optional
- `depth=deep` by default
- supported values: `shallow`, `deep`

Use when:

- you want a review pass anchored in current code and docs
- you want verification findings before planning
- you want to surface missing tests or coverage gaps as review findings without running tests yet

For Codex:

```text
$scan-codebase
```

For Claude:

```text
/project:scan-codebase
```

### `test-codebase`

Use to run or inspect the relevant validation paths and turn failures, regressions, or missing coverage into findings.

Parameters:

- `path=<local-folder>` optional
- `depth=deep` by default
- supported values: `shallow`, `deep`

Use when:

- you want validation findings from actual test execution or targeted repro
- you want to confirm whether missing or broken behavior is observable
- you want missing test coverage turned into findings

For Codex:

```text
$test-codebase
```

For Claude:

```text
/project:test-codebase
```

### `sync-findings`

Use to sync the findings record against local review artifacts and optionally a GitHub PR.

Parameters:

- `path=<local-folder>` optional
- `url=<github-pr-url>` for remote + local sync
- omitted `url` means local-only sync

Use when:

- you want findings updated from open PR comments or local notes
- you want clearly closed threads acknowledged and resolved
- you want the master findings file to match current GitHub state and current local code state

For Codex:

```text
$sync-findings
```

For Claude:

```text
/project:sync-findings
```

### `triage-findings`

Use to coordinate the next review or testing actions with the user and turn findings into a plan.

Parameters:

- `path=<local-folder>` optional
- `url=<github-pr-url>` optional when PR context matters

Use when:

- you need follow-up questions answered before acting
- you need to decide whether to run `scan-codebase`, `test-codebase`, or `sync-findings`
- you need severity, confidence, status, owner questions, and next action clarified

For Codex:

```text
$triage-findings
```

For Claude:

```text
/project:triage-findings
```

### `resolve-findings`

Use to implement the chosen fix path for findings and update the findings record afterward.

Parameters:

- `path=<local-folder>` optional
- default `priority=next-highest`
- explicit values: `P0`, `P1`, `P2`, `P3`, `all`

Default behavior:

- if unresolved findings exist at `P0`, resolve `P0` on this run
- if `P0` is exhausted, the next run resolves `P1`
- then `P2`, then `P3`

Use when:

- findings are implementation-ready or nearly so
- you want code, test, and docs changes applied
- you want targeted verification or validation rerun after the fix

For Codex:

```text
$resolve-findings
```

For Claude:

```text
/project:resolve-findings
```
