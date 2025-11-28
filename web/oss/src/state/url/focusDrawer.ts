import {getDefaultStore} from "jotai"
import Router from "next/router"

import {
    focusDrawerAtom as previewFocusDrawerAtom,
    openFocusDrawerAtom as openPreviewFocusDrawerAtom,
    resetFocusDrawerAtom as resetPreviewFocusDrawerAtom,
    setFocusDrawerTargetAtom as setPreviewFocusDrawerTargetAtom,
} from "@/oss/components/EvalRunDetails2/state/focusDrawerAtom"
import {navigationRequestAtom, type NavigationCommand} from "@/oss/state/appState"

const isBrowser = typeof window !== "undefined"

export const FOCUS_SCENARIO_QUERY_KEY = "focusScenarioId"
export const FOCUS_RUN_QUERY_KEY = "focusRunId"

const ensureCleanFocusParams = (url: URL) => {
    let mutated = false
    if (url.searchParams.get(FOCUS_SCENARIO_QUERY_KEY)?.trim() === "") {
        url.searchParams.delete(FOCUS_SCENARIO_QUERY_KEY)
        mutated = true
    }
    if (url.searchParams.get(FOCUS_RUN_QUERY_KEY)?.trim() === "") {
        url.searchParams.delete(FOCUS_RUN_QUERY_KEY)
        mutated = true
    }
    if (!mutated) return false

    const newPath = `${url.pathname}${url.search}${url.hash}`
    void Router.replace(newPath, undefined, {shallow: true}).catch((error) => {
        console.error("Failed to normalize focus drawer query params:", error)
    })
    return true
}

export const syncFocusDrawerStateFromUrl = (nextUrl?: string) => {
    if (!isBrowser) return

    try {
        const store = getDefaultStore()
        const url = new URL(nextUrl ?? window.location.href, window.location.origin)

        const rawScenario = url.searchParams.get(FOCUS_SCENARIO_QUERY_KEY)
        const rawRun = url.searchParams.get(FOCUS_RUN_QUERY_KEY)
        const pendingNav = store.get(navigationRequestAtom) as NavigationCommand | null

        const scenarioId = rawScenario?.trim() || undefined
        const runId = rawRun?.trim() || undefined

        const focusTargets = [
            {
                currentState: store.get(previewFocusDrawerAtom),
                setTargetAtom: setPreviewFocusDrawerTargetAtom,
                openAtom: openPreviewFocusDrawerAtom,
                resetAtom: resetPreviewFocusDrawerAtom,
            },
        ] as const

        // Clean up empty params before processing
        if (ensureCleanFocusParams(url)) {
            // After normalising the URL we bail out; the router callback will re-run with clean params
            return
        }

        if (!scenarioId) {
            const pendingScenarioPatch =
                pendingNav?.type === "patch-query"
                    ? pendingNav.patch[FOCUS_SCENARIO_QUERY_KEY]
                    : undefined
            const hasPendingScenario =
                pendingScenarioPatch !== undefined &&
                (Array.isArray(pendingScenarioPatch)
                    ? pendingScenarioPatch.length > 0
                    : String(pendingScenarioPatch ?? "").length > 0)
            if (hasPendingScenario) {
                return
            }

            const urlProvided = typeof nextUrl === "string" && nextUrl.length > 0

            focusTargets.forEach(({currentState, resetAtom}) => {
                if (!currentState) return
                const hasStoredTarget =
                    currentState.focusScenarioId != null || currentState.focusRunId != null
                const shouldReset =
                    currentState.isClosing ||
                    (!currentState.open && hasStoredTarget) ||
                    (urlProvided && currentState.open && hasStoredTarget && !currentState.isClosing)

                if (shouldReset) {
                    store.set(resetAtom, null)
                }
            })
            return
        }

        focusTargets.forEach(({currentState, setTargetAtom, openAtom}) => {
            if (!currentState) return

            const nextTarget = {
                focusScenarioId: scenarioId,
                focusRunId: runId ?? currentState.focusRunId ?? null,
            }

            const alreadyOpen =
                currentState.open &&
                currentState.focusScenarioId === nextTarget.focusScenarioId &&
                currentState.focusRunId === nextTarget.focusRunId

            if (alreadyOpen && !currentState.isClosing) {
                return
            }

            store.set(setTargetAtom, nextTarget)
            store.set(openAtom, nextTarget)
        })
    } catch (err) {
        console.error("Failed to sync focus drawer state from URL:", nextUrl, err)
    }
}

export const clearFocusDrawerQueryParams = () => {
    if (!isBrowser) return
    try {
        const url = new URL(window.location.href)
        let mutated = false
        if (url.searchParams.has(FOCUS_SCENARIO_QUERY_KEY)) {
            url.searchParams.delete(FOCUS_SCENARIO_QUERY_KEY)
            mutated = true
        }
        if (url.searchParams.has(FOCUS_RUN_QUERY_KEY)) {
            url.searchParams.delete(FOCUS_RUN_QUERY_KEY)
            mutated = true
        }
        if (!mutated) return
        const newPath = `${url.pathname}${url.search}${url.hash}`
        void Router.replace(newPath, undefined, {shallow: true}).catch((error) => {
            console.error("Failed to clear focus drawer query params:", error)
        })
    } catch (err) {
        console.error("Failed to clear focus drawer query params:", err)
    }
}

export interface FocusDrawerPublicApi {
    syncFocusDrawerStateFromUrl: (nextUrl?: string) => void
    clearFocusDrawerQueryParams: () => void
}

export default {
    syncFocusDrawerStateFromUrl,
    clearFocusDrawerQueryParams,
} satisfies FocusDrawerPublicApi
