import {queryClient} from "@agenta/shared/api"
import {atomWithQuery} from "jotai-tanstack-query"

import {localApi} from "@/lib/api/client"
import type {ProviderInput} from "@/lib/api/types"

export const providerKeys = {all: ["local", "providers"] as const}

export const providersQueryAtom = atomWithQuery(() => ({
    queryKey: providerKeys.all,
    queryFn: localApi.listProviders,
    staleTime: 10_000,
    refetchOnWindowFocus: false,
}))

export async function saveProvider(provider: string, input: ProviderInput) {
    await localApi.putProvider(provider, input)
    await queryClient.invalidateQueries({queryKey: providerKeys.all})
}

export async function removeProvider(provider: string) {
    await localApi.deleteProvider(provider)
    await queryClient.invalidateQueries({queryKey: providerKeys.all})
}
