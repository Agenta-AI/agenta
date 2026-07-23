# Plan

## Strategy

Establish the correct pre-production contract first. Normalize Pi and Claude into that contract,
then carry it through the Python service. Treat service-to-API semantic-convention changes as a
separate approval-gated phase.

## Phase 0: approve semantics and attribution

Before implementation, review and decide:

1. the canonical inclusive token rules and cache/reasoning subcategories;
2. cost provenance names and whether Pi's catalog-derived cost is `calculated`;
3. final versus provisional event vocabulary;
4. the one-owner rule for incremental span usage;
5. the cross-batch parent-summary strategy;
6. whether temporary old-runner/new-service compatibility is necessary.

Exit criterion: runner and service owners approve `interface-design.md`. CTO approval is not
required for the pre-production boundary, but the service-to-API proposal remains gated.

## Phase 1: canonical runner usage model

1. Replace flat `AgentUsage` with typed token, cost, provenance, and context objects.
2. Define internal observations with source, scope, temporality, and final/provisional status.
3. Implement finite, non-negative validation that preserves zero and absence distinctly.
4. Implement one field-level reducer. Remove whole-object Pi-writeback precedence.
5. Separate `context_usage` from final billed `usage` events.
6. Return partial reported usage on cancellation and error where available.

Tests:

- reducer precedence and incomplete observations;
- zero, absent, negative, non-finite, and cost-only cases;
- incremental observations versus repeated cumulative snapshots;
- terminal usage after provisional context updates;
- partial/error runs.

## Phase 2: Pi and Claude normalization

### Pi

1. Normalize uncached input plus cache-read/cache-write into inclusive input.
2. Preserve cache details, output, total, and any reasoning detail.
3. Preserve Pi cost components and mark provenance accurately.
4. Make usage writeback serialize the rich final observation.
5. Merge writeback field by field instead of replacing other sources.

### Claude and ACP

1. Read every final `PromptResponse.usage` field, including cached read/write and explicit total.
2. Map ACP `used/size` only to context utilization.
3. Preserve `cost.amount` and `cost.currency` as a cost snapshot.
4. Ensure repeated cumulative ACP updates replace rather than sum.
5. Document the synthetic run-level LLM span's lack of per-call fidelity.

Tests use captured or package-faithful fixtures for cache-heavy, multi-tool, resumed, cancelled,
and zero-cost runs on local and Daytona paths.

## Phase 3: runner-to-service contract

1. Update `AgentRunResult`, `AgentEvent`, Python `WireAgentUsage`, and typed `AgentResult` usage.
2. Update the SDK catalog schema, generated artifacts if applicable, wire goldens, and drift tests.
3. Decide and document the Vercel compatibility projection. Never expose context occupancy as
   token usage.
4. Update service workflow tracing projection to consume the rich shape without truthy-total
   gating.
5. Update living agent-workflows interface docs:
   - `interfaces/cross-service/runner-to-harness.md`;
   - `interfaces/cross-service/service-to-agent-runner.md`;
   - `interfaces/cross-service/service-and-runner-trace-export.md`.

Exit criterion: the rich result survives runner, streaming and non-streaming transports, Python
parsing, and service handling without information loss.

## Phase 4: prepare trace projection for approval

1. Build pure, tested projection functions from canonical usage to the candidate OTel and Agenta
   attributes without changing exported production spans.
2. Produce before/after fixture traces for leaf attribution, parent summaries, separate OTLP
   batches, cache-heavy usage, and multi-model cost.
3. Classify every candidate field as OTel standard, compatibility alias, or Agenta extension.
4. Present cross-batch summary alternatives and their stored/queryed outcomes.
5. Add the proposed trace-tree expectations to the CTO approval packet.

No export ownership, parent metric, cost attribute, adapter, or API behavior changes in this phase.

## Phase 5: service-to-API semantic convention (CTO approval required)

Prepare the approval packet from `interface-design.md`, including before/after traces and these
decisions:

1. standard OTel token mapping and compatibility aliases;
2. Agenta cost extension, currency, provenance, and component definitions;
3. reported/calculated cost precedence over platform estimates;
4. cache-aware fallback calculation;
5. schema-driven cumulative rollups for cache and reasoning buckets;
6. parent/child attribution and late/separate-batch behavior;
7. query/UI compatibility and reported-versus-estimated presentation.

After approval:

1. change runner/service span projection so incremental usage has one owner;
2. implement the approved cross-batch parent-summary strategy;
3. consolidate GenAI mappings into an authoritative versioned table;
4. preserve explicit producer cost and calculate only missing cost;
5. extend cost calculation for normalized, model-scoped cache buckets when pricing supports them;
6. extend token/cost cumulative rollups;
7. add query presets and UI labels where approved;
8. update the public semantic-convention, cost, and API tracing docs in the same implementation PR.

## Phase 6: end-to-end QA and rollout

1. Replay deterministic Pi and Claude transcripts through runner and Python service tests.
2. Run live cache-heavy Pi and Claude turns against a provider account and compare provider/harness
   raw usage, runner result, stored leaf metrics, and trace totals.
3. Verify streaming and non-streaming parity, local and Daytona parity, continuation/resume, and
   cancelled/error usage.
4. Verify old trace queries still resolve prompt/completion/total compatibility fields.
5. Add observability for rejected usage observations, missing cost, estimation fallback, and trace
   export degradation without logging secrets or prompts.

## PR decomposition

1. Runner internal usage model and reducer.
2. Pi and Claude/ACP adapters plus fixtures.
3. Runner-to-service wire, Python DTO, streaming projection, and living interface docs.
4. Pure trace-projection fixtures and CTO approval packet.
5. Approval-gated trace attribution, API semconv, rollup, cost fallback, UI/query, and public docs.

Keep implementation PRs narrow. The design PR contains no implementation.
