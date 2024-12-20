import {useCallback, useEffect, useRef} from "react"
import {BareFetcher, Key, SWRResponse} from "swr"
import {PlaygroundStateData, UsePlaygroundStateOptions} from "../types"
import isEqual from "lodash/isEqual"

const isVariantDirtyMiddleware = <D extends PlaygroundStateData = PlaygroundStateData>(
    useSWRNext: (
        key: string | Key,
        fetcher: BareFetcher<D> | null,
        config: UsePlaygroundStateOptions<D>,
    ) => SWRResponse<D, Error> & {
        setIsDirty?: (variantId: string, isDirty: boolean) => void
        isDirty?: boolean
    },
) => {
    return (
        key: string | Key,
        fetcher: BareFetcher<D> | null,
        config: UsePlaygroundStateOptions<D>,
    ) => {
        const dataRef = useRef(new Map())
        const dirtyRef = useRef(new Map<string, boolean>())

        const swr = useSWRNext(key, fetcher, config)
        const {isLoading, data, mutate} = swr

        const setIsDirty = useCallback(
            (variantId: string, isDirty: boolean) => {
                dirtyRef.current.set(variantId, isDirty)
                mutate(
                    (currentData) => {
                        if (!currentData) return currentData
                        return {
                            ...currentData,
                            dirtyStates: new Map(dirtyRef.current),
                        } as D
                    },
                    {revalidate: false},
                )
            },
            [mutate],
        )

        useEffect(() => {
            if (data !== undefined && !isLoading) {
                const variants = data.variants || []
                let hasChanges = false

                variants.forEach((variant) => {
                    const variantId = variant.variantId
                    if (!dataRef.current.has(variantId)) {
                        dataRef.current.set(variantId, variant)
                        if (dirtyRef.current.get(variantId) !== false) {
                            dirtyRef.current.set(variantId, false)
                            hasChanges = true
                        }
                    } else {
                        const initialVariant = dataRef.current.get(variantId)
                        const newDirtyState = !isEqual(initialVariant, variant)
                        if (dirtyRef.current.get(variantId) !== newDirtyState) {
                            dirtyRef.current.set(variantId, newDirtyState)
                            hasChanges = true
                        }
                    }
                })

                // Cleanup and check for removed variants
                const currentVariantIds = variants.map((v) => v.variantId)
                dirtyRef.current.forEach((_, key) => {
                    if (!currentVariantIds.includes(key)) {
                        dataRef.current.delete(key)
                        dirtyRef.current.delete(key)
                        hasChanges = true
                    }
                })

                if (hasChanges) {
                    mutate(
                        (currentData) =>
                            ({
                                ...currentData,
                                dirtyStates: new Map(dirtyRef.current),
                            }) as D,
                        {revalidate: false},
                    )
                }
            }
        }, [data, isLoading, mutate])

        return Object.assign({}, swr, {
            setIsDirty,
            get isDirty() {
                return config.variantId
                    ? (data as PlaygroundStateData)?.dirtyStates?.get(config.variantId) || false
                    : undefined
            },
        })
    }
}

export default isVariantDirtyMiddleware
