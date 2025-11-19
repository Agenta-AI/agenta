import {useMemo} from "react"

import {atom} from "jotai"
import {LOW_PRIORITY, useAtomValueWithSchedule} from "jotai-scheduler"

import {
    appReferenceAtomFamily,
    type AppReference,
} from "@/oss/components/References/atoms/entityReferences"

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
    const referenceAtom = useMemo(() => {
        if (!enabled || !projectId || !appId) return defaultAppReferenceQueryAtom
        return appReferenceAtomFamily({projectId, appId})
    }, [enabled, projectId, appId])

    const query = useAtomValueWithSchedule(referenceAtom, {priority: LOW_PRIORITY})
    const reference = enabled && projectId && appId ? (query?.data ?? null) : null
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
