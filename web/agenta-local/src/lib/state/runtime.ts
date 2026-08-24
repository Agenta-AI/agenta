import {atomWithQuery} from "jotai-tanstack-query"

import {localApi} from "@/lib/api/client"

export const runtimeQueryAtom = atomWithQuery(() => ({
    queryKey: ["local", "runtime"],
    queryFn: localApi.runtime,
    refetchInterval: 15_000,
    retry: 1,
}))

export const healthQueryAtom = atomWithQuery(() => ({
    queryKey: ["local", "health"],
    queryFn: localApi.health,
    staleTime: 30_000,
}))
