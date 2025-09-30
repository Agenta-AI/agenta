import deepEqual from "fast-deep-equal"
import {atom} from "jotai"
import {selectAtom, unwrap} from "jotai/utils"
import {eagerAtom} from "jotai-eager"
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
const debugProjectSelection = process.env.NEXT_PUBLIC_APP_STATE_DEBUG === "true"
logAtom(projectsQueryAtom, "projectsQueryAtom", logProjects)

const EmptyProjects: ProjectsResponse[] = []
export const projectsAtom = selectAtom(
    unwrap(projectsQueryAtom),
    (res) => (res as any)?.data ?? EmptyProjects,
    deepEqual,
)

const projectBelongsToWorkspace = (project: ProjectsResponse, workspaceId: string) => {
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

const pickPreferredProject = (projects: ProjectsResponse[], workspaceId: string | null) => {
    if (!projects.length) return null

    const nonDemo = projects.filter((project) => !project.is_demo)
    if (workspaceId) {
        const workspaceMatch = projects.find(
            (project) => projectMatchesWorkspace(project, workspaceId) && !project.is_demo,
        )
        if (workspaceMatch) return workspaceMatch

        const workspaceAny = projects.find((project) =>
            projectMatchesWorkspace(project, workspaceId),
        )
        if (workspaceAny) return workspaceAny
    }

    if (nonDemo.length) return nonDemo[0]
    return projects[0]
}

export const projectAtom = eagerAtom((get) => {
    const projects = get(projectsAtom) as ProjectsResponse[]
    const org = get(selectedOrgAtom)
    const workspaceId = org?.default_workspace?.id ?? null

    if (!projects.length) return null

    const preferred = pickPreferredProject(projects, workspaceId)
    if (preferred) return preferred

    return projects[0] ?? null
})

export const projectIdAtom = atom((get) => get(appIdentifiersAtom).projectId)

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
