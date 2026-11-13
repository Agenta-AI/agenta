# Findings lifecycle

Review and testing work uses five stages. Each stage is one skill, and all five share one
findings record (`<path>/findings.md`, shaped by `findings.schema.md`).

1. `scan-codebase`: read code and docs from fresh context and record findings.
2. `test-codebase`: run or inspect validation and record findings.
3. `sync-findings`: align the record with local artifacts and, when asked, a GitHub PR.
4. `triage-findings`: decide the next step and ask the open questions.
5. `resolve-findings`: implement the chosen fixes and update the record.

Each skill holds its own workflow. This file holds the inputs and the rules that all stages
share.

## Inputs

| Input | Accepted by | Default | Values |
|---|---|---|---|
| `path` | all five | `infer` | The local design or findings folder. |
| `depth` | scan, test | `deep` | `shallow` or `deep`. |
| `url` | sync, triage | `local-only` | A GitHub PR URL. |
| `priority` | resolve | `next-highest` | `P0`, `P1`, `P2`, `P3`, or `all`. |

- **`path`.** Use the given folder. If none is given, infer it from the branch, the subsystem,
  or matching docs, and state the inferred value before you start.
- **`depth`.** `shallow` covers the changed files and their immediate neighbors. `deep`
  follows cross-layer flows, adjacent modules, tests, docs, migrations, and earlier review
  artifacts.
- **`url`.** With a PR URL, sync reads remote PR state as well as local state, and triage uses
  it when it needs GitHub context or runs `sync-findings`. Without one, both stay local.
- **`priority`.** Map a `High`, `Medium` or `Low` severity to `P1`, `P2` or `P3` first, as
  `findings.schema.md` defines. With no value, resolve only the highest remaining bucket, in the order `P0`,
  `P1`, `P2`, `P3`. With one level, resolve only that bucket. With `all`, resolve every
  remaining bucket.

## Shared rules

- Before you start, confirm the effective inputs with the user, plus the branch, PR, or
  subsystem scope when you can infer it.
- Treat the findings record as the master record. The chat history is not the record.
- Keep the document order that `findings.schema.md` sets: non-findings sections above
  `## Open Findings`, and each finding in `## Open Findings` or `## Closed Findings` to match
  its status.
- Ask before you park ambiguity. If the user commented on a finding but left its disposition,
  uncertainty, or fix path unclear, ask the next concrete question in the same turn. Do not
  leave a finding at `open` or `needs-user-decision` without asking the question that blocks
  the next step. When several findings are unclear, batch the questions by finding ID.
- Scan reading does not count as validation. `test-codebase` runs validation. `resolve-findings`
  may also run the checks that prove its own fix.
- Ask the user before any change to GitHub, such as a reply to a thread or a resolved thread.
