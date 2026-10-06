import {rowsFromPages, useSessionList} from "@agenta/sessions/state"

/**
 * What the probe says about the project. A failed probe is unknown, not empty: `undefined`, so a
 * caller cannot read an error as "no sessions" and teach onboarding over a project that has them.
 */
export const probeHasSessions = (probe: {
    isError: boolean
    data?: {pages?: Parameters<typeof rowsFromPages>[0]}
}): boolean | undefined => {
    if (rowsFromPages(probe.data?.pages).length > 0) return true
    return probe.isError ? undefined : false
}

/** Whether the project has any session at all, asked with every filter off; screen and table share it. */
export const useProjectHasSessions = (enabled: boolean) => {
    const probe = useSessionList({
        originPolicy: "all",
        expansions: [],
        includeArchived: true,
        limit: 1,
        enabled,
    })
    return {
        pending: probe.isPending,
        hasSessions: probeHasSessions(probe),
    }
}
