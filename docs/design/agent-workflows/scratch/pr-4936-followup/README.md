# PR #4936 follow-up — thread index

This folder is the working home for everything from reviewing PR #4936. One file per thread,
each with Context / Explanations / History / Open decision threads. **Start here.**
`00-overview.md` is background only, not a decision thread. The numbered files `01`-`08` are the
threads.

## What needs your review NOW

- **Thread 04 plan** — `projects/agent-chat-revision-switch/design.md`. The chat-loss +
  "connection lost" investigation is done. Both symptoms are ONE cause: the conversation is keyed
  by the revision id and remounts on every switch. The hotfix alone is insufficient; the real fix
  is the DECOUPLE you suspected, and it is small / low-risk. Review the plan, then we implement.

Coming next, each as a reviewable plan or draft PR (your rule: plan-feature → draft PR → review →
implement): the client-tool cleanup PR (02), the commit_revision tool draft PR (01), the API-URL
plan + draft PR (06), and a short explanation for thread 05.

## Open decisions still pending your call

| # | Where | Decision | My rec |
|---|---|---|---|
| 1 | `02` D3 | Claude+Daytona gets ZERO tools, silently. Ship honest gate (c) now; build in-sandbox shim (a) later. | (c) now, (a) later |
| 2 | `04`    | Approve the DECOUPLE plan (over the insufficient hotfix). | Approve the decouple |
| 3 | `05` D2 | RESOLVED: fix in runner `otel.ts` (refresh input on later update); fold into cleanup unless you want it standalone | folding in |

## Decided (locked)

- Keep JP's `delta`; `commit_revision` becomes a tool on top (01 design done; draft PR queued).
- Client tools must work on Claude, no silent breakage; revised cleanup plan approved → implementing (02).
- `render: connect` typed; required-field validation stays on for client tools; rename `publicToolSpecs`.
- `commit_revision` fail-closed on drafts + an actionable "ask the user to commit first" message (03).
- `integration` required for `request_connection` (05 D1; verify the schema source).
- Standing rule: every non-trivial issue gets plan-feature + a reviewable draft PR before implement-feature.
- Thread 08: ignore the poisoned dev rows; ship #4982 as FE-revert-only (backend change reverted).

## In flight

- **#4982 MERGED** into big-agents as FE-revert-only (merge commit `19e0f2d9`). Done.
- Client-tool cleanup — RESUMED (Phases 1-2 committed on `feat/claude-client-tools`; continuing Phase 3-5).
- thread-05 research (why OTel is involved in the tool-input display).
- PRs serialize through one git-writer: #4982 → cleanup → commit_revision draft → API-URL.

## How we work

- You talk to me; I run subagents and relay. Answer decisions in the thread files or just tell me.
- One git-writer at a time, so PRs serialize; read-only plans/research run in parallel.
