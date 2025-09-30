import {getDefaultStore, type Store} from "jotai"

import type {ProjectsResponse} from "@/oss/services/project/types"
import {appIdentifiersAtom} from "@/oss/state/appState"
import {orgsAtom, resolvePreferredWorkspaceId, selectedOrgIdAtom} from "@/oss/state/org"
import {userAtom} from "@/oss/state/profile/selectors/user"
import {projectAtom, projectsAtom} from "@/oss/state/project"

const MAX_WAIT_MS = 4000

export interface WaitForWorkspaceContextOptions {
    timeoutMs?: number
    requireProjectId?: boolean
    requireWorkspaceId?: boolean
    requireOrgData?: boolean
}

const projectMatchesWorkspace = (project: ProjectsResponse, workspaceId: string) => {
    if (project.workspace_id && project.workspace_id === workspaceId) return true
    if (project.organization_id && project.organization_id === workspaceId) return true
    return false
}

const pickPreferredProject = (
    projects: ProjectsResponse[],
    workspaceId: string | null,
): ProjectsResponse | null => {
    if (!Array.isArray(projects) || projects.length === 0) return null

    const scoped = workspaceId
        ? projects.filter((project) => projectMatchesWorkspace(project, workspaceId))
        : projects

    const nonDemoScoped = scoped.find((project) => !project.is_demo)
    if (nonDemoScoped) return nonDemoScoped

    if (scoped.length > 0) return scoped[0]

    const nonDemoAny = projects.find((project) => !project.is_demo)
    return nonDemoAny ?? projects[0]
}

export interface WorkspaceContext {
    workspaceId: string | null
    projectId: string | null
}

const computeWorkspaceContext = (store: Store): WorkspaceContext => {
    const identifiers = store.get(appIdentifiersAtom)
    const userId = (store.get(userAtom) as {id?: string} | null)?.id ?? null
    let workspaceId = identifiers.workspaceId
    let projectId = identifiers.projectId

    if (!workspaceId) {
        workspaceId = store.get(selectedOrgIdAtom) ?? null
    }

    if (!workspaceId) {
        const orgs = store.get(orgsAtom)
        workspaceId = resolvePreferredWorkspaceId(userId, orgs)
    }

    if (workspaceId && !projectId) {
        const projects = store.get(projectsAtom) as ProjectsResponse[]
        const preferred = pickPreferredProject(projects, workspaceId)
        projectId = preferred?.project_id ?? null
        if (!projectId) {
            const fallbackProject = store.get(projectAtom)
            projectId = fallbackProject?.project_id ?? null
        }
    }

    return {workspaceId: workspaceId ?? null, projectId: projectId ?? null}
}

export const waitForWorkspaceContext = async (
    options: number | WaitForWorkspaceContextOptions = {},
) => {
    const store = getDefaultStore()
    const normalizedOptions =
        typeof options === "number"
            ? {
                  timeoutMs: options,
                  requireProjectId: true,
                  requireWorkspaceId: true,
                  requireOrgData: false,
              }
            : {
                  timeoutMs: options.timeoutMs ?? MAX_WAIT_MS,
                  requireProjectId: options.requireProjectId ?? true,
                  requireWorkspaceId: options.requireWorkspaceId ?? true,
                  requireOrgData: options.requireOrgData ?? false,
              }

    const {timeoutMs, requireProjectId, requireWorkspaceId, requireOrgData} = normalizedOptions

    return new Promise<WorkspaceContext>((resolve) => {
        let settled = false
        const start = Date.now()
        const unsubscribers: (() => void)[] = []

        const finalize = (value: WorkspaceContext) => {
            if (settled) return
            settled = true
            unsubscribers.forEach((unsub) => unsub())
            resolve(value)
        }

        const evaluate = () => {
            const context = computeWorkspaceContext(store)
            const orgs = store.get(orgsAtom)
            const elapsed = Date.now() - start

            const hasWorkspace = Boolean(context.workspaceId)
            const hasProject = Boolean(context.projectId)
            const orgsReady = Array.isArray(orgs) && orgs.length > 0

            const workspaceSatisfied = !requireWorkspaceId || hasWorkspace
            const projectSatisfied = !requireProjectId || hasProject
            const orgSatisfied = !requireOrgData || orgsReady || hasWorkspace

            if (workspaceSatisfied && projectSatisfied && orgSatisfied) {
                finalize(context)
                return true
            }

            if (elapsed >= timeoutMs) {
                finalize(context)
                return true
            }

            return false
        }

        if (evaluate()) return

        unsubscribers.push(
            store.sub(projectsAtom, evaluate),
            store.sub(projectAtom, evaluate),
            store.sub(selectedOrgIdAtom, evaluate),
            store.sub(orgsAtom, evaluate),
            store.sub(userAtom, evaluate),
        )

        setTimeout(() => finalize(computeWorkspaceContext(store)), timeoutMs)
    })
}

export const buildPostLoginPath = ({workspaceId, projectId}: WorkspaceContext) => {
    if (workspaceId && projectId) {
        return `/w/${encodeURIComponent(workspaceId)}/p/${encodeURIComponent(projectId)}/apps`
    }
    if (workspaceId) {
        return `/w/${encodeURIComponent(workspaceId)}`
    }
    return "/w"
}
