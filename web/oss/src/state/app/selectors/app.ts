import type {Workflow} from "@agenta/entities/workflow"
import {eagerAtom} from "jotai-eager"

import {appsQueryAtom, routerAppIdAtom, recentAppIdAtom} from "../atoms/fetcher"

const EmptyApps: Workflow[] = []
export const appsAtom = eagerAtom<Workflow[]>((get) => {
    return get(appsQueryAtom).data ?? EmptyApps
})

export const selectedAppIdAtom = eagerAtom<string | null>((get) => {
    return get(routerAppIdAtom) || get(recentAppIdAtom) || null
})

/**
 * @deprecated for new code. Use `currentWorkflowAtom` from `@/oss/state/workflow`
 * for workflow-typed access (resolves both app and evaluator workflows by URL ID).
 * Existing callers remain supported — `currentAppAtom` still resolves apps only.
 *
 * The two atom trees (`state/app/` and `state/workflow/`) are independent and
 * parallel; neither derives from the other. They share underlying entity-package
 * query atoms.
 */
export const currentAppAtom = eagerAtom<Workflow | null>((get) => {
    const apps = get(appsAtom)
    const appId = get(routerAppIdAtom) || get(recentAppIdAtom)
    if (!appId) return null
    return apps.find((a) => a.id === appId) || null
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
        loading: isLoading,
    }
})
