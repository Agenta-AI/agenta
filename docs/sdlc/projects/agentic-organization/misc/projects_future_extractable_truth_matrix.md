# Future Extractable Truth Matrix for `docs/sdlc/projects`

## Why this exists

This is **not** a move plan.

For now, the contents of `docs/sdlc/projects/*` should remain in `projects`.

This document answers a narrower question:

- which project folders appear likely to contain material that may later be distilled into canonical docs
- what kind of invariant truth that material might become
- what would need to be validated before any extraction should happen

## Distillation rule

`process`, `system`, and `product` are not topic buckets.

They are canonical homes for **validated, verified, invariant truth**.

That means:

- a PRD is not automatically a product doc
- a QA plan is not automatically a process doc
- a technical spec is not automatically a system doc
- project artifacts stay in `projects` until their durable residue has been explicitly distilled

Even after distillation, the canonical result is still only the **best-effort documentation** of invariant truth.

- `system` docs must stay reconciled with the codebase and actual behavior
- `product` docs must stay reconciled with shipped behavior
- `process` docs must stay reconciled with how work is actually being done

## Matrix

| Project | Potential future target(s) | Candidate invariant residue later | Candidate source docs now | Extraction gate |
|---|---|---|---|---|
| `advanced-auth` | `system`, `product` | Auth realm, identity, session, provider, and access invariants; stable org auth journeys and acceptance rules | `auth.*.specs.md`, `QA.md` | Only after OSS/EE auth behavior is validated end-to-end and project rollout detail is removed |
| `ai-actions` | `system`, `product` | Stable tool-call contract and stable refine-flow UX behavior | `spec.md`, `frontend-spec.md` | Only after the API and UX are shipped and treated as ongoing behavior |
| `align-evaluator-interface` | `system` | Evaluator interface invariants shared across built-in and SDK evaluators | `research.md`, `qa.md` | Only after the interface is implemented, backward compatibility is verified, and transitional notes are removed |
| `annotation-queue-v2` | `product`, `system` | Stable annotation queue user flows plus durable queue/evaluation-entity boundaries | `prd.md`, `rfc-v2.md` | Only after the simplified interface is shipped and the entity model has settled |
| `api-rate-limiting` | `system`, `product` | Throttle model, enforcement architecture, and plan-visible rate-limit behavior | `throttling.*.specs.md`, `QA.md` | Only after policy and enforcement are validated and draft alternatives are removed |
| `best-effort-ingestion` | `system` | OTLP ingest failure-handling and retry/drop invariants | `research.md`, `plan.md` | Only after the ingest behavior is implemented and verified in steady state |
| `chat-interface-rfc` | `product`, `system` | Stable chat-capability contract, discovery rules, and evaluator/testset behavior for chat outputs | `rfc.md` | Only after the behavior is implemented and accepted as the ongoing contract |
| `cleanup-evaluators-endpoints` | `system` | Durable evaluator endpoint surface and post-cleanup API boundaries | `endpoint-analysis.md`, `migration-plan.md` | Only after legacy endpoints are removed and the final surface is stable |
| `commit-loading-stall` | None obvious yet | Possibly a lasting loading/performance invariant if the root cause exposes one | `context.md`, `research.md` | Keep as project memory unless the investigation yields a reusable system constraint |
| `data-retention` | `product`, `system` | Retention policy by plan plus durable retention-job and DB invariants | `data-retention-periods.initial.specs.md` | Only after policy is approved and operational behavior is verified |
| `embeds` | `product`, `system` | Stable reference/embed semantics, resolution rules, and user-visible composition behavior | `EMBEDS_IMPLEMENTATION_SUMMARY.md`, `EMBEDS_COMPLETE.md`, `examples.md` | Only after embed semantics are stable and implementation history is separated from canonical behavior |
| `empty-states` | `product`, `system` | Reused empty-state UX conventions and possibly a stable component contract | `components.md` | Only after the pattern is adopted across surfaces and treated as a design-system invariant |
| `eval-metric-type-filtering` | `product`, `system` | Stable metric-filtering behavior and query semantics | `research.md`, `plan.md` | Only after the filter behavior ships and semantics are verified |
| `events` | `system` | Event bus schema, stream topology, and fan-out invariants | `event-bus.initial.specs.md` | Only after the event model and dispatch architecture are implemented and no longer draft |
| `fern-sdk-update` | `process`, `system` | Reusable SDK generation/update workflow or stable SDK compatibility rules | `plan.md`, `context.md` | Only if this becomes an ongoing regeneration process or stable interface contract |
| `fix-evaluation-workflow-revision-lookup` | `system` | Revision lookup and resolution invariants | `research.md`, `missed-migration-paths.md` | Only after the fixed behavior is canonical and migration detours are removed |
| `folders` | `product`, `system` | Stable folder user behavior plus hierarchy/path/update invariants and API contract | `PRD.md`, `RFC.md` | Only after the behavior survives the legacy-to-artifact transition and bridge notes are removed |
| `gateway-tools` | `product`, `system` | Ongoing tools/connect UX and stable gateway/provider architecture/contracts | `prd-ui-improvements.md`, `implementation-spec.md`, `specs.md`, `CONNECTION_FLOWS.md` | Only after the route/model/provider abstractions are shipped and branch-specific notes are removed |
| `gh-improvements` | `process`, `system` | Reusable container-build standards and GH-image invariants | `dockerfile-gh-improvements.specs.md` | Only after the build pattern is adopted broadly and no longer branch-specific |
| `litellm-client-closed-retry` | `system` | Retry and connection-failure handling invariant for LiteLLM integration | `research.md`, `plan.md` | Keep as project memory unless the workaround becomes accepted long-term behavior |
| `loadables` | `system`, `product` | Loadable model, retrieval semantics, endpoint vocabulary, and durable user-visible retrieval behavior | `loadables.*.md` | Only after terminology and API semantics are validated and draft material is distilled |
| `migrate-evaluator-playground` | `system`, `product` | Evaluator-as-workflow contract and stable playground behavior | `current-system.md`, `new-endpoints.md` | Only after migration completes and current-vs-new comparison material is removed |
| `preview-route-normalization` | `system` | Canonical route policy and normalized mount invariants | `route-matrix.md` | Only after preview-to-canonical migration is complete and final routing policy is clear |
| `railway-preview-environments` | `process`, `system` | Reusable preview-environment lifecycle/runbook and stable deployment invariants | `deployment-notes.md`, `qa.md`, `research.md` | Only after the workflow is stable, automated, and reusable beyond this rollout |
| `sdk-evaluator-metrics-bug` | None obvious yet | Possibly a small metrics-contract invariant if the fix defines one | `backend-fix.md`, `ui-fix.md` | Keep as project memory unless the bug reveals a durable cross-surface metrics contract |
| `snippets` | `product`, `system` | Reusable composition/snippet user semantics and stable compatibility contract | `PRD.md`, `RFC.md` | Only after snippet/embed behavior is shipped and legacy bridge detail is removed |
| `stateless-playground` | `product`, `system` | Stable playground UX behavior and bindings/adapter architecture | `rfc.md`, `api-design.md` | Only after the app/stateless split is shipped and the bindings interface stabilizes |
| `string-comparison-operators` | `product`, `system` | User-visible tracing filter operators and their underlying semantics | `research.md`, `plan.md` | Only after operators ship and the semantics are verified |
| `tags` | `product`, `system` | Stable tag behaviors, use cases, assignment/filter semantics, and API contract | `PRD.md`, `RFC.md` | Only after the API/UI contract is implemented and legacy-specific assumptions are removed |
| `testing` | `process` | Reusable testing strategy, taxonomy, architectural boundaries, and execution guidance | `README.md`, `testing.*.specs.md` | Only after the strategy is validated across interfaces and stripped of initiative/status language |
| `vercel-ai-adapter` | `system`, `product` | Stable adapter contract and supported ingestion behavior | `research.md`, `plan.md` | Only after the integration is shipped and treated as a supported long-term interface |
| `view-improvements` | `product`, `system` | Durable chat-rendering/extraction rules and stable UX behavior | `chat-extraction-algorithm.md`, `research.md` | Only after the behavior is broadly adopted and no longer experimental |
| `webhooks` | `system`, `product` | Delivery architecture, subscription/delivery invariants, and stable user-visible webhook capabilities | `DESIGN.md`, `github.webhooks.specs.md` | Only after the webhook model and extensions are shipped and speculative options are removed |

## Reading the matrix correctly

This matrix does **not** say:

- move these folders now
- split these folders now
- treat these documents as already canonical

It says only:

- these projects may later yield canonical residue
- extraction should happen only after explicit validation and distillation
- until then, the project folder remains the correct home
