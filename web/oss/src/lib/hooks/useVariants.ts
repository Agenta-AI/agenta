import {useCallback, useMemo} from "react"

import {useQueryClient} from "@tanstack/react-query"
import {useAtomValue} from "jotai"

import {variantsAtom} from "@/oss/state/variant/atoms/fetcher"

import type {ListAppsItem, Variant} from "../Types"
export interface VariantsHookResult {
    data: Variant[] | undefined
    mutate: () => Promise<void>
    isLoading: boolean
}

export const useVariants = (
    _app: Pick<ListAppsItem, "app_type" | "app_id"> | null,
    initialVariants?: Variant[],
) => {
    const data = useAtomValue(variantsAtom)
    const queryClient = useQueryClient()

    const mutate = useCallback(async () => {
        await queryClient.invalidateQueries({queryKey: ["variants"]})
    }, [])

    const filteredData = useMemo(() => {
        if (!initialVariants) return data
        const initialIds = initialVariants.map((v) => v.id)
        return data.filter((v) => initialIds.includes(v.id))
    }, [data, initialVariants])

    return {
        data: filteredData,
        mutate,
        isLoading: data === undefined,
    }
}

export default useVariants
