/**
 * Preview-evaluation-specific types.
 *
 * These were promoted verbatim from OSS (`@/oss/lib/Types`,
 * `@/oss/services/evaluationRuns/api/types`, `@/oss/services/evaluations/api/evaluatorTypes`,
 * `@/oss/services/onlineEvaluations/api`) during the WP-4c relocation of the
 * `usePreviewEvaluations` hook subsystem. They are preview-eval-specific shapes — NOT the
 * shared entity `Testset` from `@agenta/entities/testset` — so they live locally here to
 * avoid coupling the headless package back to the OSS app.
 */

import type {Workflow} from "@agenta/entities/workflow"

/** Convert snake_case object keys to camelCase (shallow). */
export type KeyValuePair = Record<string, string>

export interface WorkspaceRole {
    role_description: string
    role_name: string
}

export interface WorkspaceUser {
    id: string
    email: string
    username: string
    status: "member" | "pending" | "expired"
    created_at: string
}

export interface WorkspaceMember {
    user: WorkspaceUser
    roles: (WorkspaceRole & {permissions: string[]})[]
}

/**
 * The shape of an OSS legacy testset (the one with `csvdata`). Promoted under the same
 * name preserving its shape — intentionally NOT unified with the `@agenta/entities`
 * `Testset` (which models revisions/testcases differently).
 */
export interface OssTestset {
    id: string
    name: string
    created_at: string
    updated_at: string
    csvdata: KeyValuePair[]
    columns?: string[]
}

export interface PreviewTestset {
    id: string
    name: string
    created_at: string
    created_by_id: string
    slug: string
    data: {
        testcase_ids: string[]
        testcases: {
            testcase_id: string
            __flags__?: unknown
            __tags__?: unknown
            __meta__?: unknown
            [key: string]: unknown
        }[]
    }
}

// Extend the base OSS testset to include optional variantId and revisionId.
export interface CreateEvaluationRunTestset extends OssTestset {
    variantId?: string
    revisionId?: string
}

export interface CreateEvaluationRunInput {
    name: string
    testset: CreateEvaluationRunTestset | undefined
    revisions: Workflow[]
    evaluators?: Workflow[]
    correctAnswerColumn: string
    meta?: Record<string, unknown>
}

export interface EvaluatorData {
    uri?: string
    schemas?: {
        outputs?: Record<string, unknown>
        inputs?: Record<string, unknown>
        parameters?: Record<string, unknown>
    }
}

interface EvaluatorDtoBase {
    name: string
    slug: string
    key?: string
    description: string
    data: EvaluatorData
    tags?: string[] | Record<string, unknown> | string
    flags?: Record<string, unknown>
    meta?: Record<string, unknown>
    requires_llm_api_keys?: boolean
}

export type EvaluatorDto<T extends "payload" | "response" = "response"> = EvaluatorDtoBase &
    (T extends "response" ? {id: string; created_at: string; created_by_id: string} : {id?: string})

export interface RunFlagsFilter {
    is_live?: boolean
    is_active?: boolean
    is_closed?: boolean
    is_queue?: boolean
    has_queries?: boolean
    has_testsets?: boolean
    has_testcases?: boolean
    has_traces?: boolean
    has_evaluators?: boolean
    has_custom?: boolean
    has_human?: boolean
    has_auto?: boolean
}

export interface QueryWindowingPayload {
    newest?: string
    oldest?: string
    next?: string
    limit?: number
    order?: "ascending" | "descending"
    interval?: number
    rate?: number
}
