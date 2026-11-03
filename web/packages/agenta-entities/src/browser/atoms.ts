import {projectIdAtom} from "@agenta/shared/state"
import {atomFamily} from "jotai-family"
import {atomWithQuery} from "jotai-tanstack-query"

import {fetchBrowserLiveStatus} from "./api"

/** Fetches once per mount; the caller refetches while a turn runs, since only a turn starts a browser. */
export const browserLiveStatusQueryAtomFamily = atomFamily((sessionId: string) =>
    atomWithQuery((get) => {
        const projectId = get(projectIdAtom)
        return {
            queryKey: ["browser-live-status", projectId, sessionId],
            queryFn: () => fetchBrowserLiveStatus(projectId as string, sessionId),
            refetchOnWindowFocus: false,
            enabled: !!projectId && !!sessionId,
        }
    }),
)
