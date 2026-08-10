# Verdict

**NO-GO. Do not start implementation from the current documents.**

The ordered change-set core is viable. The design around it is not final. The largest blockers are:

- `value_from` approval is not secure against the existing forged-relay path.
- The atomic commit and no-change response contracts are unspecified.
- `read_config`, draft behavior, and the builder tool’s editable scope remain undecided.
- The revised lifecycle matrix lacks an applied-generation acknowledgement.
- The slice plan understates dependencies and combines several high-risk migrations.

The prototype test counts do not clear this gate. Both prototypes predate several accepted amendments, and the runner prototype does not integrate with approval, relay, parking, or Daytona.

# Must fix before code

1. **Produce one authoritative change-set contract.**

   [decisions.md](/home/mahmoud/code/agenta-2/docs/design/agent-config-editing/decisions.md:8) accepts D33, which says the engine has no warning channel, then says the engine returns warnings. The interface allows `value_from` only on `set`, `add_item`, and `replace_item,` while the prototype also allows `merge` ([change_set.py](/home/mahmoud/code/agenta-2/.claude/worktrees/agent-a2a2adaa5d154d454/api/oss/src/core/workflows/change_set.py:102)). `match_mode` and parent creation are absent from the prototype.

   Update [change-set-interface-codex.md](/home/mahmoud/code/agenta-2/docs/design/agent-config-editing/research/change-set-interface-codex.md:128), [engine-spike.md](/home/mahmoud/code/agenta-2/docs/design/agent-config-editing/spikes/engine-spike.md:73), and `decisions.md` with exact schemas and semantics.

2. **Specify the atomic commit transaction and the no-change wire response.**

   The design must say how one transaction locks the variant, reads the head, checks `base_revision_id`, applies and validates the change, compares the persisted canonical data, and inserts or returns the existing head. Today service resolution and DAO insertion are separate transactions.

   A warning plus “head id” is not compatible with the existing `WorkflowRevisionResponse`, which expects a complete revision and drives playground refreshes ([models.py](/home/mahmoud/code/agenta-2/api/oss/src/apis/fastapi/workflows/models.py:387), [stream.py](/home/mahmoud/code/agenta-2/sdks/python/agenta/sdk/agents/adapters/vercel/stream.py:838)). Define:

   - 409 precedence over no-change, even if a stale operation happens to equal the new head.
   - Validation and canonicalization before equality comparison.
   - A typed response such as `status: committed | no_change`, the complete current revision, and structured warnings.
   - No commit event or cache invalidation on no-change.

   Update the interface spec and [plan.md](/home/mahmoud/code/agenta-2/docs/design/agent-config-editing/plan.md:40).

3. **Design `read_config`, draft behavior, editable scope, and `description` before their slices start.**

   Slice 2 is currently one sentence. The RFC still leaves the draft base and editable configuration scope open ([rfc.html](/home/mahmoud/code/agenta-2/docs/design/agent-config-editing/research/rfc.html:1030)). These are blockers:

   - A draft run can read the committed head while executing unsaved browser changes.
   - The prototype’s commit policy is `allow_all`, which conflicts with R7’s server-owned-field protection.
   - Partial-read addressing, output limits, exact-byte behavior, stale-head reads, and error shapes are undefined.
   - R12 does not say where `description` lives or distinguish ephemeral call description from persisted revision description/message.

   Add a dedicated contract document and update `decisions.md`, `plan.md`, and the RFC.

4. **Replace the `toolCallId` cache with a single-use execution authorization.**

   A frozen entry must bind at least:

   - Tool name.
   - Tool-call id.
   - Canonical original arguments or their digest.
   - Frozen value and full-content digest.
   - Tool-catalog generation.
   - Expiry and consumed state.

   A missing entry for a gated call must fail closed. It must never trigger inline rereading. The existing non-Pi relay guard explicitly permits forged `ask` records ([relay-guard.ts](/home/mahmoud/code/agenta-2/.claude/worktrees/agent-ab45c024d7ac4f4ab/services/runner/src/engines/sandbox_agent/relay-guard.ts:14)). Therefore the proposed cache-miss fallback is exploitable.

   Update [runner-spike.md](/home/mahmoud/code/agenta-2/docs/design/agent-config-editing/spikes/runner-spike.md:112), `decisions.md`, and `plan.md`.

5. **Make the workspace import boundary safe and lossless by default.**

   The current prototype:

   - Derives `allow_executable_files` from mode bits, converting a filesystem fact into a policy grant ([skill-codec.ts](/home/mahmoud/code/agenta-2/.claude/worktrees/agent-ab45c024d7ac4f4ab/services/runner/src/tools/skill-codec.ts:500)).
   - Drops binary and oversized files while still committing a partial skill.
   - Uses separate realpath, stat, and read calls, leaving a symlink/content TOCTOU window.
   - Returns counts but not the promised manifest, per-file sizes/digests, or diff ([value-from.ts](/home/mahmoud/code/agenta-2/.claude/worktrees/agent-ab45c024d7ac4f4ab/services/runner/src/tools/value-from.ts:34)).
   - Has no Daytona implementation.

   Use a designated import root, reject unsupported files by default, keep executable permission explicit and default-deny, snapshot the bytes atomically enough for the threat model, and digest the bytes actually executed. Define safe Daytona filename framing, timeouts, cancellation, aggregate memory limits, and cleanup.

6. **Restore the lifecycle design’s applied-state invariant in the revised matrix.**

   Apply-live is acceptable only when the adapter can acknowledge generation N. Emitting a Pi hook or Claude notification does not prove the model installed the new catalog. The runner must not advance applied state until it has an acknowledgement or must fall back to reopen.

   Also require one generation across the model-visible catalog and the turn execution plan. Removing `customTools` from the fingerprint before that is a stale-tool bug. The current turn still reads execution specs from environment state ([runner-lifecycle-codex.md](/home/mahmoud/code/agenta-2/docs/design/agent-config-editing/research/runner-lifecycle-codex.md:372)).

   Update `decisions.md`, [runner-lifecycle-codex.md](/home/mahmoud/code/agenta-2/docs/design/agent-config-editing/research/runner-lifecycle-codex.md:230), and `plan.md`.

7. **Rewrite the slice plan.**

   The claim that slices 1 to 4 and 5 to 7 touch disjoint files is false. Slice 3 changes runner approval, relay, parked state, workspace I/O, and frontend code, overlapping slices 5 to 7.

   At minimum:

   - Do not expose ordered commits until `read_config` and retry behavior exist.
   - Split slice 1 into pure engine/schema and transactional wrapper/catalog enablement.
   - Split slice 3 into source codec, authorization/freeze integration, and approval UI.
   - Split slice 7 into lifecycle extraction, low-risk workspace/model routes, tool-catalog routes, MCP reopen/continuity, and credential/provider reconciliation.
   - Add lifecycle step 9. “Daytona keys never rebuild” requires the Daytona creation-identity split that [plan.md](/home/mahmoud/code/agenta-2/docs/design/agent-config-editing/plan.md:46) currently omits.

8. **Add rollout and test gates, not only per-slice unit tests.**

   Update `plan.md` with:

   - Mixed-version API, SDK, catalog, and runner deployment order plus a kill switch.
   - Legacy DTO compatibility. Applying `extra="forbid"` to legacy deltas changes previously ignored input.
   - A two-writer database race test proving one commit and one 409.
   - No-change versus concurrent-head tests.
   - Golden schemas for canonical tool identity across Python and TypeScript.
   - Local and Daytona `value_from` tests covering mutation after approval, forged records, same-id argument substitution, timeout, denial, TTL expiry, cold resume, symlink races, and memory limits.
   - Real per-version harness tests for add, replace, remove, reopen, and native-history preservation.
   - Partial-reconciliation tests proving applied state never advances after a failed action.

# Answers to the six questions

## 1. Do the amendments hold?

1. **Set auto-creates object parents:** Conditionally yes, but the contract is underspecified. Create only missing plain-string segments as `{}`. Never create through a selector. Existing scalar, list, or null parents must fail. Final validation remains mandatory. The stated “two operations” rationale is incorrect because the caller could set the absent bag as one object, though parent creation is still useful for narrow edits.

2. **Overlap-aware counting:** Yes. `"aa"` in `"aaa"` is ambiguous and must return `text_not_unique`. Add complexity limits and tests. The current prototype still uses non-overlapping `str.count` ([change_set.py](/home/mahmoud/code/agenta-2/.claude/worktrees/agent-a2a2adaa5d154d454/api/oss/src/core/workflows/change_set.py:481)).

3. **`match_mode` from day one:** Not as a required field. Adding an optional field later is already additive. If retained now, make it optional with default `exact`, validate `Literal["exact"]`, and make the engine dispatch it explicitly rather than ignore it.

4. **No-change warning instead of revision:** The policy is correct. The response and transaction design are not. Return the complete current revision with an explicit no-change status and structured warning. Validate first, compare canonical persisted data, let stale-base 409 win, and emit no revision event.

## 2. Holes in `value_from`

Yes, four major ones:

1. **Forged records:** `toolCallId` is correlation, not authorization. A forged non-Pi `ask` relay record currently passes. Bind and consume an exact execution authorization.

2. **Double resolution:** Cache miss cannot mean “ungated.” For an `ask` call it must fail closed. Inline resolution is allowed only after the permission plan explicitly classifies the call as ungated/allowed.

3. **Timeout and resource cleanup:** Resolution needs an abort signal, hard deadline, per-turn byte/source/gate limits, and cleanup on deny, expiry, eviction, failure, or cancellation.

4. **Park and cold resume:** Live resume may retain the frozen value in `ParkedApproval`, separately from raw model args. Cold fallback must not reuse an approval keyed only to the same path. Either preserve the exact snapshot across the transition or invalidate the approval and raise a new gate. The current server deliberately falls back cold after approval mismatch or failure ([server.ts](/home/mahmoud/code/agenta-2/.claude/worktrees/agent-ab45c024d7ac4f4ab/services/runner/src/server.ts:856)).

Do not persist the full materialized value as ordinary tool args. The current interaction path persists args, which would recreate the large-payload problem and unnecessarily duplicate content.

## 3. Does the revised adapter matrix create correctness gaps?

Yes:

- `customTools` cannot leave the fingerprint until catalog reconciliation and the fresh turn execution plan are atomic.
- Pi “hidden” removal must also remove the runner execution binding. Hidden is visibility, not revocation.
- Pi and Claude need generation acknowledgement before applied state advances.
- Claude capability is transport-specific: Daytona stdio may apply live, local HTTP reopens. The capability key must include adapter version and transport/provider.
- Codex reopen must verify native history actually loaded before preserving continuity.
- “MCP servers reopen everywhere” is inaccurate for Pi, which has no MCP client in the tested version. Mark it unsupported or define a real delivery mechanism.
- The runtime lifecycle remains necessary for older adapters, failed live application, provider settings, credentials, and harness files.
- All reconciliation must happen between turns. Never mutate a catalog while an approval-suspended prompt is still in flight.

The original desired-state/applied-state architecture still holds. The spike changes individual routes, not that architecture.

## 4. Slice ordering and size

The ordering misses these dependencies:

- Ordered operations should not become model-visible before `read_config`.
- Legacy base defaulting requires runner work despite slice 1 being described as API/frontend only.
- `value_from` overlaps the approval and parked-state code later refactored in slices 5 to 7.
- Live tool routes depend on fresh per-turn execution plans and generation tracking, not only fingerprint removal.
- Daytona credential refresh depends on the missing provider creation-identity split.

Slices 1, 3, and 7 are too large. Slice 7 is especially unreviewable: it combines structural extraction, deletion-aware workspace refresh, three harness routes, MCP reopen, history continuity, credential delivery, and provider identity.

## 5. The seven product calls

| Call | My answer | Design blocker? |
|---|---|---|
| Storage normalization | Do not normalize every configuration string. Preserve exact bytes in v1; consider narrowly scoped normalization for explicit prose fields later. | No |
| Existing duplicate names | Enforce that a commit introduces no new duplicate and repairs any touched collection; warn on untouched legacy duplicates. Define ancestor/full-data writes explicitly. | **Yes** |
| Embedded skills | Accept unaddressable embeds in v1, but amend R3 and document whole-list fallback. | No, once scope is corrected |
| Ungated `value_from` | Force a gate in v1. Tool permission and workspace-read/persistence capability are different policies. | **Yes, security** |
| Binary files | Reject the whole source unless the caller explicitly opts into omission. Do not silently commit a partial skill. | **Yes, data integrity** |
| Workspace reach | Restrict to a designated import/staging root. A manifest is not sufficient protection against committing secrets. | **Yes, security** |
| Pi removal by hiding | Accept only if the active set becomes exactly desired and the runner rejects execution through the old binding. Otherwise restart the runtime. | Product preference, but the execution invariant is blocking |

There is also an eighth missing call: never derive `allow_executable_files` from file mode bits. Require explicit policy and keep default-deny.

## 6. What is missing entirely?

- A decision for draft runs and unsaved browser edits.
- A builder-tool scope policy protecting URI, schemas, flags, permissions, harness choice, and other server/product-owned fields.
- A complete `read_config` contract.
- A complete R12 `description` contract.
- The database transaction seam needed to perform application validation while holding the head lock.
- Legacy strict-schema migration and mixed-version rollout.
- Capability negotiation and rollback for API/catalog/runner version skew.
- Frozen-content digest and approval truncation semantics.
- Source snapshot/TOCTOU protection.
- Approval-snapshot memory accounting and expiry.
- Cross-language canonical tool-key fixtures.
- Full-data commit and ancestor-operation uniqueness rules.
- Provider-switch eviction and immutable image/snapshot rebuild behavior.
- Shadow-router logging rules that prohibit credential/config-content leakage.
- A decision on storing the authored operations/diff for audit. The RFC promises this, but the plan does not implement or explicitly drop it.
- Real harness and Daytona acceptance tests. Static bundle inspection is not sufficient for apply-live correctness.

# Nice-to-haves

- Add a stable raw key for embedded skills.
- Add a blob `uri` variant for binary skill assets.
- Add Streamable HTTP/SSE to the local Claude shim after v1.
- Revisit Codex apply-live only when the ACP adapter exposes it.
- Add property-based tests for target resolution, operation ordering, and text overlap counting.
- Record per-route reconciliation metrics and generation mismatches so the rollout can fall back before users see stale state.
