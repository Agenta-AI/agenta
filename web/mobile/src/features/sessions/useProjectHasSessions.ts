import {rowsFromPages, useSessionList} from "@agenta/sessions/state"

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
        hasSessions: rowsFromPages(probe.data?.pages).length > 0,
    }
}
