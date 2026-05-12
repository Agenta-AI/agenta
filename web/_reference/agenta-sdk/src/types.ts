/**
 * Agenta TypeScript SDK — Type definitions.
 *
 * Mirrors the API DTOs from:
 *   api/oss/src/core/shared/dtos.py
 *   api/oss/src/core/git/dtos.py
 *   api/oss/src/core/applications/dtos.py
 *   api/oss/src/apis/fastapi/applications/models.py
 *   api/oss/src/apis/fastapi/evaluators/models.py
 *   api/oss/src/apis/fastapi/tracing/models.py
 *   api/oss/src/core/evaluations/types.py
 *   api/oss/src/apis/fastapi/evaluations/models.py
 *   api/oss/src/core/testsets/dtos.py
 *   api/oss/src/apis/fastapi/testsets/models.py
 */

// ─── Primitives ──────────────────────────────────────────────────────────────

/** Arbitrary JSON-safe data. */
export type Data = Record<string, unknown>

/** Reference to an entity by id, slug, and/or version. */
export interface Reference {
    id?: string
    slug?: string
    version?: string
}

/** Cursor-based pagination. */
export interface Windowing {
    newest?: string
    oldest?: string
    next?: string
    limit?: number
    order?: "ascending" | "descending"
    interval?: number
    rate?: number
}

// ─── Query Filtering (used by online evaluations / query entity) ────────────

export type LogicalOperator = "and" | "or" | "not" | "nand" | "nor"

export interface QueryCondition {
    field: string
    key?: string
    value?: unknown
    operator?: string
    options?: Record<string, unknown>
}

export interface QueryFiltering {
    operator?: LogicalOperator
    conditions: (QueryCondition | QueryFiltering)[]
}

export interface QueryRevisionData {
    filtering?: QueryFiltering
    windowing?: Windowing
}

// ─── Query Entity ───────────────────────────────────────────────────────────

export interface SimpleQueryCreate {
    slug: string
    name?: string
    description?: string
    flags?: Record<string, unknown>
    tags?: Record<string, unknown>
    meta?: Record<string, unknown>
    data?: QueryRevisionData
}

export interface SimpleQueryCreateRequest {
    query: SimpleQueryCreate
}

export interface SimpleQueryResponse {
    count: number
    query?: {
        id: string
        slug?: string
        data?: QueryRevisionData
        meta?: Record<string, unknown>
    } | null
}

export interface QueryRevisionRetrieveRequest {
    query_ref?: Reference | null
    query_variant_ref?: Reference | null
    query_revision_ref?: Reference | null
}

export interface QueryRevisionResponse {
    count: number
    query_revision?: {
        id?: string
        slug?: string
        variant_id?: string
        version?: string | number
        data?: QueryRevisionData
    } | null
}

// ─── Webhook / Automation ───────────────────────────────────────────────────

export type WebhookEventType = "environments.revisions.committed" | "webhooks.subscriptions.tested"

export interface WebhookSubscriptionData {
    url: string
    headers?: Record<string, string>
    payload_fields?: Record<string, unknown>
    auth_mode?: "signature" | "authorization"
    event_types?: WebhookEventType[]
}

export interface WebhookSubscription {
    id: string
    slug?: string
    name?: string
    description?: string
    created_at: string
    updated_at: string
    data: WebhookSubscriptionData
    secret?: string
    secret_id?: string
}

export interface WebhookSubscriptionCreateRequest {
    subscription: {
        name?: string
        description?: string
        secret?: string
        data: {
            url: string
            event_types?: WebhookEventType[]
            headers?: Record<string, string>
            payload_fields?: Record<string, unknown>
            auth_mode?: "signature" | "authorization"
        }
    }
}

export interface WebhookSubscriptionEditRequest {
    subscription: {
        id: string
        name?: string
        description?: string
        secret?: string
        data: {
            url: string
            event_types?: WebhookEventType[]
            headers?: Record<string, string>
            payload_fields?: Record<string, unknown>
            auth_mode?: "signature" | "authorization"
        }
    }
}

export type WebhookSubscriptionTestRequest =
    | ({
          subscription_id: string
          subscription?: undefined
      } & Partial<WebhookSubscriptionCreateRequest>)
    | ({subscription_id?: undefined} & WebhookSubscriptionCreateRequest)
    | ({subscription_id?: undefined} & WebhookSubscriptionEditRequest)

export interface WebhookDeliveriesQueryRequest {
    delivery?: {
        subscription_id?: string
        event_id?: string
        status?: {
            code?: string
        }
    }
    include_archived?: boolean
    windowing?: {
        limit?: number
        order?: "ascending" | "descending"
        cursor?: string
    }
}

export interface WebhookSubscriptionResponse {
    count: number
    subscription?: WebhookSubscription
}

export interface WebhookSubscriptionsResponse {
    count: number
    subscriptions: WebhookSubscription[]
}

export interface WebhookDeliveryResponseInfo {
    status_code?: number
    body?: string
}

export interface WebhookDeliveryData {
    event_type?: WebhookEventType
    url: string
    headers?: Record<string, string>
    payload?: Record<string, unknown>
    response?: WebhookDeliveryResponseInfo
    error?: string
}

export interface WebhookDeliveryStatus {
    message?: string
    type?: string
    code?: string
}

export interface WebhookDelivery {
    id: string
    status: WebhookDeliveryStatus
    data?: WebhookDeliveryData
    subscription_id: string
    event_id: string
    created_at: string
    updated_at: string
}

export interface WebhookDeliveryResponse {
    count: number
    delivery?: WebhookDelivery
}

export interface WebhookDeliveriesResponse {
    count: number
    deliveries: WebhookDelivery[]
}

// ─── Automation Form Types (UI-level, not API DTOs) ─────────────────────────

export type AutomationProvider = "webhook" | "github"

export type GitHubDispatchType = "repository_dispatch" | "workflow_dispatch"

interface AutomationFormValuesBase<P extends AutomationProvider = AutomationProvider> {
    provider: P
    name?: string
    event_types?: WebhookEventType[]
}

export interface WebhookFormValues extends AutomationFormValuesBase<"webhook"> {
    url?: string
    headers?: Record<string, string>
    auth_mode?: "signature" | "authorization"
    auth_value?: string
}

export interface GitHubFormValues extends AutomationFormValuesBase<"github"> {
    github_sub_type?: GitHubDispatchType
    github_repo?: string
    github_pat?: string
    github_workflow?: string
    github_branch?: string
}

export type AutomationFormValues = WebhookFormValues | GitHubFormValues

// ─── Shared Mixins (composed into entity types) ──────────────────────────────

export interface Lifecycle {
    created_at?: string
    updated_at?: string
    deleted_at?: string
    created_by_id?: string
    updated_by_id?: string
    deleted_by_id?: string
}

export interface Header {
    name?: string
    description?: string
}

export interface Commit {
    author?: string
    date?: string
    message?: string
}

// ─── Flags ───────────────────────────────────────────────────────────────────

export interface ApplicationFlags {
    is_application?: boolean
    is_evaluator?: boolean
    is_chat?: boolean
    is_single_prompt?: boolean
    is_custom?: boolean
    is_human?: boolean
}

export interface EvaluatorFlags {
    is_application?: boolean
    is_evaluator?: boolean
    is_custom?: boolean
    is_human?: boolean
}

// ─── Application Revision Data ───────────────────────────────────────────────

export interface ApplicationRevisionData {
    uri?: string
    url?: string
    schemas?: {
        parameters?: Record<string, unknown>
        outputs?: Record<string, unknown>
    }
    parameters?: Record<string, unknown>
    [key: string]: unknown
}

// ─── Simple Application ──────────────────────────────────────────────────────

export interface SimpleApplication {
    id?: string
    slug?: string
    name?: string
    description?: string
    /**
     * Per-application metadata. The wire format from the backend is the
     * `Metadata` mixin, which contributes three sibling fields: `flags`,
     * `tags`, and `meta`. The legacy `metadata` field is kept as a deprecated
     * alias for backward compat with consumers that read it; new code should
     * read `meta` and `tags` directly.
     *
     * @deprecated read `meta` and `tags` instead. Will be removed in v0.3.
     */
    metadata?: Record<string, unknown>
    flags?: ApplicationFlags
    tags?: Record<string, unknown>
    meta?: Record<string, unknown>
    data?: ApplicationRevisionData
    variant_id?: string
    revision_id?: string
    created_at?: string
    updated_at?: string
    deleted_at?: string
}

export interface SimpleApplicationCreate {
    slug: string
    name?: string
    description?: string
    metadata?: Record<string, unknown>
    flags?: ApplicationFlags
    data?: ApplicationRevisionData
}

export interface SimpleApplicationEdit {
    id: string
    name?: string
    description?: string
    metadata?: Record<string, unknown>
    flags?: ApplicationFlags
    data?: ApplicationRevisionData
}

export interface SimpleApplicationQuery {
    flags?: Partial<ApplicationFlags>
    metadata?: Record<string, unknown>
}

// ─── Application Revision ────────────────────────────────────────────────────

export interface ApplicationRevision {
    id?: string
    slug?: string
    version?: string
    name?: string
    description?: string
    metadata?: Record<string, unknown>
    flags?: ApplicationFlags
    data?: ApplicationRevisionData
    application_id?: string
    application_variant_id?: string
    created_at?: string
    updated_at?: string
    author?: string
    date?: string
    message?: string
}

export interface ApplicationRevisionCommit {
    slug?: string
    name?: string
    description?: string
    metadata?: Record<string, unknown>
    flags?: ApplicationFlags
    data?: ApplicationRevisionData
    message?: string
    application_id: string
    application_variant_id?: string
    revision_id?: string
}

export interface ApplicationRevisionsLog {
    application_id?: string
    application_variant_id?: string
    application_revision_id?: string
    depth?: number
}

// ─── Simple Evaluator ────────────────────────────────────────────────────────

export interface SimpleEvaluator {
    id?: string
    slug?: string
    name?: string
    description?: string
    metadata?: Record<string, unknown>
    flags?: EvaluatorFlags
    data?: ApplicationRevisionData
    variant_id?: string
    revision_id?: string
    created_at?: string
    updated_at?: string
}

export interface SimpleEvaluatorCreate {
    slug: string
    name?: string
    description?: string
    metadata?: Record<string, unknown>
    flags?: EvaluatorFlags
    data?: ApplicationRevisionData
}

export interface SimpleEvaluatorEdit {
    id: string
    name?: string
    description?: string
    metadata?: Record<string, unknown>
    flags?: EvaluatorFlags
    data?: ApplicationRevisionData
}

export interface SimpleEvaluatorQuery {
    flags?: Partial<EvaluatorFlags>
    metadata?: Record<string, unknown>
}

// ─── Evaluator Revision ──────────────────────────────────────────────────────

export interface EvaluatorRevision {
    id?: string
    slug?: string
    version?: string
    name?: string
    description?: string
    metadata?: Record<string, unknown>
    flags?: EvaluatorFlags
    data?: ApplicationRevisionData
    evaluator_id?: string
    evaluator_variant_id?: string
    created_at?: string
    updated_at?: string
    author?: string
    date?: string
    message?: string
}

export interface EvaluatorRevisionCommit {
    slug?: string
    name?: string
    description?: string
    metadata?: Record<string, unknown>
    flags?: EvaluatorFlags
    data?: ApplicationRevisionData
    message?: string
    evaluator_id: string
    evaluator_variant_id?: string
    revision_id?: string
}

// ─── Tracing ─────────────────────────────────────────────────────────────────

export type Filtering = Record<string, unknown>

// ─── Request shapes ──────────────────────────────────────────────────────────

// Simple Applications
export interface SimpleApplicationCreateRequest {
    application: SimpleApplicationCreate
}

export interface SimpleApplicationEditRequest {
    application: SimpleApplicationEdit
}

export interface SimpleApplicationQueryRequest {
    application?: SimpleApplicationQuery
    application_refs?: Reference[]
    include_archived?: boolean
    windowing?: Windowing
}

// Application Revisions
export interface ApplicationRevisionCommitRequest {
    application_revision_commit: ApplicationRevisionCommit
}

export interface ApplicationRevisionRetrieveRequest {
    application_ref?: Reference
    application_variant_ref?: Reference
    application_revision_ref?: Reference
    environment_ref?: Reference
    environment_variant_ref?: Reference
    environment_revision_ref?: Reference
    key?: string
    resolve?: boolean
}

export interface ApplicationRevisionsLogRequest {
    application: ApplicationRevisionsLog
}

// Evaluators
export interface SimpleEvaluatorCreateRequest {
    evaluator: SimpleEvaluatorCreate
}

export interface SimpleEvaluatorEditRequest {
    evaluator: SimpleEvaluatorEdit
}

export interface SimpleEvaluatorQueryRequest {
    evaluator?: SimpleEvaluatorQuery
    evaluator_refs?: Reference[]
    include_archived?: boolean
    windowing?: Windowing
}

export interface EvaluatorRevisionCommitRequest {
    evaluator_revision_commit: EvaluatorRevisionCommit
}

export interface EvaluatorRevisionRetrieveRequest {
    evaluator_ref?: Reference
    evaluator_variant_ref?: Reference
    evaluator_revision_ref?: Reference
    environment_ref?: Reference
    environment_variant_ref?: Reference
    environment_revision_ref?: Reference
    key?: string
    resolve?: boolean
}

// Tracing
export interface SpansQueryRequest {
    filtering?: Filtering
    windowing?: Windowing
    query_ref?: Reference
    query_variant_ref?: Reference
    query_revision_ref?: Reference
}

export interface TracesQueryRequest {
    filtering?: Filtering
    windowing?: Windowing
    query_ref?: Reference
    query_variant_ref?: Reference
    query_revision_ref?: Reference
}

// ─── Response shapes ─────────────────────────────────────────────────────────

export interface SimpleApplicationResponse {
    count: number
    application?: SimpleApplication
}

export interface SimpleApplicationsResponse {
    count: number
    applications: SimpleApplication[]
}

/**
 * Response from variant lifecycle endpoints (archive / unarchive).
 *
 * Backend shape from `api/oss/src/apis/fastapi/applications/models.py:102` —
 * `count` plus the affected variant. Field shape is intentionally loose
 * pending the Sprint 1 DTO drift audit; tighten then.
 */
export interface ApplicationVariantResponse {
    count: number
    application_variant?: {
        id?: string
        slug?: string
        application_id?: string
        deleted_at?: string | null
        [key: string]: unknown
    }
}

export interface ApplicationRevisionResponse {
    count: number
    application_revision?: ApplicationRevision
    resolution_info?: Record<string, unknown>
}

export interface ApplicationRevisionsResponse {
    count: number
    application_revisions: ApplicationRevision[]
}

export interface SimpleEvaluatorResponse {
    count: number
    evaluator?: SimpleEvaluator
}

export interface SimpleEvaluatorsResponse {
    count: number
    evaluators: SimpleEvaluator[]
}

export interface EvaluatorRevisionResponse {
    count: number
    evaluator_revision?: EvaluatorRevision
    resolution_info?: Record<string, unknown>
}

/**
 * Multi-revision query response. Backend shape from
 * `api/oss/src/apis/fastapi/evaluators/router.py`. Loose for now;
 * tighten in the Sprint 1 DTO drift audit.
 */
export interface EvaluatorRevisionsResponse {
    count: number
    evaluator_revisions: EvaluatorRevision[]
}

export interface EvaluatorVariantResponse {
    count: number
    evaluator_variant?: {
        id?: string
        slug?: string
        evaluator_id?: string
        deleted_at?: string | null
        [key: string]: unknown
    }
}

export interface EvaluatorVariantsResponse {
    count: number
    evaluator_variants: EvaluatorVariantResponse["evaluator_variant"][]
}

export interface OTelTracingResponse {
    count: number
    spans?: unknown[]
    traces?: Record<string, unknown>
}

export interface SpansResponse {
    count: number
    spans?: unknown[]
}

export interface TracesResponse {
    count: number
    traces?: unknown[]
}

// ─── Workflow (shared by apps + evaluators) ──────────────────────────────────

export interface WorkflowFlags {
    is_application?: boolean
    is_evaluator?: boolean
    is_chat?: boolean
    is_single_prompt?: boolean
    is_custom?: boolean
    is_human?: boolean
}

export interface WorkflowQueryFlags {
    is_application?: boolean
    is_evaluator?: boolean
    is_chat?: boolean
    is_custom?: boolean
    is_human?: boolean
}

export interface WorkflowData {
    uri?: string | null
    url?: string | null
    headers?: Record<string, unknown> | null
    schemas?: {
        parameters?: Record<string, unknown> | null
        inputs?: Record<string, unknown> | null
        outputs?: Record<string, unknown> | null
    } | null
    script?: Record<string, unknown> | null
    parameters?: Record<string, unknown> | null
}

export interface Workflow {
    id: string
    slug?: string
    name?: string
    description?: string
    /**
     * Workflow revision version. Not in the Fern-declared `Workflow` shape
     * (Fern only declares it on revision objects), but the backend's
     * `extra="allow"` Pydantic config returns it on workflow responses when
     * the workflow is resolved against a specific revision. Real consumers in
     * `@agenta/sdk-ui` read this field. Keep until backend stops emitting it.
     */
    version?: string | number
    flags?: WorkflowFlags
    data?: WorkflowData
    /**
     * Tags are an alias-keyed map on the wire (`{ "label-slug": LabelJson }`).
     * Some legacy backend paths return `string[]` so we accept both forms; new
     * code should treat tags as `Record<string, unknown>`. Tightening is
     * tracked in the DTO drift follow-up.
     */
    tags?: Record<string, unknown> | string[]
    meta?: Record<string, unknown>
    /**
     * Sibling identifier exposed when a workflow is resolved through a
     * revision (the "parent workflow id"). Not Fern-declared. See `version`
     * note above.
     */
    workflow_id?: string
    /**
     * Variant identifier exposed when a workflow is resolved through a
     * revision. Not Fern-declared. See `version` note above.
     */
    workflow_variant_id?: string
    created_at?: string
    updated_at?: string
    deleted_at?: string
    created_by_id?: string
    updated_by_id?: string
}

export interface WorkflowVariant {
    id: string
    slug?: string
    name?: string
    workflow_id?: string
    created_at?: string
    updated_at?: string
}

// Workflow request shapes

export interface WorkflowCreateRequest {
    workflow: {
        slug: string
        name: string
        description?: string | null
        flags?: WorkflowFlags
        tags?: string[] | null
        meta?: Record<string, unknown> | null
    }
}

export interface WorkflowEditRequest {
    workflow: {
        id: string
        name?: string | null
        description?: string | null
        flags?: WorkflowFlags
        tags?: string[] | null
        meta?: Record<string, unknown> | null
    }
}

export interface WorkflowQueryRequest {
    workflow?: {
        name?: string
        flags?: WorkflowQueryFlags
        folder_id?: string | null
    }
    include_archived?: boolean
    windowing?: Windowing
}

export interface WorkflowVariantCreateRequest {
    workflow_variant: {
        workflow_id: string
        slug: string
        name: string
    }
}

export interface WorkflowRevisionCommitRequest {
    workflow_revision: {
        workflow_id: string
        workflow_variant_id?: string
        variant_id?: string
        slug?: string
        name?: string
        flags?: WorkflowFlags
        data?: WorkflowData
        message?: string
    }
}

export interface WorkflowRevisionsQueryRequest {
    workflow_refs?: Reference[]
    workflow_variant_refs?: Reference[]
    workflow_revision?: {
        flags?: WorkflowQueryFlags
    }
    include_archived?: boolean
    windowing?: Windowing
}

// Workflow response shapes

export interface WorkflowResponse {
    count: number
    workflow?: Workflow | null
}

export interface WorkflowsResponse {
    count: number
    workflows: Workflow[]
}

export interface WorkflowVariantResponse {
    count: number
    workflow_variant?: WorkflowVariant | null
}

export interface WorkflowVariantsResponse {
    count: number
    workflow_variants: WorkflowVariant[]
}

export interface WorkflowRevisionResponse {
    count: number
    workflow_revision?: Workflow | null
}

export interface WorkflowRevisionsResponse {
    count: number
    workflow_revisions: Workflow[]
    windowing?: Windowing
}

// ─── Workflow Catalog ────────────────────────────────────────────────────────

export interface WorkflowCatalogTemplate {
    key: string
    name?: string
    description?: string
    categories?: string[]
    flags?: WorkflowFlags
    data?: WorkflowData
}

export interface WorkflowCatalogTemplatesResponse {
    count: number
    templates: WorkflowCatalogTemplate[]
}

export interface WorkflowCatalogTemplateResponse {
    count: number
    template?: WorkflowCatalogTemplate
}

// ─── Evaluation Status ───────────────────────────────────────────────────────

export type EvaluationStatus =
    | "pending"
    | "queued"
    | "running"
    | "success"
    | "failure"
    | "errors"
    | "cancelled"

// ─── Evaluation Run ──────────────────────────────────────────────────────────

export interface EvaluationRunFlags {
    is_live?: boolean
    is_active?: boolean
    is_closed?: boolean
    is_queue?: boolean
    is_cached?: boolean
    is_split?: boolean
    has_queries?: boolean
    has_testsets?: boolean
    has_evaluators?: boolean
    has_custom?: boolean
    has_human?: boolean
    has_auto?: boolean
}

export interface EvaluationRunDataStepInput {
    key: string
}

export interface EvaluationRunDataStep {
    key: string
    type: "input" | "invocation" | "annotation"
    origin: "custom" | "human" | "auto"
    references: Record<string, Reference>
    inputs?: EvaluationRunDataStepInput[]
}

export interface EvaluationRunDataMappingColumn {
    kind: string
    name: string
}

export interface EvaluationRunDataMappingStep {
    key: string
    path: string
}

export interface EvaluationRunDataMapping {
    column: EvaluationRunDataMappingColumn
    step: EvaluationRunDataMappingStep
}

export interface EvaluationRunData {
    steps?: EvaluationRunDataStep[]
    repeats?: number
    mappings?: EvaluationRunDataMapping[]
}

export interface EvaluationRun {
    id?: string
    version?: string
    name?: string
    description?: string
    metadata?: Record<string, unknown>
    flags?: EvaluationRunFlags
    status?: EvaluationStatus
    data?: EvaluationRunData
    created_at?: string
    updated_at?: string
    deleted_at?: string
    created_by_id?: string
    updated_by_id?: string
    meta?: Record<string, unknown>
}

export interface EvaluationRunCreate {
    version?: string
    key?: string
    name?: string
    description?: string
    metadata?: Record<string, unknown>
    flags?: EvaluationRunFlags
    status?: EvaluationStatus
    data?: EvaluationRunData
    meta?: Record<string, unknown>
}

export interface EvaluationRunEdit {
    id: string
    version?: string
    name?: string
    description?: string
    metadata?: Record<string, unknown>
    flags?: EvaluationRunFlags
    status?: EvaluationStatus
    data?: EvaluationRunData
}

export interface EvaluationRunQuery {
    name?: string
    flags?: Partial<EvaluationRunFlags>
    status?: EvaluationStatus
    statuses?: EvaluationStatus[]
    references?: Record<string, Reference>[]
    ids?: string[]
}

// ─── Evaluation Scenario ─────────────────────────────────────────────────────

export interface EvaluationScenario {
    id?: string
    version?: string
    status?: EvaluationStatus
    interval?: number
    timestamp?: string
    run_id: string
    metadata?: Record<string, unknown>
    created_at?: string
    updated_at?: string
}

export interface EvaluationScenarioCreate {
    version?: string
    status?: EvaluationStatus
    interval?: number
    timestamp?: string
    run_id: string
    metadata?: Record<string, unknown>
}

export interface EvaluationScenarioEdit {
    id: string
    version?: string
    status?: EvaluationStatus
    metadata?: Record<string, unknown>
}

export interface EvaluationScenarioQuery {
    status?: EvaluationStatus
    statuses?: EvaluationStatus[]
    interval?: number
    intervals?: number[]
    run_id?: string
    run_ids?: string[]
    ids?: string[]
    references?: Record<string, Reference>[]
}

// ─── Evaluation Result ───────────────────────────────────────────────────────

export interface EvaluationResult {
    id?: string
    version?: string
    hash_id?: string
    trace_id?: string
    testcase_id?: string
    error?: Record<string, unknown>
    status?: EvaluationStatus
    interval?: number
    timestamp?: string
    repeat_idx?: number
    step_key: string
    scenario_id: string
    run_id: string
    metadata?: Record<string, unknown>
    /** Alternative metadata field name (API inconsistency) */
    meta?: Record<string, unknown>
    created_at?: string
    updated_at?: string
}

export interface EvaluationResultQuery {
    status?: EvaluationStatus
    statuses?: EvaluationStatus[]
    step_key?: string
    step_keys?: string[]
    scenario_id?: string
    scenario_ids?: string[]
    run_id?: string
    run_ids?: string[]
    ids?: string[]
}

// ─── Evaluation Metrics ──────────────────────────────────────────────────────

export interface EvaluationMetrics {
    id?: string
    version?: string
    status?: EvaluationStatus
    data?: Record<string, unknown>
    interval?: number
    timestamp?: string
    scenario_id?: string
    run_id: string
    metadata?: Record<string, unknown>
    created_at?: string
    updated_at?: string
}

export interface EvaluationMetricsQuery {
    status?: EvaluationStatus
    statuses?: EvaluationStatus[]
    scenario_id?: string
    scenario_ids?: string[]
    run_id?: string
    run_ids?: string[]
    ids?: string[]
}

// ─── Simple Evaluation ───────────────────────────────────────────────────────

export interface SimpleEvaluationData {
    status?: EvaluationStatus
    query_steps?: Record<string, string> | string[]
    testset_steps?: Record<string, string> | string[]
    application_steps?: Record<string, string> | string[]
    evaluator_steps?: Record<string, string> | string[]
    repeats?: number
    // Structured references for online evaluations
    query_ref?: Reference | null
    query_revision_ref?: Reference | null
    evaluator_ref?: Reference | null
    configuration?: Record<string, unknown>
}

export interface SimpleEvaluation {
    id?: string
    version?: string
    name?: string
    description?: string
    metadata?: Record<string, unknown>
    flags?: EvaluationRunFlags
    data?: SimpleEvaluationData
    created_at?: string
    updated_at?: string
}

export interface SimpleEvaluationCreate {
    version?: string
    name?: string
    description?: string
    metadata?: Record<string, unknown>
    flags?: EvaluationRunFlags
    data?: SimpleEvaluationData
}

export interface SimpleEvaluationQuery {
    name?: string
    flags?: Partial<EvaluationRunFlags>
    ids?: string[]
}

// ─── Evaluation Request shapes ───────────────────────────────────────────────

// Runs
export interface EvaluationRunsCreateRequest {
    runs: EvaluationRunCreate[]
}

export interface EvaluationRunsEditRequest {
    runs: EvaluationRunEdit[]
}

export interface EvaluationRunQueryRequest {
    run?: EvaluationRunQuery
    windowing?: Windowing
}

export interface EvaluationRunIdsRequest {
    run_ids: string[]
}

// Scenarios
export interface EvaluationScenariosCreateRequest {
    scenarios: EvaluationScenarioCreate[]
}

export interface EvaluationScenariosEditRequest {
    scenarios: EvaluationScenarioEdit[]
}

export interface EvaluationScenarioQueryRequest {
    scenario?: EvaluationScenarioQuery
    windowing?: Windowing
}

// Results
export interface EvaluationResultQueryRequest {
    result?: EvaluationResultQuery
    windowing?: Windowing
}

// Metrics
export interface EvaluationMetricsQueryRequest {
    metrics?: EvaluationMetricsQuery
    windowing?: Windowing
}

// Simple Evaluations
export interface SimpleEvaluationCreateRequest {
    evaluation: SimpleEvaluationCreate
}

export interface SimpleEvaluationQueryRequest {
    evaluation?: SimpleEvaluationQuery
    windowing?: Windowing
}

// ─── Evaluation Response shapes ──────────────────────────────────────────────

export interface EvaluationRunResponse {
    count: number
    run?: EvaluationRun
}

export interface EvaluationRunsResponse {
    count: number
    runs: EvaluationRun[]
    windowing?: Windowing
}

export interface EvaluationRunIdsResponse {
    count: number
    run_ids: string[]
}

export interface EvaluationScenarioResponse {
    count: number
    scenario?: EvaluationScenario
}

export interface EvaluationScenariosResponse {
    count: number
    scenarios: EvaluationScenario[]
    windowing?: Windowing
}

export interface EvaluationResultsResponse {
    count: number
    results: EvaluationResult[]
}

export interface EvaluationMetricsResponse {
    count: number
    metrics: EvaluationMetrics[]
}

export interface SimpleEvaluationResponse {
    count: number
    evaluation?: SimpleEvaluation
}

export interface SimpleEvaluationsResponse {
    count: number
    evaluations: SimpleEvaluation[]
}

// ─── Test Case ───────────────────────────────────────────────────────────────

export interface TestCase {
    id?: string
    data: Record<string, unknown>
    flags?: Record<string, unknown>
    tags?: string[]
    meta?: Record<string, unknown>
}

// ─── Test Set ────────────────────────────────────────────────────────────────

export interface TestSetRevisionData {
    testcase_ids?: string[]
    testcases?: TestCase[]
}

export interface TestSet {
    id?: string
    slug?: string
    name?: string
    description?: string
    metadata?: Record<string, unknown>
    flags?: Record<string, unknown>
    data?: TestSetRevisionData
    revision_id?: string
    variant_id?: string
    created_at?: string
    updated_at?: string
    deleted_at?: string
}

export interface SimpleTestSetCreate {
    slug: string
    name: string
    description?: string
    metadata?: Record<string, unknown>
    flags?: Record<string, unknown>
    data?: TestSetRevisionData
}

export interface SimpleTestSetEdit {
    id: string
    name?: string
    description?: string
    metadata?: Record<string, unknown>
    flags?: Record<string, unknown>
    data?: TestSetRevisionData
}

export interface SimpleTestSetQuery {
    name?: string
    flags?: Record<string, unknown>
    metadata?: Record<string, unknown>
}

// TestSet request shapes

export interface SimpleTestSetCreateRequest {
    testset: SimpleTestSetCreate
}

export interface SimpleTestSetEditRequest {
    testset: SimpleTestSetEdit
}

export interface SimpleTestSetQueryRequest {
    testset?: SimpleTestSetQuery
    testset_refs?: Reference[]
    include_archived?: boolean
    windowing?: Windowing
}

export interface TestSetRevisionCommitRequest {
    testset_revision: {
        testset_id: string
        testset_variant_id?: string
        slug?: string
        name?: string
        data?: TestSetRevisionData
        message?: string
    }
}

// TestSet response shapes

export interface SimpleTestSetResponse {
    count: number
    testset?: TestSet
}

export interface SimpleTestSetsResponse {
    count: number
    testsets: TestSet[]
}

export interface TestSetRevisionResponse {
    count: number
    testset_revision?: TestSet
}

// ─── Evaluator Catalog ───────────────────────────────────────────────────────

export interface EvaluatorCatalogTemplate {
    key: string
    name?: string
    description?: string
    categories?: string[]
    flags?: Record<string, unknown>
    data?: WorkflowData
}

export interface EvaluatorCatalogPreset {
    key: string
    name?: string
    description?: string
    data?: {
        parameters?: Record<string, unknown>
    }
}

export interface EvaluatorCatalogTemplatesResponse {
    count: number
    templates: EvaluatorCatalogTemplate[]
}

export interface EvaluatorCatalogTemplateResponse {
    count: number
    template?: EvaluatorCatalogTemplate
}

export interface EvaluatorCatalogPresetsResponse {
    count: number
    presets: EvaluatorCatalogPreset[]
}

// ─── Annotations ─────────────────────────────────────────────────────────────
//
// Annotations in Agenta are evaluator-linked human feedback on traces.
// Each annotation references an evaluator (required) and stores structured
// output data — NOT bare score/label fields.

export type AnnotationOrigin = "human" | "auto" | "custom"
export type AnnotationKind = "adhoc" | "eval"
export type AnnotationChannel = "web" | "sdk" | "api"

/** Entity references attached to an annotation. */
export interface AnnotationReferences {
    evaluator?: Reference
    evaluator_revision?: Reference
    testcase?: Reference
    application?: Reference
    application_variant?: Reference
    application_revision?: Reference
    [key: string]: Reference | undefined
}

/** Link an annotation to a specific invocation trace/span. */
export interface AnnotationLink {
    trace_id?: string
    span_id?: string
}

/** Annotation metadata (display info). */
export interface AnnotationMeta {
    name?: string
    description?: string
    tags?: string[]
}

/** The annotation as returned by the API. */
export interface Annotation {
    id?: string
    trace_id: string
    span_id?: string
    origin?: AnnotationOrigin
    kind?: AnnotationKind
    channel?: AnnotationChannel
    data?: {
        outputs?: Record<string, unknown>
    }
    references?: AnnotationReferences
    links?: Record<string, AnnotationLink>
    meta?: AnnotationMeta
    created_at?: string
    updated_at?: string
    created_by_id?: string
}

/** Create an annotation — evaluator reference is required. */
export interface AnnotationCreate {
    origin?: AnnotationOrigin
    kind?: AnnotationKind
    channel?: AnnotationChannel
    /**
     * Annotation data — validated against the evaluator's `schemas.outputs`.
     * Must match the evaluator's output schema shape exactly.
     * For the default human feedback evaluator: `{ approved: boolean, label?: string, comment?: string }`
     */
    data?: Record<string, unknown>
    references?: AnnotationReferences
    links?: Record<string, AnnotationLink>
    meta?: AnnotationMeta
}

/** Edit an existing annotation (keyed by trace_id/span_id). */
export interface AnnotationEdit {
    data?: Record<string, unknown>
    links?: Record<string, AnnotationLink>
    meta?: AnnotationMeta
}

export interface AnnotationQuery {
    trace_ids?: string[]
    span_ids?: string[]
    references?: AnnotationReferences
    metadata?: Record<string, unknown>
}

// Annotation request shapes

export interface AnnotationCreateRequest {
    annotation: AnnotationCreate
}

export interface AnnotationEditRequest {
    annotation: AnnotationEdit
}

export interface AnnotationQueryRequest {
    annotation?: AnnotationQuery
    windowing?: Windowing
}

// Annotation response shapes

export interface AnnotationResponse {
    count: number
    annotation?: Annotation
}

export interface AnnotationsResponse {
    count: number
    annotations: Annotation[]
}

// ─── Evaluation Comparison (client-side utility types) ───────────────────────

export interface EvaluationComparisonResult {
    /** Metric/evaluator key */
    stepKey: string
    /** Score from the baseline run */
    baselineScore: number
    /** Score from the variant run */
    variantScore: number
    /** Absolute difference (variant - baseline) */
    delta: number
    /** Relative change as a fraction (-1 to +∞) */
    relativeChange: number
    /** Whether the variant improved over baseline */
    improved: boolean
}

// ─── Environments ─────────────────────────────────────────────────────────────

export interface EnvironmentFlags {
    is_guarded?: boolean
}

export interface EnvironmentRevisionData {
    /**
     * Per-app references keyed by app-scoped identifier (e.g. "pre.revision").
     * Values are dicts of entity-type → Reference.
     */
    references?: Record<string, Record<string, Reference>>
}

export interface SimpleEnvironment {
    id?: string
    slug?: string
    name?: string
    description?: string
    flags?: EnvironmentFlags
    revision_id?: string
    variant_id?: string
    data?: EnvironmentRevisionData
    created_at?: string
    updated_at?: string
    deleted_at?: string
}

export interface SimpleEnvironmentCreate {
    slug?: string
    name?: string
    description?: string
    flags?: EnvironmentFlags
    data?: EnvironmentRevisionData
}

export interface SimpleEnvironmentQuery {
    name?: string
    flags?: Partial<EnvironmentFlags>
}

export interface EnvironmentRevisionCommit {
    environment_id?: string
    environment_variant_id?: string
    environment_revision_id?: string
    /** The app/workflow ID being deployed */
    artifact_id?: string
    /** Specific app revision ID to deploy */
    revision_id?: string
    /** Specific app variant ID */
    variant_id?: string
    flags?: Record<string, unknown>
    data?: EnvironmentRevisionData
    message?: string
}

// Environment request shapes

export interface SimpleEnvironmentCreateRequest {
    environment: SimpleEnvironmentCreate
}

export interface SimpleEnvironmentEditRequest {
    environment: {
        id: string
        name?: string
        description?: string
        flags?: EnvironmentFlags
    }
}

export interface SimpleEnvironmentQueryRequest {
    environment?: SimpleEnvironmentQuery
    environment_refs?: Reference[]
    include_archived?: boolean
    windowing?: Windowing
}

export interface EnvironmentRevisionCommitRequest {
    environment_revision_commit: EnvironmentRevisionCommit
}

export interface EnvironmentRevisionResolveRequest {
    environment_ref?: Reference
    environment_variant_ref?: Reference
    environment_revision_ref?: Reference
    max_depth?: number
    max_embeds?: number
}

// Environment response shapes

export interface SimpleEnvironmentResponse {
    count: number
    environment?: SimpleEnvironment
}

export interface SimpleEnvironmentsResponse {
    count: number
    environments: SimpleEnvironment[]
}

// ─── Profile ─────────────────────────────────────────────────────────────────
//
// Mirrors:
//   api/oss/src/models/api/user_models.py
//   api/oss/src/routers/user_profile.py

/** User profile returned by GET /profile. */
export interface UserProfile {
    id?: string
    uid: string
    email: string
    username: string
    profile_picture?: string
    created_at?: string
    updated_at?: string
}

/** Payload for PUT /profile/username. */
export interface UpdateUsernameRequest {
    username: string
}

// ─── Vault / Secrets ─────────────────────────────────────────────────────────
//
// Mirrors:
//   api/oss/src/core/secrets/enums.py
//   api/oss/src/core/secrets/dtos.py

/** The category of secret stored in the vault. */
export enum SecretKind {
    PROVIDER_KEY = "provider_key",
    CUSTOM_PROVIDER = "custom_provider",
    SSO_PROVIDER = "sso_provider",
    WEBHOOK_PROVIDER = "webhook_provider",
}

/** Built-in LLM provider identifiers for standard API key secrets. */
export enum StandardProviderKind {
    OPENAI = "openai",
    COHERE = "cohere",
    ANYSCALE = "anyscale",
    DEEPINFRA = "deepinfra",
    ALEPHALPHA = "alephalpha",
    GROQ = "groq",
    MISTRAL = "mistral",
    MISTRALAI = "mistralai",
    ANTHROPIC = "anthropic",
    PERPLEXITYAI = "perplexityai",
    TOGETHERAI = "together_ai",
    OPENROUTER = "openrouter",
    GEMINI = "gemini",
}

/** Provider identifiers for custom provider secrets (includes cloud-specific providers). */
export enum CustomProviderKind {
    CUSTOM = "custom",
    AZURE = "azure",
    BEDROCK = "bedrock",
    SAGEMAKER = "sagemaker",
    VERTEX = "vertex_ai",
    OPENAI = "openai",
    COHERE = "cohere",
    ANYSCALE = "anyscale",
    DEEPINFRA = "deepinfra",
    ALEPHALPHA = "alephalpha",
    GROQ = "groq",
    MISTRAL = "mistral",
    MISTRALAI = "mistralai",
    ANTHROPIC = "anthropic",
    PERPLEXITYAI = "perplexityai",
    TOGETHERAI = "together_ai",
    OPENROUTER = "openrouter",
    GEMINI = "gemini",
}

/** Settings for a standard LLM provider (just an API key). */
export interface StandardProviderSettings {
    key: string
}

/** Standard provider data: identifies the provider and holds its API key. */
export interface StandardProvider {
    kind: StandardProviderKind
    provider: StandardProviderSettings
}

/** Connection settings for a custom provider (URL, version, cloud-specific extras). */
export interface CustomProviderSettings {
    url?: string
    version?: string
    key?: string
    /** Cloud-specific fields (e.g. aws_region_name, vertex_ai_project, api_key). */
    extras?: Record<string, unknown>
}

/** A model available through a custom provider. */
export interface CustomModelSettings {
    slug: string
    extras?: Record<string, unknown>
}

/** Custom provider data: provider connection + available models. */
export interface CustomProvider {
    kind: CustomProviderKind
    provider: CustomProviderSettings
    models: CustomModelSettings[]
    /** Auto-populated from header name. Used to build model_keys. */
    provider_slug?: string
    /** Computed keys in the form `{provider_slug}/{kind}/{model_slug}`. */
    model_keys?: string[]
}

/** SSO/OAuth provider connection settings. */
export interface SSOProviderSettings {
    client_id: string
    client_secret: string
    issuer_url: string
    scopes: string[]
    extra?: Record<string, unknown>
}

/** SSO provider data. */
export interface SSOProvider {
    provider: SSOProviderSettings
}

/** Webhook provider authentication settings. */
export interface WebhookProviderSettings {
    key: string
}

/** Webhook provider data. */
export interface WebhookProvider {
    provider: WebhookProviderSettings
}

/** The secret payload: kind discriminator + provider-specific data. */
export interface SecretDTO {
    kind: SecretKind
    data: StandardProvider | CustomProvider | SSOProvider | WebhookProvider
}

/** Request body for creating a new vault secret. */
export interface CreateSecretRequest {
    header: Header
    secret: SecretDTO
}

/** Request body for updating an existing vault secret. Both fields are optional (partial update). */
export interface UpdateSecretRequest {
    header?: Header
    secret?: SecretDTO
}

/** Lifecycle timestamps returned on secret responses. */
export interface SecretLifecycle {
    created_at?: string
    updated_at?: string
    updated_by_id?: string
    /** @deprecated Use updated_by_id instead. */
    updated_by?: string
}

/** Full secret response from the vault API. */
export interface SecretResponse extends SecretDTO {
    id: string
    header: Header
    lifecycle?: SecretLifecycle
}

// ─── Tools ───────────────────────────────────────────────────────────────────
//
// Mirrors:
//   api/oss/src/apis/fastapi/tools/models.py

// Catalog

export interface ToolProviderItem {
    key: string
    name: string
    description?: string
    integrations_count?: number
}

export interface ToolProvidersResponse {
    count: number
    providers: ToolProviderItem[]
}

export type ToolAuthScheme = "oauth" | "api_key"

export interface ToolIntegrationItem {
    key: string
    name: string
    description?: string
    logo?: string
    url?: string
    actions_count?: number
    categories: string[]
    auth_schemes?: ToolAuthScheme[]
}

export interface ToolIntegrationsResponse {
    count: number
    total: number
    cursor?: string | null
    integrations: ToolIntegrationItem[]
}

export interface ToolIntegrationDetailResponse {
    count: number
    integration: ToolIntegrationItem | null
}

export interface ToolActionItem {
    key: string
    name: string
    description?: string
    categories?: string[]
    logo?: string
}

export interface ToolActionDetailItem extends ToolActionItem {
    schemas?: {
        inputs?: Record<string, unknown>
        outputs?: Record<string, unknown>
    }
    scopes?: string[]
}

export interface ToolActionsListResponse {
    count: number
    total: number
    cursor?: string | null
    actions: ToolActionItem[]
}

export interface ToolActionDetailResponse {
    count: number
    action: ToolActionDetailItem | null
}

// Connections

export interface ToolConnectionItem {
    id: string
    slug: string
    name?: string
    description?: string
    provider_key: string
    integration_key: string
    flags?: {is_active?: boolean; is_valid?: boolean}
    status?: Record<string, unknown>
    data?: Record<string, unknown>
    created_at?: string
    updated_at?: string
}

export interface ToolConnectionCreateRequest {
    connection: {
        slug: string
        name?: string
        description?: string
        provider_key: string
        integration_key: string
        data?: {
            auth_scheme?: ToolAuthScheme
            credentials?: Record<string, string>
        }
    }
}

export interface ToolConnectionResponse {
    count: number
    connection: ToolConnectionItem | null
}

export interface ToolConnectionsQueryResponse {
    count: number
    connections: ToolConnectionItem[]
}

// Execution

export interface ToolCallFunction {
    name: string
    arguments: string | Record<string, unknown>
}

export interface ToolCallData {
    id: string
    type?: string
    function: ToolCallFunction
}

export interface ToolCallRequest {
    data: ToolCallData
}

export interface ToolResultData {
    role: string
    tool_call_id: string
    content: string
}

export interface ToolCallStatus {
    timestamp: string
    type: string
    code?: string
    message?: string
    stacktrace?: string
}

export interface ToolCallResult {
    id?: string
    status?: ToolCallStatus
    data?: ToolResultData
}

export interface ToolCallResponse {
    call: ToolCallResult
}

// ─── AI Services ─────────────────────────────────────────────────────────────
//
// Mirrors:
//   api/oss/src/apis/fastapi/ai_services/

/** Tool descriptor returned by AI services status. */
export interface AIServiceTool {
    name: string
    title: string
    description: string
    inputSchema?: Record<string, unknown>
    outputSchema?: Record<string, unknown>
}

/** Response from GET /ai/services/status. */
export interface AIServicesStatus {
    enabled: boolean
    tools: AIServiceTool[]
}

/** Response from POST /ai/services/tools/call. */
export interface AIServiceToolCallResponse {
    content: {type: "text"; text: string}[]
    structuredContent?: {
        messages: {role: string; content: string}[]
        summary?: string
    }
    isError: boolean
    meta?: {trace_id?: string}
}

// ─── API Keys ────────────────────────────────────────────────────────────────
//
// Mirrors:
//   api/oss/src/routers/api_key_router.py

/** API key as returned by the backend. */
export interface ApiKeyItem {
    prefix: string
    created_at?: string
    last_used_at?: string
    expiration_date?: string
}

/** Response containing the full key (only returned on creation). */
export interface ApiKeyCreateResponse {
    api_key: string
    prefix: string
}

// ─── Projects ────────────────────────────────────────────────────────────────

export interface ProjectItem {
    project_id: string
    project_name: string
    workspace_id?: string
    organization_id?: string
    is_demo?: boolean
    created_at?: string
    updated_at?: string
}

export interface ProjectCreateRequest {
    name: string
    make_default?: boolean
}

export interface ProjectPatchRequest {
    name?: string
    make_default?: boolean
}

// ─── Folders ─────────────────────────────────────────────────────────────────

export interface FolderItem {
    id: string
    name: string
    description?: string
    parent_id?: string | null
    project_id?: string
    created_at?: string
    updated_at?: string
}

export interface FolderCreateRequest {
    name: string
    description?: string
    parent_id?: string | null
}

export interface FolderEditRequest {
    name?: string
    description?: string
    parent_id?: string | null
}

export interface FolderQueryRequest {
    parent_id?: string | null
}

export interface FolderResponse {
    folder: FolderItem
}

export interface FoldersResponse {
    count: number
    folders: FolderItem[]
}

// ─── Queries (Saved Filters) ────────────────────────────────────────────────

export interface QueryItem {
    id: string
    name?: string
    description?: string
    data?: Record<string, unknown>
    created_at?: string
    updated_at?: string
}

export interface QueryCreateRequest {
    name?: string
    description?: string
    data?: Record<string, unknown>
}

export interface QueryEditRequest {
    name?: string
    description?: string
    data?: Record<string, unknown>
}

export interface QueryResponse {
    count: number
    query?: QueryItem
}

export interface QueriesResponse {
    count: number
    queries: QueryItem[]
}

// ─── Organizations ───────────────────────────────────────────────────────────

export interface OrganizationFlagsUpdate {
    is_personal?: boolean
    is_demo?: boolean
    allow_email?: boolean
    allow_social?: boolean
    allow_sso?: boolean
    auto_join?: boolean
    domains_only?: boolean
    allow_root?: boolean
}

export interface OrganizationUpdatePayload {
    slug?: string
    name?: string
    description?: string
    flags?: OrganizationFlagsUpdate
}

export interface OrganizationDomain {
    id: string
    slug: string
    name: string | null
    description: string | null
    organization_id: string
    token: string | null
    flags: {is_verified?: boolean}
    created_at: string
    updated_at: string | null
}

export interface OrganizationProvider {
    id: string
    slug: string
    organization_id: string
    provider_type: "oidc"
    name: string
    client_id: string
    client_secret: string
    issuer_url: string
    authorization_endpoint?: string
    token_endpoint?: string
    userinfo_endpoint?: string
    scopes: string[]
    flags: {is_valid?: boolean; is_active?: boolean}
    created_at: string
    updated_at: string | null
}

export interface OrganizationProviderCreateRequest {
    slug: string
    provider_type: "oidc"
    config: {
        issuer_url: string
        client_id: string
        client_secret: string
        scopes?: string[]
    }
}

export interface OrganizationProviderUpdateRequest {
    slug?: string
    config?: {
        issuer_url?: string
        client_id?: string
        client_secret?: string
        scopes?: string[]
    }
    flags?: {is_enabled?: boolean}
}

// ─── Workspaces ──────────────────────────────────────────────────────────────

export interface WorkspaceRoleItem {
    role_name: string
    role_description?: string
}

export interface WorkspaceMemberItem {
    user: {
        id: string
        uid: string
        username: string
        email: string
        status?: string
    }
    roles: WorkspaceRoleItem[]
}

export interface WorkspaceInviteData {
    email: string
    roles?: string[]
}
