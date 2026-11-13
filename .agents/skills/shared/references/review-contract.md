# Review contract

The four review lenses (`review-correctness`, `review-naming`, `review-simplify`,
`review-slop`) share this contract. Each lens skill adds its lens, its rating rules, and any
extra fields or sections for its report.

## Targets

The caller names one target.

- **Code (default).** A diff between two commits. Every lens accepts it.
- **Design.** An OpenSpec change folder, a spec draft, or an architecture doc. Only the
  lenses that say so accept it (`review-naming` and `review-simplify`).

## Inputs

The caller gives you these. If the caller leaves one out, work it out and say what you used.

For a code target:

- **Checkout path.** A checkout of the repo at the head commit. Read code there.
- **Base.** The commit the change starts from. For a PR, use the merge base of the PR head
  and its base branch, never the current tip of the base branch.
- **Head.** The last commit of the change.

Read the change with `git -C <checkout> diff <base> <head>`. Add `-- <path>` to read one
file. You may skim the commit log from base to head to learn the intent.

For a design target:

- **Checkout path.** A checkout of the repo the design applies to. Read today's code there,
  so you can check what the design claims about today and what it would add.
- **Design path.** The spec folder or the doc. Read every file in it.
- **Version.** The commit or date of the design, so the report names what you read.

For both:

- **Context file (optional).** Decisions that are already settled: findings that were fixed,
  rejected with a reason, or deferred, and product rules from the owner. Do not raise a
  settled point again unless the fix is wrong or incomplete. Then say why.

## Rules

- Read-only. Do not edit code or documents, and do not post anything.
- Do not install dependencies, and do not run builds, type checks, linters, or tests. Judge
  tests by reading them next to the code they test.
- Do the review yourself. Do not hand it to another agent.
- Judge the final diff, not the commit history. Code that is already at the base is existing
  code. It counts only where the target adds to it, depends on it, or makes an existing
  problem reachable.
- Anchor each finding to the changed code, or to the spec file and heading. Mark a finding you
  could not confirm as a hypothesis, and say what would confirm it.
- Prefer a few substantial findings to a list of style nits.

## Output format

Write the report in plain English, in this shape. The lens skill gives the title, the text
for "What is wrong", the closing section, and any extra fields or sections.

```markdown
# <Lens> review

Base: <base sha, or "design" for a design target>
Head: <head sha, or "<design path> at <commit or date>" for a design target>

## Findings

### 1. <one-line title>
- Severity: High | Medium | Low
- Where: <file>:<line> (more locations if needed; for a design, the spec file and heading)
- What is wrong: <set by the lens>
- Smallest fix: <the smallest change that removes the problem>

(more findings, most severe first; write "No findings." if there are none)

## <closing section set by the lens>

Rating: Low | Medium | High
```

The last line must be `Rating: <value>` with nothing after it, so a script can read it.
