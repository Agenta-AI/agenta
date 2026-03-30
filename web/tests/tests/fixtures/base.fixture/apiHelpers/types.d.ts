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

export interface ApiHandlerOptions<T> {
    route: string | RegExp
    method?: string
    validateStatus?: boolean
    responseHandler?: (data: T) => Promise<void> | void
}

export interface ApiHelpers {
    waitForApiResponse: <T>(options: ApiHandlerOptions<T>) => Promise<T>
    getApp: (type?: APP_TYPE) => Promise<ListAppsItem>
    getAppById: (appId: string) => Promise<ListAppsItem>
    getTestsets: () => Promise<testset[]>
    getVariants: (appId: string) => Promise<ApiVariant[]>
    getEvaluationRuns: () => Promise<any[]>
    getProjectScopedBasePath: () => string
}
