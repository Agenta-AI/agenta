import {projectIdAtom} from "@agenta/shared/state"
import {atomFamily} from "jotai-family"
import {atomWithQuery} from "jotai-tanstack-query"

import {fetchBrowserLiveStatus} from "./api"

/** Polls while mounted: the agent starts its browser in the middle of a turn. */
export const browserLiveStatusQueryAtomFamily = atomFamily((sessionId: string) =>
    atomWithQuery((get) => {
        const projectId = get(projectIdAtom)
        return {
            queryKey: ["browser-live-status", projectId, sessionId],
            queryFn: () => fetchBrowserLiveStatus(projectId as string, sessionId),
            refetchInterval: 10_000,
            refetchOnWindowFocus: false,
            enabled: !!projectId && !!sessionId,
        }
    }),
)
