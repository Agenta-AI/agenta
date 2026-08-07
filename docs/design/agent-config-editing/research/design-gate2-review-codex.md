# Verdict: NO-GO

The contracts substantially improve the design, but they do not clear the second gate. Item 1 is resolved. Items 2 through 6 remain partial. Item 7 was not done. Item 8 is only partially done.

The live-code premises from the first review were correct. The remaining blockers are in the contracts themselves.

## Gate items 1 through 8

| Item | Status | Assessment |
|---|---|---|
| 1. Authoritative change-set contract | **RESOLVED** | [change-set.md §2-12](/home/mahmoud/code/agenta-2/docs/design/agent-config-editing/contracts/change-set.md:25) settles the envelope, two delta forms, target grammar, seven operations, `value_from`, `match_mode`, parent creation, overlap counting, warnings, unique-name behavior, scope, validation, and errors. §12 accurately lists prototype deviations. Product call 2 can still change the unique-name rule, but the original contradictions are gone. |
| 2. Atomic commit and no-change response | **PARTIAL** | [commit-transaction.md §3, §6, §7, §9](/home/mahmoud/code/agenta-2/docs/design/agent-config-editing/contracts/commit-transaction.md:50) correctly specifies lock, stale-base precedence, response shape, and no events or invalidation. Two correctness gaps remain: §4 omits the existing non-embeddable-reference check, and §5 claims flags are canonicalized while its algorithm compares only `data`. |
| 3. `read_config`, draft behavior, scope, description | **PARTIAL** | [read-config.md §3-12](/home/mahmoud/code/agenta-2/docs/design/agent-config-editing/contracts/read-config.md:47) provides most of the missing contract. It cannot implement its own draft response, however: the catalog binds only `workflow_variant_id`; no draft flag or run revision reaches the endpoint. It also contradicts itself about draft commits: §4 tells the model to copy `base_revision_id`, while §10 says the runner fills it “from the read” without defining state for that. Calls 10 and 11 also leave the security scope unfinished. |
| 4. Single-use execution authorization | **PARTIAL** | [execution-authorization.md §2-7](/home/mahmoud/code/agenta-2/docs/design/agent-config-editing/contracts/execution-authorization.md:34) has the right record, lifecycle, frozen store, expiry, and cold-resume policy. But §2.3 reuses a serializer that deliberately treats a JSON-looking string as an object or array. That is not an exact argument binding and permits digest collisions between semantically different arguments. Multi-source calls also lack atomic verify-and-consume semantics. |
| 5. Safe, lossless workspace import | **PARTIAL** | [workspace-import.md §2-10](/home/mahmoud/code/agenta-2/docs/design/agent-config-editing/contracts/workspace-import.md:21) resolves the default policy, limits, manifest, executable handling, and Daytona framing. Its local confinement claim is false: `O_NOFOLLOW` protects only the final path component, not a replaced intermediate directory. Its Daytona root check is also self-contradictory: §2 requires a named folder below `imports/`, but §6.2 requires that folder’s real path to equal the `imports/` root. That would reject every valid import. |
| 6. Applied-generation lifecycle invariant | **PARTIAL** | [adapter-matrix.md §1-8](/home/mahmoud/code/agenta-2/docs/design/agent-config-editing/contracts/adapter-matrix.md:10) restores acknowledgement, generation coupling, transport-specific capability lookup, Pi execution revocation, and continuity verification. But the proposed Pi acknowledgement is another record in the sandbox-writable relay directory. It is forgeable under the same threat model that motivated the authorization contract. The generation inputs are also undefined for execution-plan-only changes. |
| 7. Rewrite the slice plan | **UNRESOLVED** | [plan.md §Phase 2](/home/mahmoud/code/agenta-2/docs/design/agent-config-editing/plan.md:33) is unchanged. It still claims disjoint tracks, still combines engine and transaction work in slice 1, all `value_from` work in slice 3, and lifecycle steps 5-8 in slice 7. It still omits lifecycle step 9. The contracts themselves say the plan still needs updating. |
| 8. Rollout and test gates | **PARTIAL** | The contracts now specify most requested tests: two-writer races, no-change races, forged calls, Daytona import cases, real harness behavior, and failed reconciliation. Missing are the mixed-version API/SDK/catalog/runner deployment order, a concrete kill switch, and a compatibility path for legacy DTOs when `extra="forbid"` starts rejecting previously ignored fields. These are still absent from `plan.md`. |

## Live-code verification

The contracts’ original code claims check out:

- [service.py](/home/mahmoud/code/agenta-2/api/oss/src/core/workflows/service.py:1852) resolves the delta before DAO insertion. It also performs `_reject_non_embeddable_workflow_embeds` at [service.py](/home/mahmoud/code/agenta-2/api/oss/src/core/workflows/service.py:1884), which the new transaction pseudocode omits.
- [dao.py](/home/mahmoud/code/agenta-2/api/oss/src/dbs/postgres/git/dao.py:1565) opens its own transaction and suppresses all but `InitialRevisionConflict`. The existing row lock is initial-only at [dao.py](/home/mahmoud/code/agenta-2/api/oss/src/dbs/postgres/git/dao.py:1606). Version calculation and storage currently happen in further sessions.
- [relay-guard.ts](/home/mahmoud/code/agenta-2/services/runner/src/engines/sandbox_agent/relay-guard.ts:14) explicitly passes non-Pi `ask` calls without a runner grant.
- [server.ts](/home/mahmoud/code/agenta-2/services/runner/src/server.ts:856) really falls back cold on approval mismatch, empty decisions, and resume failure.
- [run-turn.ts](/home/mahmoud/code/agenta-2/services/runner/src/engines/sandbox_agent/run-turn.ts:822) mixes acquire-time `plan.tools.toolSpecs` with incoming callback/context.
- [environment.ts](/home/mahmoud/code/agenta-2/services/runner/src/engines/sandbox_agent/environment.ts:1061) treats matching session IDs as proof of continuity.

## New blocking problems

1. **`argsDigest` is not an exact digest.**  
   [execution-authorization.md §2.3](/home/mahmoud/code/agenta-2/docs/design/agent-config-editing/contracts/execution-authorization.md:71) mandates the existing `canonicalJson`. Its `normalizeJsonish` behavior in [responder.ts](/home/mahmoud/code/agenta-2/services/runner/src/responder.ts:124) makes these hash identically:

   ```json
   {"value": "{\"x\":1}"}
   {"value": {"x": 1}}
   ```

   Ordered-operation `value` fields are arbitrary JSON, so this is a real same-ID argument-substitution hole. Authorization needs a strict canonical JSON serializer that preserves JSON types and performs no replay normalization.

2. **Authorization for a multi-source commit is underspecified.**  
   One commit may resolve eight sources, but §3.2 and §3.3 verify and delete one authorization at a time. The runner must verify every required record, then consume the complete set atomically, then substitute all frozen values. A denied permission verdict must stop before any workspace read.

3. **The local TOCTOU protection does not work as claimed.**  
   `fs.opendir` plus `open(path, O_NOFOLLOW)` is not an `openat`-style walk. Replacing an intermediate directory with a symlink can redirect the final open outside the import root. The contract needs a real fd-relative traversal, a trusted snapshot helper, or an explicitly weaker threat model.

4. **The Daytona confinement test is both incorrect and still raceable.**  
   [workspace-import.md §6.2](/home/mahmoud/code/agenta-2/docs/design/agent-config-editing/contracts/workspace-import.md:257) must test “descendant of resolved import root,” not equality. The two manifest passes also cannot prevent a symlink or same-size content from being swapped in for the read and swapped back before verification. Under an adversarial-sandbox threat model, this is not an adequate snapshot.

5. **`read_config` cannot compute `is_draft`.**  
   [read-config.md §2](/home/mahmoud/code/agenta-2/docs/design/agent-config-editing/contracts/read-config.md:22) binds only the variant ID. The SDK knows `workflow.is_draft`, but that information never reaches the new endpoint. Add a hidden run-context binding or remove the draft claim.

6. **Commit equality is defined over the wrong persisted payload.**  
   [commit-transaction.md §4-5](/home/mahmoud/code/agenta-2/docs/design/agent-config-editing/contracts/commit-transaction.md:112) computes `flags`, then canonicalizes only `data`. Flags are stored separately. Canonical equality must cover every persisted behavior-bearing field, and the checked build must retain `_reject_non_embeddable_workflow_embeds`.

7. **The lifecycle acknowledgement channel is untrusted.**  
   [adapter-matrix.md §4.3](/home/mahmoud/code/agenta-2/docs/design/agent-config-editing/contracts/adapter-matrix.md:198) puts Pi acknowledgements in the sandbox-writable relay directory. A forged acknowledgement can advance applied state. It needs a trusted response channel or authentication unavailable to arbitrary sandbox processes.

8. **Generation semantics are incomplete.**  
   `catalogGeneration` changes when the model-visible catalog changes, but authorizations also depend on execution-plan semantics such as permission, context binding, dispatch target, and timeout. Define the canonical generation payload, including stable execution semantics while excluding rotating credentials.

9. **The approval manifest cannot describe every allowed operation.**  
   `change-set.md` permits `value_from` on `set`, but [workspace-import.md §8](/home/mahmoud/code/agenta-2/docs/design/agent-config-editing/contracts/workspace-import.md:360) supports only add/replace intent and skill-centric diffs. Either disallow `set + value_from` or define its target constraints and approval presentation.

10. **The interface-role pass found a policy conflation.**  
    `value_from` mixes source routing (`type`, `path`) with import policy, and `allow_executable_files` simultaneously acts as an import grant and a persisted skill runtime capability. Those are different owners and lifecycles. Separate import policy from the stored skill capability, or explicitly define why one model-authored value controls both.

11. **`decisions.md` is internally stale.**  
    Its contract-phase section says designated-root, reject-by-default, and cold reapproval were adopted. Its “open” calls 5, 6, and 9 still propose or question the opposite. Calls 4 and 8 are the same decision. The file currently lists 12 calls but only 11 distinct questions.

## Product calls

No product call prevents an isolated engine-helper or lifecycle-extraction PR. The following do block their affected implementation slices:

| Call | Classification |
|---|---|
| 1. Storage normalization | **Blocks engine and transaction work.** It changes exact matching, stored bytes, canonical equality, and migration behavior. |
| 2. Unique-name enforcement | **Blocks engine validation.** It changes which legacy configurations remain committable. |
| 3. Embedded skills | Can be answered during implementation. The v1 unaddressable behavior is isolated and later support can be additive. |
| 4. Ungated `value_from` | **Blocks authorization enablement.** This is one decision together with call 8. It does not block the pure codec. |
| 5. Binary files | Does not block. The contract has already chosen reject-by-default with explicit omission. Remove it from the open list. |
| 6. Workspace reach | Does not block as a product call. The contract chose `imports/`. The technical confinement design still blocks. |
| 7. Pi hidden removal | Can be answered during implementation. The safe fallback is restart; hidden-only must never ship without execution-plan revocation. |
| 8. Force every import gate | Duplicate of call 4. Resolve once before authorization integration. |
| 9. Cold resume | Does not block. The contract chose fail-closed reapproval. Durable persistence can be a later optimization. |
| 10. `harness.kind` | **Blocks editable-scope enablement.** This is an identity and rebuild boundary. |
| 11. Parameters outside `agent` | **Blocks editable-scope enablement.** The current contract allows more than the recommendation. |
| 12. Store authored operations | **Blocks commit persistence design.** Decide before landing the transaction wrapper, or accept an immediate schema migration and missing audit history. |

The six independent blocking decisions are 1, 2, 4/8, 10, 11, and 12.

There is no GO resequencing to mandate. Item 7 itself remains unresolved, so the next gate should review an actually rewritten plan alongside corrected contracts.
