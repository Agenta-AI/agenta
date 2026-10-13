import {getHostQueryClient} from "@agenta/shared/api"
import {projectIdAtom} from "@agenta/shared/state"
import {atom} from "jotai"
import {atomFamily} from "jotai-family"
import {atomWithQuery} from "jotai-tanstack-query"

import {
    archiveBrowserProfile,
    cancelBrowserLogin,
    createBrowserProfile,
    fetchBrowserLiveStatus,
    finishBrowserLogin,
    queryBrowserProfiles,
    startBrowserLogin,
    updateBrowserProfile,
} from "./api"

const PROFILES_KEY = "browser-profiles"

export const browserProfilesQueryAtom = atomWithQuery((get) => {
    const projectId = get(projectIdAtom)
    return {
        queryKey: [PROFILES_KEY, projectId],
        queryFn: () => queryBrowserProfiles(projectId as string),
        staleTime: 30_000,
        refetchOnWindowFocus: false,
        enabled: !!projectId,
    }
})

/** Polls while mounted: a session's browser starts mid-run. */
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

const profileMutation = <Args, Result>(run: (projectId: string, args: Args) => Promise<Result>) =>
    atom(null, async (get, _set, args: Args): Promise<Result> => {
        const projectId = get(projectIdAtom)
        if (!projectId) throw new Error("No project is selected.")
        const result = await run(projectId, args)
        await getHostQueryClient().invalidateQueries({queryKey: [PROFILES_KEY]})
        return result
    })

export const createBrowserProfileAtom = profileMutation(createBrowserProfile)
export const updateBrowserProfileAtom = profileMutation(updateBrowserProfile)
export const archiveBrowserProfileAtom = profileMutation(archiveBrowserProfile)
export const startBrowserLoginAtom = profileMutation(startBrowserLogin)
export const finishBrowserLoginAtom = profileMutation(finishBrowserLogin)
export const cancelBrowserLoginAtom = profileMutation(cancelBrowserLogin)
