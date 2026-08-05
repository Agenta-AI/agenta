# Verdict: BLOCK

The stack has four blocker-class defects in security and approval handling, plus major DAO and change-set correctness gaps. I reviewed the fetched `origin/release/v0.109.0...agent-config-editing-s3b-wire-web` range; the workspace was not modified.

## Defects

1. **Blocker — Import confinement can be moved outside the workspace with a symlinked import root.**  
   [workspace-reader.ts:163](/home/mahmoud/code/agenta-2/services/runner/src/tools/workspace-reader.ts:163), [workspace-reader.ts:421](/home/mahmoud/code/agenta-2/services/runner/src/tools/workspace-reader.ts:421)

   The local reader opens `.agenta-imports` without `O_NOFOLLOW`, so a root symlink is followed before descriptor-based traversal begins. The Daytona reader resolves both root and target, but if the root itself points outside the workspace, its descendant check still succeeds. Daytona also checks only the final entry’s own type, so intermediate symlinks are accepted.

   **Fix:** Open the local root with `O_NOFOLLOW | O_DIRECTORY`. For Daytona, `lstat` the root and every path component, reject every link, require the resolved root to remain beneath the resolved workspace cwd, then read. Add real root-symlink and intermediate-symlink tests for both implementations.

2. **Blocker — A denied frozen import remains authorized while a sibling approval is parked.**  
   [acp-interactions.ts:365](/home/mahmoud/code/agenta-2/services/runner/src/engines/sandbox_agent/acp-interactions.ts:365), [run-turn.ts:925](/home/mahmoud/code/agenta-2/services/runner/src/engines/sandbox_agent/run-turn.ts:925), [run-turn.ts:1184](/home/mahmoud/code/agenta-2/services/runner/src/engines/sandbox_agent/run-turn.ts:1184)

   Both denial paths mark the tool call denied but never call `commitAuthorization.store.discardAll(toolCallId)`. The finalizer retains the entire authorization store whenever any sibling approval remains parked. A forged relay execution carrying the denied call’s exact ID and arguments can therefore consume the still-live record and commit the exact content the human rejected.

   **Fix:** Synchronously discard the denied call’s complete record set before replying to the harness, in both normal ACP and live-resume denial paths. Add a two-gate test: deny one, carry the other, then prove a forged execution for the denied call fails authorization.

3. **Blocker — Live reconciliation records new configuration as applied while reinstalling the old configuration.**  
   [apply-plan.ts:80](/home/mahmoud/code/agenta-2/services/runner/src/environment/apply-plan.ts:80), [apply-plan.ts:109](/home/mahmoud/code/agenta-2/services/runner/src/environment/apply-plan.ts:109), [apply-plan.ts:149](/home/mahmoud/code/agenta-2/services/runner/src/environment/apply-plan.ts:149), [environment.ts:894](/home/mahmoud/code/agenta-2/services/runner/src/engines/sandbox_agent/environment.ts:894)

   Workspace refresh uses `env.plan`’s old instructions and skills, not the incoming request. Session reopen uses a closure capturing the original `sessionInit`, plan, MCP servers and harness configuration. `env.plan` is never replaced. Nevertheless, `commitApplied` records the incoming request’s fingerprint and facets.

   This can leave removed tools callable, removed MCP servers connected, tightened permissions unapplied, and stale skills readable—while subsequent turns believe the new configuration is installed and stop reconciling it.

   **Fix:** Until there is a real desired-plan installer, rebuild for every changed facet except model changes and proven credential rotation. Otherwise construct a new `RunPlan`, workspace payload, session initialization, MCP list and tool catalog from the incoming request, install them, and atomically replace the environment’s captured plan only after success. Tests must assert actual files, MCP servers, permission files and relay tool specs, not just action selection and applied-state digests.

4. **Blocker — Build mode allows imported content to be approved without showing the frozen content or diff.**  
   [ApprovalDock.tsx:229](/home/mahmoud/code/agenta-2/web/oss/src/components/AgentChatSlice/components/ApprovalDock.tsx:229), [ApprovalDock.tsx:372](/home/mahmoud/code/agenta-2/web/oss/src/components/AgentChatSlice/components/ApprovalDock.tsx:372)

   Specialized approval bodies are disabled outside maximized Chat mode. Build mode renders only the model-visible payload. The runner-generated manifest is a sibling field and intentionally is not in that payload, so imported bytes, executable bits and diffs disappear while Approve remains available.

   **Fix:** Render `current.manifest` in every UI mode. Either enable the commit renderer in Build mode or append `ApprovedContentManifest` beside the raw payload. Test both live and replayed Build-mode approvals.

5. **Major — DAO lock timeouts are swallowed and returned as successful empty commits.**  
   [dao.py:1569](/home/mahmoud/code/agenta-2/api/oss/src/dbs/postgres/git/dao.py:1569), [dao.py:1627](/home/mahmoud/code/agenta-2/api/oss/src/dbs/postgres/git/dao.py:1627), [service.py:2048](/home/mahmoud/code/agenta-2/api/oss/src/core/workflows/service.py:2048), [router.py:1637](/home/mahmoud/code/agenta-2/api/oss/src/apis/fastapi/workflows/router.py:1637)

   `commit_revision` excludes only revision-conflict exceptions from generic suppression. PostgreSQL’s lock-timeout exception is consequently converted to `None`; the service wraps that as `status="committed"`, and the router invalidates cache and returns a committed response with `count: 0`. The contract requires a retryable 503.

   **Fix:** Detect SQLSTATE `55P03`, translate it into an explicit commit-lock-timeout exception, exclude it from suppression, and map it to HTTP 503. Add an endpoint integration test holding the variant lock beyond the configured timeout.

6. **Major — The checked commit is not the atomic checked transaction required by the contract.**  
   [service.py:2020](/home/mahmoud/code/agenta-2/api/oss/src/core/workflows/service.py:2020), [service.py:2085](/home/mahmoud/code/agenta-2/api/oss/src/core/workflows/service.py:2085), [service.py:2200](/home/mahmoud/code/agenta-2/api/oss/src/core/workflows/service.py:2200), [dao.py:1658](/home/mahmoud/code/agenta-2/api/oss/src/dbs/postgres/git/dao.py:1658)

   Delta application and no-change detection happen before the lock. A stale caller whose operation resolves to no change receives `200 no_change` without the locked head comparison and can miss a concurrent head change. Equality is also evaluated before snippet normalization, schema enrichment and inferred flags; full-data commits skip no-change comparison entirely.

   **Fix:** Implement the contract’s checked DAO sibling/build callback: lock the variant, re-read and validate the base, synchronously build/validate/normalize/enrich/infer flags, compare canonical persisted `{data, flags}`, then insert or return no-change in the same transaction.

7. **Major — UTF-8 validation accepts malformed byte sequences and silently changes imported content.**  
   [workspace-reader.ts:76](/home/mahmoud/code/agenta-2/services/runner/src/tools/workspace-reader.ts:76)

   Invalid UTF-8 is rejected only when decoded text contains `U+FFFD` and the input contains no `0xEF` byte. An invalid sequence containing `0xEF` bypasses the check, is decoded with replacement characters, and is then digested after transformation.

   **Fix:** Decode using `new TextDecoder("utf-8", {fatal: true})`, then perform the NUL check. Test malformed sequences beginning with `0xEF` and valid text mixed with malformed bytes.

8. **Major — Cold approval resume consumes the stale approval before failing authorization instead of immediately issuing a new gate.**  
   [responder.ts:316](/home/mahmoud/code/agenta-2/services/runner/src/responder.ts:316), [permission-plan.ts:146](/home/mahmoud/code/agenta-2/services/runner/src/permission-plan.ts:146), [commit-authorization.ts:368](/home/mahmoud/code/agenta-2/services/runner/src/tools/commit-authorization.ts:368)

   A cold environment has no frozen authorization records, but the replayed gate still consumes the inbound stored `allow` decision and replies allow to the harness. Execution then fails with `authorization_missing`. The contract requires ignoring that stale answer, resolving the file again and presenting a fresh approval immediately.

   **Fix:** Make cold replay marker-aware: an old approval must not answer a newly resolved marker gate. Mint new frozen records and return `pendingApproval`. Add end-to-end cold-resume tests through both ACP gating and relay authorization.

9. **Major — Explicit ordered `set` operations with `value: null` are converted into missing-value errors.**  
   [dtos.py:302](/home/mahmoud/code/agenta-2/api/oss/src/core/workflows/dtos.py:302), [service.py:2310](/home/mahmoud/code/agenta-2/api/oss/src/core/workflows/service.py:2310), [change_set.py:864](/home/mahmoud/code/agenta-2/api/oss/src/core/workflows/change_set.py:864)

   `value` is optional, but operations are dumped with `exclude_none=True`. An explicitly supplied JSON null disappears before the engine, which then reports `missing_operation_value`. The contract says null is a valid value.

   **Fix:** Serialize using presence semantics—such as `exclude_unset=True`—so explicit null is preserved while an omitted field remains absent. Test this through the HTTP boundary.

10. **Major — The API silently accepts mixed delta forms and can persist unresolved file markers through the legacy arm.**  
    [dtos.py:330](/home/mahmoud/code/agenta-2/api/oss/src/core/workflows/dtos.py:330), [service.py:2235](/home/mahmoud/code/agenta-2/api/oss/src/core/workflows/service.py:2235)

    `WorkflowRevisionDelta` has no closed-form validator. If `operations` is present, `set` and `remove` are silently ignored instead of rejecting the mixed form. Legacy `set` is deep-merged directly, bypassing the engine’s unresolved `@ag.file` rejection.

    **Fix:** Forbid unknown fields and validate that exactly one delta form is used. Route the legacy form through the shared change-set validation boundary, or explicitly run marker rejection before merging. Test mixed forms, unknown keys and legacy unresolved markers.

11. **Major — Nested keyed-list uniqueness checks alias collections belonging to different parent items.**  
    [change_set.py:1125](/home/mahmoud/code/agenta-2/api/oss/src/core/workflows/change_set.py:1125), [change_set.py:1137](/home/mahmoud/code/agenta-2/api/oss/src/core/workflows/change_set.py:1137), [change_set.py:1163](/home/mahmoud/code/agenta-2/api/oss/src/core/workflows/change_set.py:1163)

    Selector paths retain only the list name, not the selected parent key. Collection traversal likewise walks list entries without extending the path, causing later siblings to overwrite earlier ones. With multiple skills containing nested `files` lists, the engine can reject duplicates in an untouched skill or accept duplicates in the touched skill, depending on sibling order.

    **Fix:** Represent paths with structured selector identity, including each keyed parent’s list name and item key. Add tests with several skills where different `files` collections contain different duplicate states.

12. **Major — The specialized approval card shows the persisted commit message as intent and drops the actual per-call description.**  
    [CommitRevisionApproval.tsx:24](/home/mahmoud/code/agenta-2/web/oss/src/components/AgentChatSlice/components/approvals/CommitRevisionApproval.tsx:24)

    The card reads `input.workflow_revision.message`. The contract places agent-stated intent in outer `input.description` and requires presenting it explicitly as model-authored intent beside the real diff. When preview generation succeeds, the raw fallback is hidden, so the actual description is never visible.

    **Fix:** Read and label `input.description` as agent-stated intent. Keep `workflow_revision.message` separately if useful, without presenting it as factual intent. Test with a production-shaped payload containing distinct description and message values.

## DAO lane: CTO structural concerns

- **The lock is opt-in, not a GitDAO-wide serialization invariant.** [dao.py:1615](/home/mahmoud/code/agenta-2/api/oss/src/dbs/postgres/git/dao.py:1615) locks only calls carrying `initial` or `expected_head_revision_id`. Unchecked `commit_revision` callers and `create_revision` do not participate. A dedicated checked primitive would communicate this boundary more safely than optional parameters on the shared method.

- **Head membership can change outside the variant lock.** [dao.py:1223](/home/mahmoud/code/agenta-2/api/oss/src/dbs/postgres/git/dao.py:1223) and [dao.py:1265](/home/mahmoud/code/agenta-2/api/oss/src/dbs/postgres/git/dao.py:1265) archive/unarchive revisions without taking the variant lock, even though `deleted_at` determines the active head. If the invariant is “serialize changes to a variant head,” these paths must participate or be explicitly excluded with a proven concurrency argument.

- **The variant lock query does not verify that it locked a row.** [dao.py:1634](/home/mahmoud/code/agenta-2/api/oss/src/dbs/postgres/git/dao.py:1634) ignores the query result. A missing or cross-project variant therefore proceeds unlocked until a later failure, which generic suppression can turn into `None`. Require exactly one variant row before continuing.

- **The serialized unit ends before version bookkeeping.** [dao.py:1692](/home/mahmoud/code/agenta-2/api/oss/src/dbs/postgres/git/dao.py:1692) explicitly commits and releases the lock before `_get_version`, `_set_version`, and version-zero normalization. If version assignment is part of the revision invariant, it belongs inside the same transaction.

I found no additional confirmed defect in the sampled credential-delivery port, relay call-before-execute hook, strict catalog serialization, or Vercel SSE conversion.
