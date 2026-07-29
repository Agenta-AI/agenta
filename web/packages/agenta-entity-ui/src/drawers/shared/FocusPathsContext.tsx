/**
 * FocusPathsContext
 *
 * Narrows a config surface to just the properties that matter right now — the section's REAL
 * controls, filtered, rather than a second rendering of them.
 *
 * This is the general form of the Model & harness "Connect key" affordance: when something needs
 * attention, show the control that owns it and link out for the rest. "Needs a key" and "changed
 * since the commit" are then the same pattern with different filters, over one set of controls.
 *
 * Mechanism: rows already declare their `path` (see {@link RailField}), so a filter is all that's
 * needed — a focused row renders itself, an unfocused one renders nothing, and the group that owns
 * no focused path hides. No parallel "what changed" UI to build or keep in sync.
 *
 * Inactive by default (no provider = everything renders), so the drawers and every other host are
 * untouched.
 */
import {createContext, useContext, useMemo, type ReactNode} from "react"

export interface FocusPaths {
    /** A filter is in force — rows and groups outside it hide. */
    active: boolean
    /** Whether this exact property is in focus. */
    isFocused: (path: string) => boolean
    /** Whether this dotted subtree contains anything in focus (does this group survive?). */
    hasFocusUnder: (prefix: string) => boolean
}

/** No filter: everything renders. */
const NONE: FocusPaths = {active: false, isFocused: () => true, hasFocusUnder: () => true}

const FocusPathsContext = createContext<FocusPaths>(NONE)

export function FocusPathsProvider({
    paths,
    children,
}: {
    /** The properties to narrow to. `null` = no filter (render everything). */
    paths: string[] | null
    children: ReactNode
}) {
    const value = useMemo<FocusPaths>(() => {
        if (!paths) return NONE
        const set = new Set(paths)
        return {
            active: true,
            isFocused: (path) => set.has(path),
            hasFocusUnder: (prefix) =>
                [...set].some((path) => path === prefix || path.startsWith(`${prefix}.`)),
        }
    }, [paths])
    return <FocusPathsContext.Provider value={value}>{children}</FocusPathsContext.Provider>
}

/** The active filter — for a caller that needs to branch on it (e.g. flat vs grouped chrome). */
export function useFocusPaths(): FocusPaths {
    return useContext(FocusPathsContext)
}

/** Whether a row should render: true unless a filter is in force that excludes it. A row with no
 *  `path` can't be matched, so it hides under a filter rather than leaking in as noise. */
export function useIsPathVisible(path: string | undefined): boolean {
    const focus = useContext(FocusPathsContext)
    return useMemo(() => !focus.active || (!!path && focus.isFocused(path)), [focus, path])
}

/** Whether a group survives the filter — i.e. it owns at least one focused property. */
export function useHasFocusUnder(prefix: string | undefined): boolean {
    const focus = useContext(FocusPathsContext)
    return useMemo(
        () => !focus.active || (!!prefix && focus.hasFocusUnder(prefix)),
        [focus, prefix],
    )
}
