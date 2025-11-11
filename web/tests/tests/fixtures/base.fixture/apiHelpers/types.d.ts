import {ListAppsItem, testset, APP_TYPE} from "../../../../../oss/src/lib/Types"

export interface ApiHandlerOptions<T> {
    route: string | RegExp
    method?: string
    validateStatus?: boolean
    responseHandler?: (data: T) => Promise<void> | void
}

export interface ApiHelpers {
    waitForApiResponse: <T>(options: ApiHandlerOptions<T>) => Promise<T>
    getApp: (type?: APP_TYPE) => Promise<ListAppsItem>
    getTestsets: () => Promise<testset[]>
    getVariants: (appId: string) => Promise<(ApiVariant & {name: string})[]>
}
