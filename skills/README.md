# Review Skills

This folder contains the canonical skill definitions for review work in this repo.

The skills are split across two lanes:

- `CR`: verification
- `QA`: validation

and three stages:

- `scan`
- `triage`
- `resolve`

Pipeline:

1. `scan`
2. `triage`
3. `resolve`

All skills also accept optional `path=`.

- If `path` is provided, use that local design or findings folder.
- If `path` is omitted, infer it and state the inferred value before starting.

Master findings files:

- `CR.findings.md`
- `QA.findings.md`

Shared references:

- `shared/references/findings.schema.md`
- `shared/references/findings.lifecycle.md`

## Invocation

For Codex:

- invoke a skill with `$skill-name`
- repo-local `skills/` is the canonical source, but Codex only auto-discovers skills from `~/.codex/skills`
- if a skill does not appear under `$`, install or symlink it into `~/.codex/skills` and reload Codex

For Claude:

- invoke a project skill with `/project:skill-name` when your Claude client exposes project skills that way
- otherwise use the Claude project skills picker after reloading the project
- `.claude/skills/` contains Claude-facing wrappers for the canonical skills in `skills/`

## CR vs QA

- `CR` is verification: correctness, consistency, completeness, soundness, functionality, security, performance, compatibility, migration safety.
- `QA` is validation: user flows, acceptance criteria, scenario coverage, environment behavior, rollout behavior, reproducibility.

## Skills

### `cr-scan-codebase`

Use for a fresh-context verification scan of the codebase.

Parameters:

- `path=<local-folder>` optional
- `depth=deep` by default
- supported values: `shallow`, `deep`

Use when:

- you want a full code review pass without anchoring on prior findings
- you want candidate CR findings before triage

Example:

```text
Use $cr-scan-codebase with depth=deep to inspect this branch for correctness, compatibility, and migration risks.
```

For Codex:

```text
$cr-scan-codebase
```

For Claude:

```text
/project:cr-scan-codebase
```

### `qa-scan-codebase`

Use for a fresh-context validation scan of the codebase.

Parameters:

- `path=<local-folder>` optional
- `depth=deep` by default
- supported values: `shallow`, `deep`

Use when:

- you want likely user-flow or rollout failures before triage
- you want scenario and coverage gaps surfaced from code and docs

Example:

```text
Use $qa-scan-codebase with depth=deep to inspect this feature for broken flows, rollout hazards, and missing QA coverage.
```

For Codex:

```text
$qa-scan-codebase
```

For Claude:

```text
/project:qa-scan-codebase
```

### `cr-triage-findings`

Use to sync CR findings against current local code and optionally a GitHub PR.

Parameters:

- `path=<local-folder>` optional
- `url=<github-pr-url>` for remote + local triage
- omitted `url` means local-only triage

Use when:

- you want to sync PR comments, prior CR docs, and current code
- you want to update `CR.findings.md`
- you need severity, confidence, status, and open questions normalized

Example:

```text
Use $cr-triage-findings with url=https://github.com/owner/repo/pull/123 to sync remote comments and local findings into CR.findings.md.
```

Local-only example:

```text
Use $cr-triage-findings to sync existing CR docs and current code into CR.findings.md.
```

For Codex:

```text
$cr-triage-findings
```

For Claude:

```text
/project:cr-triage-findings
```

### `qa-triage-findings`

Use to sync QA findings against current local behavior and optionally a GitHub PR.

Parameters:

- `path=<local-folder>` optional
- `url=<github-pr-url>` for remote + local triage
- omitted `url` means local-only triage

Use when:

- you want to sync QA notes, PR comments, and current behavior
- you want to update `QA.findings.md`
- you need scenario clarity, status, and decision points normalized

Example:

```text
Use $qa-triage-findings with url=https://github.com/owner/repo/pull/123 to sync remote comments and local QA findings into QA.findings.md.
```

Local-only example:

```text
Use $qa-triage-findings to sync QA notes, existing findings, and current local behavior into QA.findings.md.
```

For Codex:

```text
$qa-triage-findings
```

For Claude:

```text
/project:qa-triage-findings
```

### `cr-resolve-findings`

Use to implement fixes for triaged CR findings.

Parameters:

- `path=<local-folder>` optional
- default `priority=next-highest`
- explicit values: `P0`, `P1`, `P2`, `P3`, `all`

Default behavior:

- if unresolved findings exist at `P0`, resolve `P0` on this run
- if `P0` is exhausted, the next run resolves `P1`
- then `P2`, then `P3`

Use when:

- findings are already confirmed
- the intended fix path is already chosen
- you want implementation plus regression coverage

Example:

```text
Use $cr-resolve-findings to resolve the next highest-priority bucket in CR.findings.md.
```

Explicit example:

```text
Use $cr-resolve-findings with priority=P2 to resolve only P2 findings from CR.findings.md.
```

For Codex:

```text
$cr-resolve-findings
```

For Claude:

```text
/project:cr-resolve-findings
```

### `qa-resolve-findings`

Use to implement fixes and re-validation for triaged QA findings.

Parameters:

- `path=<local-folder>` optional
- default `priority=next-highest`
- explicit values: `P0`, `P1`, `P2`, `P3`, `all`

Default behavior:

- if unresolved findings exist at `P0`, resolve `P0` on this run
- if `P0` is exhausted, the next run resolves `P1`
- then `P2`, then `P3`

Use when:

- findings are already confirmed
- the expected behavior or validation plan is already chosen
- you want fixes plus re-validation or stronger test coverage

Example:

```text
Use $qa-resolve-findings to resolve the next highest-priority bucket in QA.findings.md.
```

Explicit example:

```text
Use $qa-resolve-findings with priority=all to resolve all remaining QA findings.
```

For Codex:

```text
$qa-resolve-findings
```

For Claude:

```text
/project:qa-resolve-findings
```

### `scan-codebase`

Use to orchestrate both `cr-scan-codebase` and `qa-scan-codebase`.

Parameters:

- `path=<local-folder>` optional
- `depth=deep` by default
- supported values: `shallow`, `deep`

Use when:

- you want one entry point for both verification and validation scanning
- you want CR and QA to run independently, preferably in separate fresh contexts

Example:

```text
Use $scan-codebase with depth=deep to run both CR and QA scans on this branch.
```

For Codex:

```text
$scan-codebase
```

For Claude:

```text
/project:scan-codebase
```

### `triage-findings`

Use to orchestrate both `cr-triage-findings` and `qa-triage-findings`.

Parameters:

- `path=<local-folder>` optional
- `url=<github-pr-url>` for remote + local triage
- omitted `url` means local-only triage

Use when:

- you want one entry point for syncing both `CR.findings.md` and `QA.findings.md`
- you want remote PR comments and local repo state reconciled in both lanes

Example:

```text
Use $triage-findings with url=https://github.com/owner/repo/pull/123 to run both CR and QA triage.
```

For Codex:

```text
$triage-findings
```

For Claude:

```text
/project:triage-findings
```

### `resolve-findings`

Use to orchestrate both `cr-resolve-findings` and `qa-resolve-findings`.

Parameters:

- `path=<local-folder>` optional
- default `priority=next-highest`
- explicit values: `P0`, `P1`, `P2`, `P3`, `all`

Use when:

- you want one entry point for both CR and QA resolution
- you want the next unresolved severity bucket handled across both lanes

Example:

```text
Use $resolve-findings to resolve the next unresolved bucket across CR and QA findings.
```

For Codex:

```text
$resolve-findings
```

For Claude:

```text
/project:resolve-findings
```

## Suggested Usage

For verification:

1. `cr-scan-codebase`
2. `cr-triage-findings`
3. `cr-resolve-findings`

For validation:

1. `qa-scan-codebase`
2. `qa-triage-findings`
3. `qa-resolve-findings`
