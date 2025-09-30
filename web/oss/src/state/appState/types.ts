export type RouteLayer = "unknown" | "root" | "workspace" | "project" | "app"

export interface AppIdentifiers {
    workspaceId: string | null
    projectId: string | null
    appId: string | null
}

export type QueryRecord = Partial<Record<string, string | string[]>>

export type QueryValue = string | string[] | undefined

export interface ParsedAppLocation extends AppIdentifiers {
    pathname: string
    asPath: string
    hash: string | null
    segments: string[]
    query: QueryRecord
    routeLayer: RouteLayer
    restPath: string[]
}

export interface AppStateSnapshot extends ParsedAppLocation {
    timestamp: number
}

export type NavigationMethod = "push" | "replace"

export interface BaseNavigationCommand {
    method?: NavigationMethod
    shallow?: boolean
}

export interface HrefNavigationCommand extends BaseNavigationCommand {
    type: "href"
    href: string
}

export interface QueryPatchNavigationCommand extends BaseNavigationCommand {
    type: "patch-query"
    patch: Record<string, string | string[] | undefined>
    preserveHash?: boolean
}

export type NavigationCommand = HrefNavigationCommand | QueryPatchNavigationCommand
