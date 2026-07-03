# Thread 07 — Other changes bundled into #4936

## Context

#4936 also carried small changes unrelated to the two features. Explained here for
completeness. No open decisions.

## Explanations

- **Builtin invocation URL (`runnableSetup.ts`):** this was a HACK, not a real fix (see
  thread 00, resolved). An agent `commit_revision` self-update had written the agent
  service's internal address into the stored `data.url`; #4936 added a FE workaround that
  only covered completion/chat, never agent. Fixed properly in PR #4982 (backend recomputes
  and strips the builtin URL for builtins; the FE hack is reverted). [[ok we have a pr to revert that]]
- **Build-kit overlay per revision (revisionId threading):** the read-only "build kit"
  block is fetched per revision. The control was not told which revision is open, so it
  now passes the revision id down so the block matches the displayed revision. [[[I ASKED MANY TIME FOR YOU TO EXPLAIN WHY THE FUCK WE NEED REVISION ID FOR THE BUILD KIT!! ANSWER ]]]
- **`useToolRelay` (`run-plan.ts`):** the relay now starts whenever any tool exists, not
  just executable ones, so client-only runs can park. Cost: a remote poll a few times a
  second on Daytona client-tool runs. A backoff is in thread 02's plan, phase 5.
- **Logging (`sandbox_agent.ts`):** one debug line of tool counts. Harmless.

## History

- All bundled into #4936 and merged.

## Open decision threads

None. Retrospective only: the builtin-URL fix would have been cleaner as its own PR.
