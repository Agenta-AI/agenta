import deepEqual from "fast-deep-equal"
import {atom} from "jotai"
import {selectAtom, unwrap, atomWithStorage} from "jotai/utils"
import {eagerAtom} from "jotai-eager"
import {observe} from "jotai-effect"
import {atomWithQuery} from "jotai-tanstack-query"
import Router from "next/router"

import {isEE} from "@/oss/lib/helpers/isEE"
import {User} from "@/oss/lib/Types"
import {fetchAllProjects} from "@/oss/services/project"
import {ProjectsResponse} from "@/oss/services/project/types"

import {profileQueryAtom} from "../../newProfile"
import {selectedOrgQueryAtom, selectedOrgAtom} from "../../org/selectors/org"
import {sessionExistsAtom} from "../../session"
import {logAtom} from "../../utils/logAtom"
import {stringStorage} from "../../utils/stringStorage"

export const projectsQueryAtom = atomWithQuery<ProjectsResponse[]>((get) => {
    // const orgId = get(selectedOrgIdAtom)
    const orgId = get(selectedOrgQueryAtom)?.data?.id
    return {
        queryKey: ["projects", orgId],
        queryFn: async () => {
            const data = await fetchAllProjects()
            return data
        },
        experimental_prefetchInRender: true,
        staleTime: 1000 * 60,
        refetchOnWindowFocus: false,
        refetchOnReconnect: false,
        refetchOnMount: false,
        enabled: get(sessionExistsAtom) && !!(get(profileQueryAtom)?.data as User)?.id && !!orgId,
    }
})

const logProjects = process.env.NEXT_PUBLIC_LOG_PROJECT_ATOMS === "true"
logAtom(projectsQueryAtom, "projectsQueryAtom", logProjects)

const EmptyProjects: ProjectsResponse[] = []
export const projectsAtom = selectAtom(
    unwrap(projectsQueryAtom),
    (res) => (res as any)?.data ?? EmptyProjects,
    deepEqual,
)

export const projectAtom = eagerAtom((get) => {
    const projects = get(projectsAtom) as ProjectsResponse[]
    const org = get(selectedOrgAtom)
    const workspaceId = org?.default_workspace?.id
    const nonDemoProjects = projects.filter((project) => !project.is_demo)
    const fallbackProject = nonDemoProjects[0] ?? projects[0] ?? null

    if (isEE()) {
        const matchingProject = projects.find((p) => p.workspace_id === workspaceId && !p.is_demo)

        if (matchingProject) {
            return matchingProject
        }

        const workspaceMatch = projects.find((p) => p.workspace_id === workspaceId)
        if (workspaceMatch) {
            return workspaceMatch.is_demo ? fallbackProject : workspaceMatch
        }
    }

    return fallbackProject
})

// Project ID URL + storage integration (URL is source of truth)
export const LS_PROJECT_KEY = "selectedProjectId"

export const projectIdStorageAtom = atomWithStorage<string | null>(
    LS_PROJECT_KEY,
    null,
    stringStorage,
)

const getProjectIdFromURL = (): string | null => {
    if (typeof window === "undefined") return null
    try {
        const isParamToken = (v: string) => /^\[[^/]+\]$/.test(v)

        // Prefer parsing the real browser location first for immediate correctness
        const fromPath = window.location.pathname || ""
        let m = /\/p\/([^\/?#]+)/.exec(fromPath)
        let seg = m ? m[1] : null
        if (seg && !isParamToken(seg)) return seg

        // Fallback to Next Router (may be undefined very early)
        const q: any = (Router as any)?.query
        if (q && q.project_id) {
            const pid = Array.isArray(q.project_id) ? q.project_id[0] : q.project_id
            if (typeof pid === "string" && pid && !isParamToken(pid)) return pid
        }
        const asPath: string = ((Router as any)?.asPath as string) || ""
        const base = asPath.split(/[?#]/)[0] || ""
        m = /\/p\/([^\/?#]+)/.exec(base)
        seg = m ? m[1] : null
        if (seg && !isParamToken(seg)) return seg
        return null
    } catch {
        return null
    }
}

// Bump a version atom on route changes so URL-derived atoms recompute
const routeChangeVersionAtom = atom(0)
observe((get, set) => {
    if (typeof window === "undefined") return
    const handler = () => set(routeChangeVersionAtom, (v) => v + 1)
    Router.events.on("routeChangeComplete", handler)
    return () => Router.events.off("routeChangeComplete", handler)
})

export const projectIdURLAtom = eagerAtom<string | null>((get) => {
    // Depend on route change version so this updates after navigation
    get(routeChangeVersionAtom)
    return getProjectIdFromURL()
})

const ensureProjectIdSyncAtom = atom(null, (get, set) => {
    // Do not attempt any redirection when there is no active session
    const hasSession = get(sessionExistsAtom)
    if (!hasSession) return

    // Avoid interfering with the auth flow: if we're on an auth route, skip
    const currentPath = (Router.asPath || "").split(/[?#]/)[0] || ""
    if (/^\/auth(\/|$)/.test(currentPath)) return

    const result = get(projectsQueryAtom) as any
    const status: string | undefined = result?.status
    if (status !== "success") return

    const projects: ProjectsResponse[] = result?.data ?? []
    const org = get(selectedOrgAtom)
    const current = get(projectIdAtom)
    const fromUrl = get(projectIdURLAtom)

    const updateRoute = (projectId: string) => {
        if (typeof window === "undefined" || !org?.id || !projectId) return
        // If on auth routes, do not try to redirect to workspace/project
        const asPath = Router.asPath || ""
        const currentPathname = asPath.split(/[?#]/)[0] || ""
        if (/^\/auth(\/|$)/.test(currentPathname)) return
        const encodedOrg = encodeURIComponent(org.id)
        const encodedProject = encodeURIComponent(projectId)
        // Build a redirect that strips query params but preserves hash (if any)
        const [pathname, queryAndHash = ""] = asPath.split("?")
        const hash = queryAndHash.includes("#") ? `#${queryAndHash.split("#")[1]}` : ""
        const suffix = hash
        const workspacePrefix = `/w/${encodedOrg}`

        let nextPathname: string
        if (pathname.startsWith(workspacePrefix)) {
            if (/\/p\/[^/]+/.test(pathname)) {
                nextPathname = pathname.replace(/(\/p\/)[^/]+/, `$1${encodedProject}`)
            } else {
                nextPathname = `${workspacePrefix}/p/${encodedProject}/apps`
            }
        } else {
            nextPathname = `${workspacePrefix}/p/${encodedProject}/apps`
        }

        if (nextPathname !== pathname) {
            Router.replace(`${nextPathname}${suffix}`).catch(() => {})
        }
    }

    const belongsToOrg = (project: ProjectsResponse | undefined | null) => {
        if (!project) return false
        if (!org?.id) return true
        if (project.organization_id && project.organization_id !== org.id) return false
        if (org.default_workspace?.id && project.workspace_id) {
            return project.workspace_id === org.default_workspace.id
        }
        return true
    }

    const currentProject = projects.find((p) => p.project_id === current)
    const currentValid = current && currentProject ? belongsToOrg(currentProject) : false

    if (currentValid) {
        // Ensure URL matches current selection when set from storage / auto selection
        if (current && fromUrl !== current) updateRoute(current)
        return
    }

    if (!projects.length) {
        if (current !== null) set(projectIdAtom, null)
        return
    }

    const fallback = (() => {
        if (!org) return projects[0]
        const workspaceId = org.default_workspace?.id
        if (workspaceId) {
            const match = projects.find((p) => p.workspace_id === workspaceId)
            if (match) return match
        }
        const orgMatch = projects.find((p) => p.organization_id === org.id)
        return orgMatch ?? projects[0]
    })()

    if (!fallback) return

    const nextId = fallback.project_id
    if (!nextId || nextId === current) return

    set(projectIdAtom, nextId)

    updateRoute(nextId)
})

export const projectIdAtom = atom(
    (get) => {
        // Prefer URL, then storage, then derived projectAtom
        const fromUrl = get(projectIdURLAtom)
        // const fromStorage = get(projectIdStorageAtom)
        if (fromUrl) return fromUrl
        // if (fromStorage) return fromStorage
        return get(projectAtom)?.project_id ?? null
    },
    (get, set, next: string | null) => {
        const current = get(projectIdStorageAtom)
        const value = typeof next === "function" ? (next as any)(current) : next
        set(projectIdStorageAtom, value)
    },
)

observe((get, set) => {
    if (typeof window === "undefined") return
    get(projectsQueryAtom)
    get(selectedOrgAtom)
    get(projectIdURLAtom)
    get(projectIdAtom)
    set?.(ensureProjectIdSyncAtom, null)
})
