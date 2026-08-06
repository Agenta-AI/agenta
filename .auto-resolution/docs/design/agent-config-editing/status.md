# Status

Updated: 2026-08-05 evening, by team-lead.

## Implementation state: complete, fix round landed, PRs opening

All in-scope user stories (US-1, US-2, US-3, US-4, US-5, US-7, US-8) are implemented
behind the single feature flag `AGENTA_WORKFLOWS_ORDERED_OPERATIONS_ENABLED`. US-6 is
out of scope by decision.

The work sits on eighteen stacked GitButler lanes, bottom to top: plan (design docs)
→ s5 → s4 → s1a → s6 → s1b-lock → s1b → s7a → s2 → s7b → s3a → s7c → s3b-core →
s7d → s7e → s3b-wire-runner → s3b-wire-py → s3b-wire-web. Every lane is pushed and
verified against the remote. The stack base is the release/v0.109.0 merge base
(4165aa81df); PR bases follow the stack, bottom lane targets release/v0.109.0, never
main.

## Final review round (5 August, evening)

The external reviewer (Codex, highest reasoning) returned BLOCK on the full stack
diff: four blocker-class findings, eight majors, four structural notes on the dao
lane. Full text: `notes/final-review-findings.md`. Every finding was independently
verified against the code before any fix; two sub-claims were refuted with proof,
two findings matched recorded scope decisions, and the rest were confirmed and
fixed. The verification also surfaced three defects the reviewer missed (lost
exception decorators on the commit route, the never-applied agent scope policy, the
unwired final-validation gate) plus a legacy scope-walk depth bug found during the
E2 fix itself. All fixes are landed on their owning lanes.

Headline outcomes:

- The agent commit tool now posts to a scoped sibling route
  (`/api/workflows/revisions/commit/agent`) that hard-applies `AGENT_COMMIT_SCOPE`
  on both delta arms and refuses full-data commits. Enforcement is a property of
  the code path; the model holds no credential and cannot reach the unscoped
  route. read-config.md §11.2 records the design.
- A denied approval now discards its execution authorization before the harness is
  answered; a forged relay execution for a denied call fails closed.
- Live reconciliation routes are narrowed to what is actually installable
  (workspace refresh from the incoming request, model apply-live, credential
  rotation); everything reopen-session claimed to cover escalates to rebuild until
  the S7c0 execution-plan split lands. adapter-matrix.md §8 records the boundary.
- The import root opens no-follow on both readers; malformed UTF-8 is refused by a
  fatal decoder; Build mode always renders the frozen approval manifest.
- The commit transaction surfaces lock timeouts as 503, never claims "committed"
  without a revision, compares no-change after enrichment, and routes both delta
  arms through the engine's classification (a legacy set can no longer commit
  build-kit tools or bypass marker rejection).

Accepted scope boundaries, recorded not fixed: the full atomic build-callback
transaction (commit-transaction.md §3.1, dao lock note §4), dao structural bullets
1 and 4 (opt-in lock boundary, version bookkeeping outside the lock), and the
follow-ups listed in `open-issues.md`.

## Verification state

After the fix round, on the landed tree: runner 114 files / 1913 tests, typecheck
clean; API full unit suite 1911 both flag states (single failure is an unrelated
untracked repro in the tree, not part of this stack); SDK 797 agent tests plus the
catalog suites both flag states; web AgentChatSlice 95 tests, project typecheck
clean; repo-pinned ruff clean in api/ and sdks/python/.

Live QA on a deployed stack is deliberately deferred: Mahmoud will exercise the
deployed stack himself when the PRs are ready (his call, 5 August). The dev box had
no capacity for a fifth stack and no running stack may be torn down without his
naming it.

## Remaining

- Open the stacked PRs with per-lane descriptions and inline comments (in
  progress).
- Docs sync for the changed public surfaces.
- Codex upstream issue (live MCP tool updates) stays drafted in
  `spikes/runner-spike.md`; filing needs Mahmoud's explicit approval.
