# Codex harness: final project report

Date: 2026-07-25. Audience: Mahmoud. This closes the project started 2026-07-24.
Per-milestone reports with recordings live beside this file; `decisions.md` holds
every ruling and amendment; `lane-split-plan.md` holds the verified split for the
PR train.

## What exists now

Codex is a first-class harness in Agenta, on the worktree branch, at parity with
Claude where Codex can express the feature:

- **Playground**: pick Codex, stream multi-turn conversations, on a managed key or
  on a ChatGPT subscription with no API key anywhere.
- **Tools**: Agenta tools deliver over the internal MCP channel and execute with
  full tracing and correct cost reporting.
- **Approvals**: allow runs without pausing, ask pauses with a real approval card
  and resumes WARM — in place, on the live session, keeping the parked tool-call id
  — and deny refuses cleanly. This is the D-008 amendment (2026-07-31): both images
  patch codex-acp's full-access preset to `on-request`, so Codex raises native
  gates that ride the same parked-approval machinery as Claude. Cold replay remains
  the fallback (verified), and the full {local, daytona} × {allow, deny, warm,
  cold1, cold2} matrix is green (`reports/warm-approvals-qa.md`).
- **Subscription**: the operator mounts their Codex login; only the credential file
  is visible to sessions (a verified leak of personal config into product runs was
  found and closed); token refresh flows to the real login, which QA proved
  untouched by hash.
- **Daytona**: managed-key runs work on real Daytona sandboxes, with the credential
  kept in-VM so it never touches durable storage, and the layout is forward-
  compatible with the Daytona Secrets placeholder design by construction.
- **Guard rails**: a release-gate cell, a pinned bridge version in the runner
  images, an offline replay regression test, contract tests on both sides of the
  wire, and updated docs.

Final suite state: 1,252 runner tests, 691 SDK agent tests, typecheck, ruff, and
the golden wire contract all green.

## What the process caught (the case for the discipline)

Every milestone's live QA earned its cost. The blockers found and fixed, none of
which unit tests could see: Codex's SQLite state wedging the S3 session mount
(fixed with Codex's supported state redirect after a probe proved resume rides
plain files); missing response-model attribution making every run show $0.00
(after a wrong first diagnosis, corrected honestly); rendered config entries that
Codex's validator rejected, killing every tool session (misdiagnosed as a
deployment regression until a debugging agent proved the rollback control had
covered the wrong container); an approval that re-parked instead of resuming
because two sides keyed arguments differently; and the subscription mount leaking
the operator's personal MCP servers into product runs, closed with the symlink
layout and proved closed by an inverted probe. Each produced a regression test or
a structural fix plus a playbook lesson; the `add-harness` skill now carries 30+
lessons and is committed to the repo per D-001.

## Open items, owner: Mahmoud

1. **Ratify the in-VM Daytona home (D-002 amendment, proposed and implemented).**
   The approved layout put the credential under the session working directory; on
   Daytona that directory is durable S3 storage, and teardown order means a
   written key could outlive the run there. The implemented repair keeps the key
   inside the sandbox VM only, reaped with it. Trade-off: no durable native Codex
   resume across sandbox replacement on Daytona, which loses nothing today because
   no Codex session mount exists yet.
2. **Choose the lane split.** The plan recommends the area split (SDK, then
   runner, then web, then docs; disjoint file sets, zero files split across lanes,
   bases chained per the repo's stacked-PR conventions). The alternative
   concern-split reads better per-PR but has five files spanning lanes, which is
   the known-painful GitButler case. Recommendation: area split.
3. **Follow-ups outside this branch**: the Daytona snapshot ships an older Codex
   than the runner pin (it rejected the current model generation; the snapshot
   recipe needs the same pin), and a pre-existing, harness-independent bug in the
   managed connection resolver (explicit slugs fail deployment-wide) is being
   filed as a tracked issue.

## What happens on your go

On your ruling for items 1 and 2, the lane split executes in the main checkout per
the plan, PRs go up stacked with the bases the plan specifies, and everything
stops at green and ready-to-merge. Merging is yours.
