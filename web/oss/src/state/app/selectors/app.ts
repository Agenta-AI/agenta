import type {Workflow} from "@agenta/entities/workflow"
import {atom} from "jotai"
import {eagerAtom} from "jotai-eager"

import {
    appsQueryAtom,
    currentAppQueryAtom,
    routerAppIdAtom,
    recentAppIdAtom,
} from "../atoms/fetcher"

const EmptyApps: Workflow[] = []
export const appsAtom = eagerAtom<Workflow[]>((get) => {
    return get(appsQueryAtom).data ?? EmptyApps
})

export const selectedAppIdAtom = eagerAtom<string | null>((get) => {
    return get(routerAppIdAtom) || get(recentAppIdAtom) || null
})

export const currentAppAtom = atom<Workflow | null>((get) => {
    const appId = get(routerAppIdAtom) || get(recentAppIdAtom)
    if (!appId) return null
    const query = get(currentAppQueryAtom) as {data?: Workflow | null}
    return query.data ?? null
})

// Convenience re-exports for consumers needing raw ID atoms
export {routerAppIdAtom, recentAppIdAtom}

/**
 * Current app context - provides full context for current app
 * Used by: Components that need current app info
 */
export const currentAppContextAtom = eagerAtom((get) => {
    const currentApp = get(currentAppAtom)
    const selectedId = get(selectedAppIdAtom)
    const {isLoading} = get(appsQueryAtom)
    const currentAppQuery = get(currentAppQueryAtom) as {isPending?: boolean}

    return {
        app: currentApp,
        appId: selectedId,
        appName: currentApp?.name ?? currentApp?.slug ?? null,
        appType: currentApp?.flags?.is_custom
            ? "custom"
            : currentApp?.flags?.is_chat
              ? "chat"
              : currentApp
                ? "completion"
                : null,
        hasApp: !!currentApp,
        loading: isLoading || (!currentApp && !!selectedId && !!currentAppQuery.isPending),
    }
})
