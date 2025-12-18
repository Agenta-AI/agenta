import {atom} from "jotai"
import {atomWithQuery} from "jotai-tanstack-query"

import {queryClient} from "@/oss/lib/api/queryClient"
import {User} from "@/oss/lib/Types"
import {fetchAllProjects} from "@/oss/services/project"
import {ProjectsResponse} from "@/oss/services/project/types"
import {appIdentifiersAtom, appStateSnapshotAtom, requestNavigationAtom} from "@/oss/state/appState"
import {selectedOrgAtom, selectedOrgIdAtom} from "@/oss/state/org/selectors/org"
import {profileQueryAtom} from "@/oss/state/profile"
import {sessionExistsAtom} from "@/oss/state/session"
import {logAtom} from "@/oss/state/utils/logAtom"

const LAST_USED_PROJECTS_KEY = "lastUsedProjectsByWorkspace"

const readLastUsedProjectId = (workspaceId: string | null): string | null => {
    if (typeof window === "undefined" || !workspaceId) return null
    try {
        const raw = window.localStorage.getItem(LAST_USED_PROJECTS_KEY)
        if (!raw) return null
        const parsed = JSON.parse(raw)
        if (!parsed || typeof parsed !== "object") return null
        const value = parsed[workspaceId]
        return typeof value === "string" && value.trim() ? value.trim() : null
    } catch {
        return null
    }
}

export const getLastUsedProjectId = (workspaceId: string | null): string | null =>
    readLastUsedProjectId(workspaceId)

export const cacheLastUsedProjectId = (workspaceId: string | null, projectId: string | null) => {
    if (typeof window === "undefined") return
    if (!workspaceId || !projectId) return
    try {
        const raw = window.localStorage.getItem(LAST_USED_PROJECTS_KEY)
        const parsed = raw ? JSON.parse(raw) : {}
        const next = parsed && typeof parsed === "object" ? parsed : {}
        next[workspaceId] = projectId
        window.localStorage.setItem(LAST_USED_PROJECTS_KEY, JSON.stringify(next))
    } catch {
        // ignore storage errors
    }
}

export const projectsQueryAtom = atomWithQuery<ProjectsResponse[]>((get) => {
    const workspaceId = get(selectedOrgIdAtom)
    const snapshot = get(appStateSnapshotAtom)
    const isAcceptRoute = snapshot.pathname.startsWith("/workspaces/accept")
    return {
        queryKey: ["projects", workspaceId || ""],
        queryFn: async () => fetchAllProjects(),
        experimental_prefetchInRender: true,
        staleTime: 60_000,
        refetchOnWindowFocus: false,
        refetchOnReconnect: false,
        refetchOnMount: false,
        enabled:
            get(sessionExistsAtom) &&
            !!(get(profileQueryAtom)?.data as User)?.id &&
            !isAcceptRoute &&
            !!workspaceId,
    }
})

const logProjects = process.env.NEXT_PUBLIC_LOG_PROJECT_ATOMS === "true"
const _debugProjectSelection = process.env.NEXT_PUBLIC_APP_STATE_DEBUG === "true"
logAtom(projectsQueryAtom, "projectsQueryAtom", logProjects)

const EmptyProjects: ProjectsResponse[] = []
export const projectsAtom = atom((get) => {
    const res = get(projectsQueryAtom)
    return (res as any)?.data ?? EmptyProjects
})

const _projectBelongsToWorkspace = (project: ProjectsResponse, workspaceId: string) => {
    if (project.workspace_id && project.workspace_id === workspaceId) return true
    if (project.organization_id && project.organization_id === workspaceId) return true
    return false
}

const projectMatchesWorkspace = (project: ProjectsResponse, workspaceId: string) => {
    if (!workspaceId) return false
    if (project.workspace_id && project.workspace_id === workspaceId) return true
    if (project.organization_id && project.organization_id === workspaceId) return true
    return false
}

const pickPreferredProject = (
    projects: ProjectsResponse[],
    workspaceId: string | null,
    lastUsedProjectId: string | null,
) => {
    if (!projects.length) return null

    if (lastUsedProjectId) {
        const lastUsed = projects.find((project) => project.project_id === lastUsedProjectId)
        if (lastUsed && projectMatchesWorkspace(lastUsed, workspaceId ?? lastUsed.workspace_id)) {
            return lastUsed
        }
    }

    const workspaceProjects = workspaceId
        ? projects.filter((project) => projectMatchesWorkspace(project, workspaceId))
        : []

    const workspaceDefault = workspaceProjects.find((project) => project.is_default_project)
    if (workspaceDefault) return workspaceDefault

    if (workspaceProjects.length) {
        const workspaceNonDemo = workspaceProjects.find((project) => !project.is_demo)
        if (workspaceNonDemo) return workspaceNonDemo
        return workspaceProjects[0]
    }

    const globalDefault = projects.find((project) => project.is_default_project)
    if (globalDefault) return globalDefault

    const nonDemo = projects.filter((project) => !project.is_demo)
    if (nonDemo.length) return nonDemo[0]

    return projects[0]
}

export const projectIdAtom = atom((get) => get(appIdentifiersAtom).projectId)

export const projectAtom = atom((get) => {
    const projects = get(projectsAtom) as ProjectsResponse[]
    const organization = get(selectedOrgAtom)
    const workspaceId = organization?.default_workspace?.id || null
    const projectId = get(projectIdAtom)

    if (!projects.length) return null

    if (projectId) {
        const selectedProject = projects.find((project) => project.project_id === projectId)
        if (selectedProject) return selectedProject
    }

    const lastUsedProjectId = readLastUsedProjectId(workspaceId)

    const preferred = pickPreferredProject(projects, workspaceId, lastUsedProjectId)
    if (preferred) return preferred

    return projects[0] ?? null
})

export const projectNavigationAtom = atom(null, (get, set, next: string | null) => {
    const {workspaceId, projectId} = get(appIdentifiersAtom)
    const target = typeof next === "function" ? (next as any)(projectId) : next

    if (!workspaceId) return

    if (!target) {
        const base = `/w/${encodeURIComponent(workspaceId)}`
        set(requestNavigationAtom, {type: "href", href: base, method: "replace"})
        return
    }

    if (target === projectId) return

    const href = `/w/${encodeURIComponent(workspaceId)}/p/${encodeURIComponent(target)}/apps`
    set(requestNavigationAtom, {type: "href", href, method: "push"})
})

export const resetProjectDataAtom = atom(null, async () => {
    await queryClient.removeQueries({queryKey: ["projects"]})
})
