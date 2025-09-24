import {getDefaultStore} from "jotai"
import {eagerAtom} from "jotai-eager"

import {recentAppIdAtom, routerAppIdAtom} from "@/oss/state/app/atoms/fetcher"
import {selectedOrgAtom} from "@/oss/state/org/selectors/org"
import {projectIdAtom} from "@/oss/state/project/selectors/project"

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
    appURL: string
}

export const urlAtom = eagerAtom<URLState>((get) => {
    const selectedOrg = get(selectedOrgAtom)
    const projectId = get(projectIdAtom) as string | null
    const routerAppId = get(routerAppIdAtom)
    const recentAppId = get(recentAppIdAtom)

    const workspaceName = selectedOrg?.name ?? ""
    const workspaceId = selectedOrg?.id ?? ""
    const appId = (routerAppId ?? recentAppId ?? "") || ""

    const baseOrgURL = "/w"
    // Build URLs with workspace id (not name)
    const orgURL = workspaceId ? `${baseOrgURL}/${workspaceId}` : ""
    const baseProjectURL = workspaceId ? `${orgURL}/p` : ""
    const projectURL = workspaceId && projectId ? `${baseProjectURL}/${projectId}` : ""
    const baseAppURL = workspaceId && projectId ? `${projectURL}/apps` : ""
    const appURL = workspaceId && projectId && appId ? `${baseAppURL}/${appId}` : ""

    return {
        appId,
        workspaceId,
        workspaceName,
        projectId,
        baseOrgURL,
        orgURL,
        baseProjectURL,
        projectURL,
        baseAppURL,
        appURL,
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
            if (satisfies(current, options)) {
                unsub()
                resolve(current)
            }
        }

        // Subscribe then check immediately in case it's already ready
        unsub = store.sub(urlAtom, check)
        check()
    })
}
