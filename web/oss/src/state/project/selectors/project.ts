import deepEqual from "fast-deep-equal"
import {selectAtom, unwrap} from "jotai/utils"
import {eagerAtom} from "jotai-eager"
import {atomWithQuery} from "jotai-tanstack-query"

import {isDemo} from "@/oss/lib/helpers/utils"
import {User} from "@/oss/lib/Types"
import {fetchAllProjects} from "@/oss/services/project"
import {ProjectsResponse} from "@/oss/services/project/types"

import {profileQueryAtom} from "../../newProfile"
import {selectedOrgQueryAtom} from "../../org/selectors/org"
import {selectedOrgAtom} from "../../org/selectors/org"
import {sessionExistsAtom} from "../../session"
import {logAtom} from "../../utils/logAtom"

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
        enabled: get(sessionExistsAtom) && !!(get(profileQueryAtom)?.data as User)?.id,
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

    if (isDemo()) {
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

export const projectIdAtom = eagerAtom((get) => {
    const p = get(projectAtom)
    const projectId = p?.project_id

    // In test environment, fall back to environment variable if project is not available
    if (!projectId && typeof process !== "undefined" && process.env.NODE_ENV === "test") {
        return process.env.VITEST_TEST_PROJECT_ID || process.env.TEST_PROJECT_ID
    }

    return projectId
})
