import {activeUserIdAtom, betaDeveloperModeActiveAtom} from "@agenta/shared/state"
import {atom, useAtomValue} from "jotai"

import {getEnv} from "@/lib/env"

import {DEVELOPER_VIEWS, type DeveloperView} from "./developerViews"

/** Runtime env var: a comma-separated list of developer view ids this deployment forces on. */
export const DEVELOPER_VIEWS_ENV = "NEXT_PUBLIC_AGENTA_DEVELOPER_VIEWS"

export const readForcedDeveloperViewIds = (): ReadonlySet<string> =>
    new Set(
        getEnv(DEVELOPER_VIEWS_ENV)
            .split(",")
            .map((id) => id.trim().toLowerCase())
            .filter(Boolean),
    )

const NO_VIEWS: readonly DeveloperView[] = []

/**
 * The enabled views, or `null` until the signed-in user is known. Beta developer mode turns on
 * every view; without it, only the views the deployment forces on.
 *
 * Null on the first render on purpose: the beta flag and the runtime env are both browser-only,
 * so answering before the user settles would differ from the prerendered HTML.
 */
export const enabledDeveloperViewsAtom = atom((get): readonly DeveloperView[] | null => {
    if (!get(activeUserIdAtom)) return null
    if (get(betaDeveloperModeActiveAtom)) return DEVELOPER_VIEWS
    const forcedIds = readForcedDeveloperViewIds()
    return DEVELOPER_VIEWS.filter((view) => forcedIds.has(view.id))
})

/** The views the nav shows: none until the user is known. */
export const useEnabledDeveloperViews = (): readonly DeveloperView[] =>
    useAtomValue(enabledDeveloperViewsAtom) ?? NO_VIEWS

/** Whether this user may open the view, or `null` until the signed-in user is known. */
export const useDeveloperViewEnabled = (viewId: string): boolean | null => {
    const enabled = useAtomValue(enabledDeveloperViewsAtom)
    if (!enabled) return null
    return enabled.some((view) => view.id === viewId)
}
