import {useMemo} from "react"

import {atom} from "jotai"
import {LOW_PRIORITY, useAtomValueWithSchedule} from "jotai-scheduler"

import {variantConfigAtomFamily} from "@/oss/components/References/atoms/entityReferences"
import type {VariantConfigReference} from "@/oss/components/References/atoms/entityReferences"
import {projectIdAtom} from "@/oss/state/project"

const idleVariantConfigQueryAtom = atom({
    data: null as VariantConfigReference | null,
    isLoading: false,
    isFetching: false,
    isPending: false,
})

interface UsePreviewVariantConfigOptions {
    enabled?: boolean
}

const usePreviewVariantConfig = (
    {
        projectId,
        revisionId,
    }: {
        projectId: string | null | undefined
        revisionId: string | null | undefined
    },
    options?: UsePreviewVariantConfigOptions,
) => {
    const enabled = options?.enabled ?? true
    const globalProjectId = useAtomValueWithSchedule(projectIdAtom, {
        priority: LOW_PRIORITY,
    })
    const effectiveProjectId = projectId ?? globalProjectId

    const queryAtom = useMemo(() => {
        if (!enabled || !effectiveProjectId || !revisionId) {
            return idleVariantConfigQueryAtom
        }
        return variantConfigAtomFamily({projectId: effectiveProjectId, revisionId})
    }, [enabled, effectiveProjectId, revisionId])

    const query = useAtomValueWithSchedule(queryAtom, {
        priority: LOW_PRIORITY,
    })
    const config =
        enabled && effectiveProjectId && revisionId
            ? ((query?.data as VariantConfigReference | null) ?? null)
            : null
    const hasConfig = Boolean(config)

    const isLoading = Boolean(
        enabled &&
            effectiveProjectId &&
            revisionId &&
            !hasConfig &&
            (query?.isLoading || query?.isFetching || query?.isPending),
    )

    return {config, isLoading}
}

export default usePreviewVariantConfig
