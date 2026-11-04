import {isBrowserEnabled} from "@agenta/shared/api"
import {projectIdAtom} from "@agenta/shared/state"
import {atom} from "jotai"
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
            enabled: isBrowserEnabled() && !!projectId && !!sessionId,
        }
    }),
)

/** Whether the session's browser pane is open. Per session: the browser belongs to one. */
export const browserPaneOpenAtomFamily = atomFamily((_sessionId: string) => atom(false))
