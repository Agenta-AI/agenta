import {useEffect, useMemo} from "react"

import {atom} from "jotai"
import {LOW_PRIORITY, useAtomValueWithSchedule} from "jotai-scheduler"

import {variantConfigAtomFamily} from "@/oss/components/References/atoms/entityReferences"
import type {VariantConfigReference} from "@/oss/components/References/atoms/entityReferences"
import {projectIdAtom} from "@/oss/state/project"

import {getCachedVariantConfig, setCachedVariantConfig} from "../cache/referenceCache"

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

    // Check cache first for instant display when scrolling back into view
    const cachedConfig =
        enabled && effectiveProjectId && revisionId
            ? getCachedVariantConfig(effectiveProjectId, revisionId)
            : undefined

    const queryAtom = useMemo(() => {
        if (!enabled || !effectiveProjectId || !revisionId) {
            return idleVariantConfigQueryAtom
        }
        return variantConfigAtomFamily({projectId: effectiveProjectId, revisionId})
    }, [enabled, effectiveProjectId, revisionId])

    const query = useAtomValueWithSchedule(queryAtom, {
        priority: LOW_PRIORITY,
    })
    const queryConfig =
        enabled && effectiveProjectId && revisionId
            ? ((query?.data as VariantConfigReference | null) ?? null)
            : null

    // Update cache when we get new data
    useEffect(() => {
        if (!enabled || !effectiveProjectId || !revisionId || !queryConfig) return
        setCachedVariantConfig(effectiveProjectId, revisionId, queryConfig)
    }, [enabled, effectiveProjectId, revisionId, queryConfig])

    // Return cached value if query is still loading
    const config = queryConfig ?? cachedConfig ?? null
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
