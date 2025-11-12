import {useCallback} from "react"

import {useQueryClient} from "@tanstack/react-query"
import {useAtom, useAtomValue} from "jotai"

import {profileQueryAtom, userAtom} from "./selectors/user"

export const useProfileData = () => {
    const [{data, isLoading, refetch}] = useAtom(profileQueryAtom)
    const queryClient = useQueryClient()

    const reset = useCallback(async () => {
        await queryClient.invalidateQueries({queryKey: ["profile"]})
        await queryClient.invalidateQueries({queryKey: ["organizations"]})
    }, [queryClient])

    return {
        user: data ?? null,
        loading: isLoading,
        reset,
        refetch,
    }
}

export const useUser = () => useAtomValue(userAtom)
