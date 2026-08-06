import {testset} from "../../../../../oss/src/lib/Types"

type APP_TYPE = "completion" | "chat" | "custom"

interface ListAppsItem {
    id: string
    name: string
    app_type: APP_TYPE
    flags: {
        is_chat?: boolean
        is_custom?: boolean
        is_application?: boolean
        is_evaluator?: boolean
    } | null
    created_at: string | null
    [key: string]: any
}

interface ApiVariant {
    id: string
    name: string | null
    slug: string | null
    workflow_id: string | null
    artifact_id: string | null
    flags: {
        is_chat?: boolean
        is_custom?: boolean
        is_application?: boolean
        is_evaluator?: boolean
    } | null
    created_at: string | null
    updated_at: string | null
}

export interface ApiHandlerOptions<T> {
    route: string | RegExp
    method?: string
    validateStatus?: boolean
    responseHandler?: (data: T) => Promise<void> | void
}

export interface CreateTestsetInput {
    name: string
    rows: Record<string, unknown>[]
    description?: string
}

export interface CreatedTestset {
    id: string
    name: string
    revisionId?: string
}

export interface ApiHelpers {
    waitForApiResponse: <T>(options: ApiHandlerOptions<T>) => Promise<T>
    createApp: (type?: APP_TYPE) => Promise<ListAppsItem>
    getApp: (type?: APP_TYPE) => Promise<ListAppsItem>
    getAppById: (appId: string) => Promise<ListAppsItem>
    getTestsets: () => Promise<testset[]>
    createTestset: (input: CreateTestsetInput) => Promise<CreatedTestset>
    getVariants: (appId: string) => Promise<ApiVariant[]>
    getEvaluationRuns: () => Promise<any[]>
    getProjectScopedBasePath: () => string
}
