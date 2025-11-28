import {useEffect, useMemo} from "react"

import {atom} from "jotai"
import {LOW_PRIORITY, useAtomValueWithSchedule} from "jotai-scheduler"

import {
    appReferenceAtomFamily,
    type AppReference,
} from "@/oss/components/References/atoms/entityReferences"

import {getCachedAppReference, setCachedAppReference} from "../cache/referenceCache"

const defaultAppReferenceQueryAtom = atom(() => ({
    data: null as AppReference | null,
    isLoading: false,
    isFetching: false,
    isPending: false,
}))

interface UseAppReferenceOptions {
    enabled?: boolean
}

export const useAppReference = (
    {
        projectId,
        appId,
    }: {
        projectId: string | null
        appId: string | null | undefined
    },
    options?: UseAppReferenceOptions,
) => {
    const enabled = options?.enabled ?? true

    // Check cache first for instant display when scrolling back into view
    const cachedReference =
        enabled && projectId && appId ? getCachedAppReference(projectId, appId) : undefined

    const referenceAtom = useMemo(() => {
        if (!enabled || !projectId || !appId) return defaultAppReferenceQueryAtom
        return appReferenceAtomFamily({projectId, appId})
    }, [enabled, projectId, appId])

    const query = useAtomValueWithSchedule(referenceAtom, {priority: LOW_PRIORITY})
    const queryReference = enabled && projectId && appId ? (query?.data ?? null) : null

    // Update cache when we get new data
    useEffect(() => {
        if (!enabled || !projectId || !appId || !queryReference) return
        setCachedAppReference(projectId, appId, queryReference)
    }, [enabled, projectId, appId, queryReference])

    // Return cached value if query is still loading
    const reference = queryReference ?? cachedReference ?? null
    const hasReference = Boolean(reference)
    const isLoading = Boolean(
        enabled &&
            projectId &&
            appId &&
            !hasReference &&
            (query?.isLoading || query?.isFetching || query?.isPending),
    )

    return {reference, isLoading}
}

export default useAppReference
