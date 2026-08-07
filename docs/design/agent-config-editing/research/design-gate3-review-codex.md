# Third design gate verdict: NO-GO

The design is not convergence-complete. S4 and S5 can start. S1a and S3a cannot.

The team fixed several gate-2 findings correctly, especially the atomic commit contract and multi-source authorization. But five implementation-significant contradictions remain.

## Must-fix findings

1. **Draft `read_config` cannot execute.** The contract binds `target.run_revision_id` even though that value is absent on a draft run ([read-config.md](/home/mahmoud/code/agenta-2/docs/design/agent-config-editing/contracts/read-config.md:33)). Current binding code treats every absent binding as a hard failure ([direct.ts](/home/mahmoud/code/agenta-2/services/runner/src/tools/direct.ts:228)). The cited test only proves that `workflow.is_draft` resolves; it does not prove optional bindings work ([tool-direct.test.ts](/home/mahmoud/code/agenta-2/services/runner/tests/unit/tool-direct.test.ts:308)).

2. **The single-text approval can show the wrong diff.** It compares the new text against the configuration running in the session, which may be revision N, while the model can correctly supply head revision N+1 as `base_revision_id`. The base check then passes and the commit replaces N+1, even though the user approved an N-to-new diff ([workspace-import.md](/home/mahmoud/code/agenta-2/docs/design/agent-config-editing/contracts/workspace-import.md:697)). The old side must come from the exact `base_revision_id`, or the API must validate an approved old-value digest.

3. **The import contract still contradicts itself.**

   - Authorization requires strict canonical serialization, but workspace import still mandates the lenient `canonicalJson` for `contentDigest` ([execution-authorization.md](/home/mahmoud/code/agenta-2/docs/design/agent-config-editing/contracts/execution-authorization.md:71), [workspace-import.md](/home/mahmoud/code/agenta-2/docs/design/agent-config-editing/contracts/workspace-import.md:558)).
   - The item manifest still has the obsolete single `allowExecutableFiles` field rather than the two arbitrated grants ([workspace-import.md](/home/mahmoud/code/agenta-2/docs/design/agent-config-editing/contracts/workspace-import.md:590)).
   - `find -maxdepth 8` cannot report entries below depth 8, so those entries are silently omitted even though the contract says they must reject or appear as omissions ([workspace-import.md](/home/mahmoud/code/agenta-2/docs/design/agent-config-editing/contracts/workspace-import.md:196), [workspace-import.md](/home/mahmoud/code/agenta-2/docs/design/agent-config-editing/contracts/workspace-import.md:412)).
   - The local reader still leaves the native-helper versus weaker-fallback choice to the plan, but the plan does not choose or budget either path.

4. **The generation digest omits behavior-bearing binding sources.** It hashes only binding destination paths, not the source tokens. Changing a binding from `$ctx.workflow.variant.id` to another context value at the same destination changes the executed arguments but not the generation ([adapter-matrix.md](/home/mahmoud/code/agenta-2/docs/design/agent-config-editing/contracts/adapter-matrix.md:127), [adapter-matrix.md](/home/mahmoud/code/agenta-2/docs/design/agent-config-editing/contracts/adapter-matrix.md:184)). Hash the sorted `{destinationPath, sourceToken}` mapping.

5. **Acknowledgement and rollout text still contradict the arbitration.** Section 4.3 forbids the relay directory, but Claude §5.3 and rollout step 3 explicitly use it ([adapter-matrix.md](/home/mahmoud/code/agenta-2/docs/design/agent-config-editing/contracts/adapter-matrix.md:343), [adapter-matrix.md](/home/mahmoud/code/agenta-2/docs/design/agent-config-editing/contracts/adapter-matrix.md:424), [adapter-matrix.md](/home/mahmoud/code/agenta-2/docs/design/agent-config-editing/contracts/adapter-matrix.md:502)). The plan also calls the channel “trusted,” although the arbitration’s entire point is that it is untrusted.

## Gate-2 item rulings

| Item | Ruling | Reason |
|---|---|---|
| 2. Atomic commit and no-change | **RESOLVED** | `commit-transaction.md` §4.1 restores the embed check, and §5.1 compares both persisted `data` and stored `flags`. |
| 3. `read_config`, draft, scope, description | **PARTIAL** | Base ownership and fail-closed scope defaults are specified, but draft dispatch fails on the absent revision binding. |
| 4. Single-use authorization | **PARTIAL** | Exact serializer and atomic multi-source lifecycle are good, but `workspace-import.md` still directs `contentDigest` to the unsafe serializer. |
| 5. Workspace import | **PARTIAL** | The local attack is correctly understood and Daytona’s limitation is honestly described, but the implementation path is unselected, deep files disappear silently, and the accepted Daytona risk is absent from `plan.md`. |
| 6. Applied-generation invariant | **PARTIAL** | Execution-plan coupling and removal revocation are substantially better. Binding-source semantics and acknowledgement-channel consistency remain wrong. |
| 7. Rewrite slice plan | **RESOLVED** | Engine/transaction, import, and lifecycle slices were split, and lifecycle step 9 is included. New plan defects remain below. |
| 8. Rollout and tests | **PARTIAL** | Tests are much stronger. Deployment order and the kill switch are not safe mixed-version contracts. |

## New-problem rulings

| Problem | Ruling | Settlement or remaining gap |
|---|---|---|
| 1. Exact `argsDigest` | **PARTIAL** | Execution authorization §2.3 fixes it, but workspace import §7.2 contradicts the same serializer boundary for `contentDigest`. |
| 2. Multi-source authorization | **RESOLVED** | Execution authorization §3.4 checks policy before reads, verifies the complete set, consumes synchronously, substitutes all values, and cleans up atomically. |
| 3. Local TOCTOU | **PARTIAL** | Workspace import §3.2 specifies the correct descriptor-relative walk, but §3.4 still permits a weaker fallback and the plan chooses neither. |
| 4. Daytona equality and race | **PARTIAL** | Descendant comparison is fixed. The race is now acknowledged, but §6.5 requires the plan to record the accepted risk and it does not. |
| 5. Draft `is_draft` | **UNRESOLVED** | `run_is_draft` resolves, but the additional absent `run_revision_id` binding makes the whole draft call fail. |
| 6. Persisted equality and embed check | **RESOLVED** | Commit transaction §§4.1 and 5.1 settle both. The current code premises were also verified in `service.py` and `dao.py`. |
| 7. Forgeable acknowledgement | **PARTIAL** | The harmless-forgery argument can work, but the channel and rollout sections still instruct implementers to use the relay directory. |
| 8. Generation semantics | **PARTIAL** | Most execution semantics are included, but context-binding source tokens are omitted. |
| 9. Approval coverage for `set + value_from` | **PARTIAL** | The operation and presentation exist, but the displayed old value is not bound to the commit base. |
| 10. Import policy versus stored capability | **PARTIAL** | The four-layer model is directionally correct. The manifest and decisions still use the obsolete field, and the claimed human owner disappears on the ungated explicit-allow path. |
| 11. Stale decisions | **PARTIAL** | The six open calls are deduplicated, but the contract-phase paragraph still names `allow_executable_files` on `value_from` ([decisions.md](/home/mahmoud/code/agenta-2/docs/design/agent-config-editing/decisions.md:50)), and the plan still references old call numbers 12, 10, 11, and 4. |

## Arbitration rulings

1. **Text-file `value_from` on `set`: not accepted as written.** The restricted target set and single-file rule are good. The approval must derive old text from the exact `base_revision_id`, not from the running session. If that value cannot be obtained, fail closed rather than claiming a unified-diff approval.

2. **Four-layer executable split: accept conditionally.** The semantic split is correct: observed bit, import grant, stored capability, platform execution policy. Fix the manifest, stale decisions text, and the incorrect statement that ephemeral `on_executable` is an at-runtime permission. Also decide whether setting the persisted capability always forces approval, independently of generic commit permission.

3. **Harmless-forgery acknowledgement: accept conditionally.** This is a defensible design only while the runner-side execution plan remains authoritative, removals and permission tightening take effect independently of acknowledgement, and acknowledgement affects model visibility only. Rename it as an untrusted best-effort acknowledgement and remove every relay-directory and “trusted channel” reference.

## Plan ruling

The slice cuts meet the narrow gate-2 rewrite requirement, but the plan is not implementation-ready as a whole.

- The table contains **14 slices, not 15**.
- S1a says “blocked by nothing,” while decisions explicitly say storage normalization blocks S1a/S1b ([plan.md](/home/mahmoud/code/agenta-2/docs/design/agent-config-editing/plan.md:46), [decisions.md](/home/mahmoud/code/agenta-2/docs/design/agent-config-editing/decisions.md:102)).
- S1a also includes engine validation work, so unique-name call 2 either blocks it or must be moved explicitly into S1b.
- The catalog ordering rule is correct: ordered operations must not become model-visible before `read_config`.
- API → SDK catalog → runner is not backward-compatible for `value_from`. An old runner will not resolve the source, and the API engine must reject the surviving `value_from`. Use API support dark, then runner support dark, then catalog enablement.
- The kill switch is not concrete enough. Removing the schema does not prevent a stale harness or replayed call from making the runner read a workspace before the API rejects it.
- The plan has no standalone foundation slice for the adapter contract’s required `ToolCatalogManifest`/`ToolExecutionPlan` split and incoming-request wiring before live reconciliation.

## Slice authorization

| Slice | Ruling | Waits for |
|---|---|---|
| S1a | **NO-GO** | Product call 1; likely call 2 unless validation moves to S1b. |
| S1b | **BLOCKED** | Product calls 1, 2, and 6. The plan’s “12” is stale. |
| S2 | **BLOCKED** | Draft optional-binding fix; product calls 4 and 5 unless the fail-closed defaults are formally adopted as final v1 decisions. |
| S3a | **NO-GO** | Strict digest consistency, depth detection, local-reader choice, corrected manifest, and recorded Daytona risk. |
| S3b | **BLOCKED** | Product call 3 plus the generation and authorization consistency fixes. |
| S3c | **BLOCKED** | S3b, base-bound single-text diff, and corrected executable manifest. |
| S4 | **GO** | Independent and adequately specified. |
| S5 | **GO** | Independent lifecycle steps 1–2 only. Do not fold live catalog routing into it. |
| S6–S7b, S7d–S7e | **Dependency-blocked** | Follow their stated lower slices. |
| S7c | **BLOCKED** | Generation mapping fix, acknowledgement contract cleanup, and a separate atomic catalog/execution-plan foundation step. |

So the blunt answer is: **GO for S4 and S5 only. NO-GO for S1a and S3a as currently defined.**
