import type {ParsedUrlQuery} from "querystring"

import type {ParsedAppLocation, QueryRecord, RouteLayer} from "./types"

const isBrowser = typeof window !== "undefined"

const sanitizeId = (value: string | null | undefined): string | null => {
    if (value === undefined || value === null) return null
    const trimmed = String(value).trim()
    if (!trimmed || trimmed === "null" || trimmed === "undefined") return null
    return trimmed
}

const decodeSegment = (segment: string): string => {
    try {
        return decodeURIComponent(segment)
    } catch {
        return segment
    }
}

const toQueryRecord = (query: ParsedUrlQuery | undefined): QueryRecord => {
    const record: QueryRecord = {}
    if (!query) return record

    Object.entries(query).forEach(([key, value]) => {
        if (value === undefined || value === null) return
        if (Array.isArray(value)) {
            record[key] = value.map((item) => String(item))
            return
        }
        record[key] = String(value)
    })

    return record
}

const getPathFromAsPath = (asPath: string): string => {
    if (!asPath) return "/"
    const hashIndex = asPath.indexOf("#")
    const trimmed = hashIndex >= 0 ? asPath.slice(0, hashIndex) : asPath
    const queryIndex = trimmed.indexOf("?")
    const path = queryIndex >= 0 ? trimmed.slice(0, queryIndex) : trimmed
    if (!path) return "/"
    return path.startsWith("/") ? path : `/${path}`
}

const extractHash = (asPath: string): string | null => {
    const index = asPath.indexOf("#")
    if (index === -1) return null
    const hash = asPath.slice(index + 1)
    return hash || null
}

const getFirstQueryValue = (value: string | string[] | undefined): string | null => {
    if (value === undefined || value === null) return null
    if (Array.isArray(value)) {
        const first = value[0]
        return first !== undefined ? sanitizeId(first) : null
    }
    return sanitizeId(value)
}

interface ParseRouterStateArgs {
    pathname?: string
    asPath?: string
    query?: ParsedUrlQuery
}

export const parseRouterState = ({
    pathname = "/",
    asPath = "/",
    query,
}: ParseRouterStateArgs): ParsedAppLocation => {
    const normalizedAsPath = asPath || pathname || "/"
    const pathOnly = getPathFromAsPath(normalizedAsPath)
    const segments = pathOnly
        .split("/")
        .filter(Boolean)
        .map((segment) => decodeSegment(segment))

    const hash = extractHash(normalizedAsPath)
    const normalizedQuery = toQueryRecord(query)

    let routeLayer: RouteLayer = segments.length === 0 ? "root" : "unknown"
    let workspaceId: string | null = null
    let projectId: string | null = null
    let appId: string | null = null
    let restStartIndex = 0

    if (segments[0] === "w") {
        const maybeWorkspace = sanitizeId(segments[1])
        if (maybeWorkspace) {
            workspaceId = maybeWorkspace
            routeLayer = "workspace"
            restStartIndex = 2

            if (segments[2] === "p") {
                const maybeProject = sanitizeId(segments[3])
                if (maybeProject) {
                    projectId = maybeProject
                    routeLayer = "project"
                    restStartIndex = 4

                    if (segments[4] === "apps") {
                        const maybeApp = sanitizeId(segments[5])
                        if (maybeApp) {
                            appId = maybeApp
                            routeLayer = "app"
                            restStartIndex = 6
                        } else {
                            restStartIndex = 5
                        }
                    }
                } else {
                    restStartIndex = 3
                }
            }
        }
    }

    if (!workspaceId) {
        workspaceId =
            getFirstQueryValue(normalizedQuery.workspaceId) ||
            getFirstQueryValue(normalizedQuery.workspace_id) ||
            null
    }
    if (!projectId) {
        projectId =
            getFirstQueryValue(normalizedQuery.projectId) ||
            getFirstQueryValue(normalizedQuery.project_id) ||
            null
    }
    if (!appId) {
        appId =
            getFirstQueryValue(normalizedQuery.appId) ||
            getFirstQueryValue(normalizedQuery.app_id) ||
            null
    }

    const restPath = segments.slice(restStartIndex)

    return {
        pathname: pathOnly,
        asPath: normalizedAsPath || pathOnly,
        hash,
        segments,
        query: normalizedQuery,
        routeLayer,
        restPath,
        workspaceId,
        projectId,
        appId,
    }
}

export const createInitialParsedLocation = (): ParsedAppLocation => {
    if (isBrowser) {
        try {
            const url = new URL(window.location.href)
            const query: ParsedUrlQuery = {}
            url.searchParams.forEach((value, key) => {
                if (query[key] === undefined) {
                    query[key] = value
                    return
                }
                const current = query[key]
                if (Array.isArray(current)) {
                    current.push(value)
                    return
                }
                query[key] = [current as string, value]
            })
            return parseRouterState({
                pathname: url.pathname,
                asPath: `${url.pathname}${url.search}${url.hash}`,
                query,
            })
        } catch {
            // fall through to default below
        }
    }

    return {
        pathname: "/",
        asPath: "/",
        hash: null,
        segments: [],
        query: {},
        routeLayer: "root",
        restPath: [],
        workspaceId: null,
        projectId: null,
        appId: null,
    }
}
