import {useCallback} from "react"

import {useAtomValue} from "jotai"
import {queryClientAtom} from "jotai-tanstack-query"

import {closeChannelThread} from "../api"

/** The web equivalent of `!new` — the only write this domain exposes for threads. */
export const useChannelThreadActions = () => {
    const queryClient = useAtomValue(queryClientAtom)

    const close = useCallback(
        async (threadId: string) => {
            const result = await closeChannelThread(threadId)
            queryClient.invalidateQueries({queryKey: ["channels", "threads"]})
            return result
        },
        [queryClient],
    )

    return {close}
}
