import {activeUserIdAtom, userScopedFlagAtom} from "@agenta/shared/state"
import {atom, useAtomValue} from "jotai"
import {atomFamily} from "jotai-family"

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

/** The user's own switch for one view in the `preview` stage. Keyed by view id. */
export const developerViewPreviewAtomFamily = atomFamily((viewId: string) =>
    userScopedFlagAtom(`developer-view:${viewId}`),
)

export const isDeveloperViewEnabled = (
    view: DeveloperView,
    {previewOptedIn, forcedIds}: {previewOptedIn: boolean; forcedIds: ReadonlySet<string>},
): boolean =>
    forcedIds.has(view.id) || view.stage === "on" || (view.stage === "preview" && previewOptedIn)

const NO_VIEWS: readonly DeveloperView[] = []

/**
 * The enabled views, or `null` until the signed-in user is known.
 *
 * Null on the first render on purpose: the user's preferences and the runtime env are both
 * browser-only, so answering before the user settles would differ from the prerendered HTML.
 */
export const enabledDeveloperViewsAtom = atom((get): readonly DeveloperView[] | null => {
    if (!get(activeUserIdAtom)) return null
    const forcedIds = readForcedDeveloperViewIds()
    return DEVELOPER_VIEWS.filter((view) =>
        isDeveloperViewEnabled(view, {
            previewOptedIn: get(developerViewPreviewAtomFamily(view.id)),
            forcedIds,
        }),
    )
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

export interface DeveloperViewPreviewSwitch {
    view: DeveloperView
    optedIn: boolean
}

/**
 * One Preferences switch per view in `preview`, and its setter keyed by view id. A view the
 * deployment forces on gets no switch: it would change nothing. Empty until the user is known,
 * for the same reason as above.
 */
export const developerViewPreviewSwitchesAtom = atom(
    (get): readonly DeveloperViewPreviewSwitch[] => {
        if (!get(activeUserIdAtom)) return []
        const forcedIds = readForcedDeveloperViewIds()
        return DEVELOPER_VIEWS.filter(
            (view) => view.stage === "preview" && !forcedIds.has(view.id),
        ).map((view) => ({view, optedIn: get(developerViewPreviewAtomFamily(view.id))}))
    },
    (_get, set, {viewId, optedIn}: {viewId: string; optedIn: boolean}) =>
        set(developerViewPreviewAtomFamily(viewId), optedIn),
)
