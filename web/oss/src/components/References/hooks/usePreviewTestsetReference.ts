import {useEffect, useMemo} from "react"

import {atom} from "jotai"
import {LOW_PRIORITY, useAtomValueWithSchedule} from "jotai-scheduler"

import {previewTestsetReferenceAtomFamily} from "@/oss/components/References/atoms/entityReferences"
import type {TestsetReference} from "@/oss/components/References/atoms/entityReferences"
import {projectIdAtom} from "@/oss/state/project"

import {getCachedTestsetReference, setCachedTestsetReference} from "../cache/referenceCache"

const defaultTestsetReferenceQueryAtom = atom(() => ({
    data: null as TestsetReference | null,
    isLoading: false,
    isFetching: false,
    isPending: false,
}))

const extractPreviewTestsetReference = (
    stepReferences: Record<string, unknown> | null | undefined,
    testsetId: string | null | undefined,
): TestsetReference | null => {
    if (!stepReferences || !testsetId) return null

    for (const stepKey of Object.keys(stepReferences)) {
        const refs = (stepReferences as Record<string, any>)[stepKey]
        if (!refs || typeof refs !== "object") continue

        const directMatch = refs.testset ?? refs.test_set ?? refs.testsetVariant
        if (directMatch && directMatch.id === testsetId) {
            // Extract testsetRevision ID if available (camelCase from snakeToCamelCaseKeys)
            const revisionRef = refs.testsetRevision ?? refs.testset_revision
            const revisionId =
                revisionRef && typeof revisionRef.id === "string" ? revisionRef.id : null

            return {
                id: testsetId,
                name: directMatch.name ?? null,
                revisionId,
            }
        }

        const arrayRefs = refs.testsets
        if (Array.isArray(arrayRefs)) {
            for (const entry of arrayRefs) {
                if (entry && entry.id === testsetId) {
                    // Extract testsetRevision ID if available (camelCase from snakeToCamelCaseKeys)
                    const revisionRef = refs.testsetRevision ?? refs.testset_revision
                    const revisionId =
                        revisionRef && typeof revisionRef.id === "string" ? revisionRef.id : null

                    return {
                        id: testsetId,
                        name: entry.name ?? null,
                        revisionId,
                    }
                }
            }
        }
    }

    return null
}

export const usePreviewTestsetReference = (
    {
        projectId,
        testsetId,
        stepReferences,
    }: {
        projectId: string | null
        testsetId: string | null | undefined
        stepReferences?: Record<string, unknown> | null
    },
    options?: {enabled?: boolean},
) => {
    const enabled = options?.enabled ?? true
    const globalProjectId = useAtomValueWithSchedule(projectIdAtom, {
        priority: LOW_PRIORITY,
    })
    const effectiveProjectId = projectId ?? globalProjectId

    // Check cache first for instant display when scrolling back into view
    const cachedReference =
        enabled && effectiveProjectId && testsetId
            ? getCachedTestsetReference(effectiveProjectId, testsetId)
            : undefined

    const referenceAtom = useMemo(() => {
        if (!enabled || !effectiveProjectId || !testsetId) return defaultTestsetReferenceQueryAtom
        return previewTestsetReferenceAtomFamily({projectId: effectiveProjectId, testsetId})
    }, [enabled, effectiveProjectId, testsetId])

    const query = useAtomValueWithSchedule(referenceAtom, {priority: LOW_PRIORITY})

    const queryReference = enabled && effectiveProjectId && testsetId ? (query?.data ?? null) : null

    // Update cache when we get new data
    useEffect(() => {
        if (!enabled || !effectiveProjectId || !testsetId || !queryReference) return
        setCachedTestsetReference(effectiveProjectId, testsetId, queryReference)
    }, [enabled, effectiveProjectId, testsetId, queryReference])

    const embeddedReference = useMemo(
        () => extractPreviewTestsetReference(stepReferences ?? null, testsetId ?? null),
        [stepReferences, testsetId],
    )

    // Merge references: use queryReference for name but preserve revisionId from embeddedReference
    // since the API doesn't return revision info but stepReferences contains it
    const reference = useMemo(() => {
        const base = queryReference ?? cachedReference ?? embeddedReference
        if (!base) return null
        // If we have embedded reference with revisionId, merge it with the base
        const revisionId = embeddedReference?.revisionId ?? base.revisionId ?? null
        return {
            ...base,
            revisionId,
        }
    }, [queryReference, cachedReference, embeddedReference])
    const hasReference = Boolean(reference)
    const isLoading = Boolean(
        enabled &&
        effectiveProjectId &&
        testsetId &&
        !hasReference &&
        (query?.isLoading || query?.isFetching || query?.isPending),
    )

    return {reference, isLoading}
}

export default usePreviewTestsetReference
