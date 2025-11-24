import {getDefaultStore} from "jotai"
import Router from "next/router"

import {
    applyFocusDrawerStateAtom,
    closeFocusDrawerAtom,
    focusDrawerAtom,
    openFocusDrawerAtom,
    resetFocusDrawerAtom,
    setFocusDrawerTargetAtom,
    type FocusTarget,
} from "./focusDrawerAtom"

import {navigationRequestAtom, type NavigationCommand} from "@/oss/state/appState"

const isBrowser = typeof window !== "undefined"
const debugEnabled = process.env.NEXT_PUBLIC_EVAL_RUN_DEBUG === "true"

const logDebug = (...args: any[]) => {
    if (!debugEnabled) return
    // eslint-disable-next-line no-console
    console.info("[EvalRunDetails2][FocusDrawer][urlSync]", ...args)
}

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

        const currentState = store.get(focusDrawerAtom)
        logDebug("sync from url", {nextUrl, scenarioId, runId, currentState})

        if (ensureCleanFocusParams(url)) {
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

            const hasStoredTarget =
                currentState.focusScenarioId != null || currentState.focusRunId != null
            const urlProvided = typeof nextUrl === "string" && nextUrl.length > 0
            const shouldReset =
                currentState.isClosing ||
                (!currentState.open && hasStoredTarget) ||
                (urlProvided && currentState.open && hasStoredTarget && !currentState.isClosing)

            if (shouldReset) {
                store.set(resetFocusDrawerAtom, null)
            }
            logDebug("sync: no scenario, reset", {shouldReset, currentState})
            return
        }

        const nextTarget: FocusTarget = {
            focusScenarioId: scenarioId,
            focusRunId: runId ?? currentState.focusRunId ?? null,
        }

        const alreadyOpen =
            currentState.open &&
            currentState.focusScenarioId === nextTarget.focusScenarioId &&
            currentState.focusRunId === nextTarget.focusRunId

        if (alreadyOpen && !currentState.isClosing) {
            logDebug("sync: already open", {nextTarget})
            return
        }

        logDebug("sync: opening", {nextTarget})
        store.set(setFocusDrawerTargetAtom, nextTarget)
        store.set(openFocusDrawerAtom, nextTarget)
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

export const patchFocusDrawerQueryParams = ({focusRunId, focusScenarioId}: FocusTarget) => {
    if (!isBrowser || !focusScenarioId) return
    try {
        const store = getDefaultStore()
        const nextTarget: FocusTarget = {
            focusRunId: focusRunId ?? null,
            focusScenarioId,
        }
        store.set(applyFocusDrawerStateAtom, {
            ...nextTarget,
            open: true,
            isClosing: false,
        })
        store.set(setFocusDrawerTargetAtom, nextTarget)
        store.set(openFocusDrawerAtom, nextTarget)

        const url = new URL(window.location.href)
        url.searchParams.set(FOCUS_SCENARIO_QUERY_KEY, focusScenarioId)
        if (focusRunId) {
            url.searchParams.set(FOCUS_RUN_QUERY_KEY, focusRunId)
        } else {
            url.searchParams.delete(FOCUS_RUN_QUERY_KEY)
        }
        const newPath = `${url.pathname}${url.search}${url.hash}`
        logDebug("patch params", {nextTarget, newPath})
        void Router.replace(newPath, undefined, {shallow: true}).catch((error) => {
            console.error("Failed to update focus drawer query params:", error)
        })
        // Ensure local state reacts immediately, even if the router skips callbacks on shallow updates
        syncFocusDrawerStateFromUrl(newPath)
    } catch (err) {
        console.error("Failed to update focus drawer query params:", err)
    }
}

export const closeFocusDrawerAndClear = () => {
    const store = getDefaultStore()
    store.set(closeFocusDrawerAtom, null)
    clearFocusDrawerQueryParams()
}

export default {
    syncFocusDrawerStateFromUrl,
    clearFocusDrawerQueryParams,
    patchFocusDrawerQueryParams,
    closeFocusDrawerAndClear,
}
