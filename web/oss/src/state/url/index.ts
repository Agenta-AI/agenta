import {getDefaultStore} from "jotai"
import {eagerAtom} from "jotai-eager"

import {appStateSnapshotAtom} from "@/oss/state/appState"
import {selectedOrgAtom} from "@/oss/state/org/selectors/org"

import {recentAppIdAtom} from "../app"

export interface URLState {
    appId: string
    workspaceId: string
    workspaceName: string
    projectId: string | null
    baseOrgURL: string
    orgURL: string
    baseProjectURL: string
    projectURL: string
    baseAppURL: string
    recentlyVisitedAppURL: string
    appURL: string
}

export const urlAtom = eagerAtom<URLState>((get) => {
    const snapshot = get(appStateSnapshotAtom)
    const selectedOrg = get(selectedOrgAtom)
    const recentlyVisitedAppId = get(recentAppIdAtom)
    const {projectId, appId} = snapshot

    const workspaceName = selectedOrg?.name ?? ""
    const resolvedWorkspaceId = selectedOrg?.default_workspace?.id || ""

    const baseOrgURL = "/w"
    // Build URLs with workspace id (not name)
    const orgURL = resolvedWorkspaceId
        ? `${baseOrgURL}/${encodeURIComponent(resolvedWorkspaceId)}`
        : ""
    const baseProjectURL = resolvedWorkspaceId ? `${orgURL}/p` : ""
    const projectURL =
        resolvedWorkspaceId && projectId ? `${baseProjectURL}/${encodeURIComponent(projectId)}` : ""
    const baseAppURL = resolvedWorkspaceId && projectId ? `${projectURL}/apps` : ""
    const appURL =
        resolvedWorkspaceId && projectId && appId
            ? `${baseAppURL}/${encodeURIComponent(appId)}`
            : ""

    const recentlyVisitedAppURL =
        resolvedWorkspaceId && projectId && recentlyVisitedAppId
            ? `${baseAppURL}/${encodeURIComponent(recentlyVisitedAppId)}`
            : ""

    return {
        appId: appId ?? "",
        workspaceId: resolvedWorkspaceId,
        workspaceName,
        projectId: projectId ?? null,
        baseOrgURL,
        orgURL,
        baseProjectURL,
        projectURL,
        baseAppURL,
        appURL,
        recentlyVisitedAppURL,
    }
})

export const getURLValues = () => {
    const store = getDefaultStore()
    return store.get(urlAtom)
}

export interface WaitForUrlOptions {
    // Wait until org is known
    requireOrg?: boolean
    // Wait until projectId-backed URLs are available
    requireProject?: boolean
    // Wait until appId-backed URLs are available
    requireApp?: boolean
    // Maximum time to wait before resolving with a best-effort URL
    timeoutMs?: number
}

const satisfies = (state: URLState, opts: WaitForUrlOptions) => {
    const {requireOrg = false, requireProject = true, requireApp = false} = opts || {}
    if (requireOrg && !state.workspaceName) return false
    if (requireProject && !state.baseProjectURL) return false
    if (requireApp && !state.appURL) return false
    // For project-level readiness also ensure baseAppURL is known for convenience
    if (requireProject && !state.baseAppURL) return false
    return true
}

// Promise that resolves when URL state becomes valid per options
export const waitForValidURL = (options: WaitForUrlOptions = {}): Promise<URLState> => {
    const store = getDefaultStore()

    return new Promise<URLState>((resolve) => {
        let unsub: () => void = () => {}

        const check = () => {
            const current = store.get(urlAtom)
            if (process.env.NEXT_PUBLIC_APP_STATE_DEBUG === "true") {
                console.log("[url] waitForValidURL:tick", {
                    time: new Date().toISOString(),
                    current,
                    options,
                })
            }
            if (satisfies(current, options)) {
                unsub()
                resolve(current)
            }
        }

        unsub = store.sub(urlAtom, check)
        check()
    })
}

export {clearSessionParamAtom} from "./session"
export {clearTraceParamAtom} from "./trace"
