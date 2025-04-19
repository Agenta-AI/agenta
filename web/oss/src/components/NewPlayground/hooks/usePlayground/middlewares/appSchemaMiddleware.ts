import {useCallback} from "react"

import {useRouter} from "next/router"
import {type Key, type SWRHook, useSWRConfig} from "swr"

import {DEFAULT_UUID} from "@/oss/contexts/project.context"
import {type FetcherOptions} from "@/oss/lib/api/types"
import {atomStore, allRevisionsAtom} from "@/oss/lib/hooks/useStatelessVariants/state"
import {initialState} from "@/oss/lib/hooks/useStatelessVariants/state"
import {EnhancedVariant} from "@/oss/lib/shared/variant/transformer/types"
import {fetchAndProcessRevisions, fetchPriorityRevisions} from "@/oss/lib/shared/variant/utils"
import {User} from "@/oss/lib/Types"

import {initializeGenerationInputs, initializeGenerationMessages} from "../assets/generationHelpers"
import {updateStateWithProcessedRevisions} from "../assets/stateHelpers"
import {getRevisionIdsFromUrl} from "../assets/urlHelpers"
import type {
    PlaygroundStateData,
    PlaygroundMiddleware,
    PlaygroundMiddlewareParams,
    PlaygroundSWRConfig,
    PlaygroundResponse,
} from "../types"

import usePlaygroundUtilities from "./hooks/usePlaygroundUtilities"

const appSchemaMiddleware: PlaygroundMiddleware = (useSWRNext: SWRHook) => {
    return <Data extends PlaygroundStateData = PlaygroundStateData, Selected = unknown>(
        key: Key,
        fetcher: ((url: string, options?: FetcherOptions) => Promise<Data>) | null,
        config: PlaygroundSWRConfig<Data>,
    ) => {
        const {fetcher: globalFetcher, mutate} = useSWRConfig()
        const router = useRouter()

        const useImplementation = ({key, fetcher, config}: PlaygroundMiddlewareParams<Data>) => {
            const {logger} = usePlaygroundUtilities({
                config: {
                    ...config,
                    name: "appSchemaMiddleware",
                },
            })

            const openApiSchemaFetcher = useCallback(
                async (url: string, options?: FetcherOptions): Promise<Data> => {
                    const cache = config.cache || new Map()
                    if (!url || !globalFetcher) {
                        return initialState as Data
                    }
                    const cachedValue = cache.get(url)?.data

                    logger(`FETCH - ENTER`)

                    if (cachedValue && !cachedValue.error) {
                        logger(`FETCH - RETURN CACHE AND DO NOT REFETCH`, cachedValue)
                        return cachedValue
                    }

                    const state = structuredClone(cachedValue || initialState) as Data

                    if (!fetcher) {
                        return state
                    }

                    logger(`FETCH - FETCH`)

                    state.fetching = true
                    state.appType = config.appType
                    try {
                        /**
                         * IMPORTANT ARCHITECTURAL SHIFT (March 2025):
                         * We now process all revisions individually rather than just the latest revision.
                         * The data model shifts from variant-centric to revision-centric while maintaining
                         * backward compatibility with existing components.
                         *
                         * What appears as "variants" to components are actually individual revisions
                         * that have been adapted to maintain the expected variant-like interface.
                         */

                        // 1. Extract needed revision IDs from URL
                        const neededRevisionIds = getRevisionIdsFromUrl(router)

                        // 2. Fast path: Get only what's needed for immediate display
                        logger("Fetching priority revisions for immediate display")
                        const {
                            revisions: priorityRevisions,
                            spec,
                            uri,
                            appStatus,
                        } = await fetchPriorityRevisions({
                            appId: config.appId || "",
                            appType: config.appType || "",
                            projectId: config.projectId || "",
                            revisionIds: neededRevisionIds,
                            fallbackToLatest: true,
                            logger: logger,
                        })

                        state.appStatus = appStatus

                        logger(`Loaded ${priorityRevisions.length} priority revisions`)

                        // 3. Update state with priority revisions
                        const updatedState = updateStateWithProcessedRevisions(
                            {...state},
                            priorityRevisions.filter((rev) => rev.revision > 0),
                            spec,
                            uri,
                        )

                        // Copy updated properties to state (since we can't reassign 'state')
                        state.uri = updatedState.uri
                        state.spec = updatedState.spec
                        state.availableRevisions = (updatedState.availableRevisions || []).filter(
                            (rev) => rev.revisionNumber > 0,
                        )

                        // 4. Set the selected revisions in state
                        const selectedIds =
                            neededRevisionIds.length > 0
                                ? neededRevisionIds
                                : [priorityRevisions[0]?.id]

                        state.variants = priorityRevisions
                        state.selected = (
                            typeof selectedIds === "string" ? [selectedIds] : selectedIds
                        ).filter(Boolean)

                        // 5. Initialize generation data
                        state.generationData.inputs = initializeGenerationInputs(
                            state.variants.filter((v) => state.selected.includes(v.id)),
                            spec,
                            state.uri?.routePath,
                        )

                        state.generationData.messages = initializeGenerationMessages(state.variants)

                        // 6. Trigger background loading without blocking UI
                        if (!config?.skipBackgroundLoading) {
                            // Use a microtask to not block rendering
                            queueMicrotask(() => {
                                logger(
                                    `[BACKGROUND] Starting loading of remaining revisions (excluding ${priorityRevisions.length} priority revisions)`,
                                )

                                // Create an abort controller for potential cancellation
                                const controller = new AbortController()

                                // Use the existing fetchAndProcessRevisions but exclude already loaded revisions
                                // We need to force a full refresh to ensure we process ALL variants, even those skipped in priority loading
                                fetchAndProcessRevisions({
                                    appId: config.appId || "",
                                    appType: config.appType || "",
                                    projectId: config.projectId || "",
                                    // Exclude revisions we already have
                                    excludeRevisionIds: priorityRevisions.map((r) => r.id),
                                    forceRefresh: true, // Force refresh to ensure we get fresh data
                                    logger: (msg) => logger(`[BACKGROUND] ${msg}`),
                                    signal: controller.signal,
                                    // Don't pass any initialVariants to ensure we process all variants
                                    initialVariants: [],
                                    keyParts: "playground",
                                })
                                    .then(({revisions: _remainingRevisions, spec}) => {
                                        if (controller.signal.aborted) return

                                        const remainingRevisions = _remainingRevisions.filter(
                                            (r) => r.revision > 0,
                                        )

                                        // Log the IDs of the loaded revisions for debugging
                                        logger(
                                            `[BACKGROUND] Loaded revision IDs: ${JSON.stringify(remainingRevisions.map((r) => r.id))}`,
                                        )

                                        if (remainingRevisions.length === 0) {
                                            logger(
                                                `[BACKGROUND] No additional revisions found, skipping update`,
                                            )
                                            mutate<PlaygroundStateData, PlaygroundStateData>(
                                                key,
                                                (state) => {
                                                    if (!state) return state
                                                    const clonedState = structuredClone(state)
                                                    clonedState.fetching = false
                                                    return clonedState
                                                },
                                            )
                                            return
                                        }

                                        // Merge with existing revisions in the atom
                                        const allRevisions = [
                                            ...priorityRevisions,
                                            ...remainingRevisions,
                                        ]

                                        console.log("allRevisions", allRevisions)

                                        // Recalculate isLatestRevision flag across all variants
                                        if (allRevisions.length > 0) {
                                            // Find the latest revision timestamp across all variants
                                            const latestTimestamp = Math.max(
                                                ...allRevisions.map(
                                                    (r) => r.createdAtTimestamp || 0,
                                                ),
                                            )

                                            // Set isLatestRevision flag only for the latest revision(s)
                                            allRevisions.forEach((revision) => {
                                                revision.isLatestRevision =
                                                    revision.createdAtTimestamp === latestTimestamp
                                            })

                                            logger(
                                                `[BACKGROUND] Set isLatestRevision flag for revisions with timestamp ${latestTimestamp}`,
                                            )
                                        }

                                        logger(
                                            `[BACKGROUND] Total revisions after merge: ${allRevisions.length}`,
                                        )

                                        // Update the atom with all revisions
                                        atomStore.set(allRevisionsAtom, () => allRevisions)

                                        // Trigger a SWR mutation to refresh the UI with the new data
                                        logger(
                                            `[BACKGROUND] Triggering UI refresh with all ${allRevisions.length} revisions`,
                                        )
                                        mutate<PlaygroundStateData, PlaygroundStateData>(
                                            key,
                                            (state) => {
                                                if (!state) return state

                                                // Create a deep clone of the current state
                                                const clonedState = structuredClone(state)

                                                // Update currently mounted variants with the latest data
                                                if (
                                                    clonedState.variants &&
                                                    clonedState.variants.length > 0
                                                ) {
                                                    logger(
                                                        `[BACKGROUND] Updating ${clonedState.variants.length} mounted variants with latest data`,
                                                    )

                                                    // Create a map of all revisions by ID for quick lookup
                                                    const revisionsMap = new Map()
                                                    allRevisions.forEach((revision) => {
                                                        revisionsMap.set(revision.id, revision)
                                                    })

                                                    // Update each mounted variant with the latest data if available
                                                    clonedState.variants = clonedState.variants.map(
                                                        (variant) => {
                                                            const updatedVariant = revisionsMap.get(
                                                                variant.id,
                                                            )
                                                            if (updatedVariant) {
                                                                logger(
                                                                    `[BACKGROUND] Updated mounted variant ${variant.id} with latest data`,
                                                                )
                                                                return updatedVariant
                                                            }
                                                            return variant
                                                        },
                                                    )
                                                }

                                                // Transform EnhancedVariants to LightweightRevisions for availableRevisions
                                                const lightweightRevisions = allRevisions.map(
                                                    (revision) => {
                                                        // Use type assertion for the extended properties that aren't in the base type
                                                        const enhancedRevision =
                                                            revision as EnhancedVariant & {
                                                                variantId: string
                                                                isLatestRevision: boolean
                                                                isLatestVariantRevision: boolean
                                                                userProfile?: User
                                                                deployedIn?: string[]
                                                                commitMessage: string | null
                                                                createdAtTimestamp: number
                                                            }

                                                        return {
                                                            id: revision.id,
                                                            name:
                                                                revision.name ||
                                                                revision.variantName,
                                                            revisionNumber: revision.revision,
                                                            variantId: enhancedRevision.variantId,
                                                            variantName: revision.variantName,
                                                            createdAt: revision.createdAt,
                                                            isLatestRevision:
                                                                enhancedRevision.isLatestRevision,
                                                            isLatestVariantRevision:
                                                                enhancedRevision.isLatestVariantRevision,
                                                            userProfile:
                                                                enhancedRevision.userProfile,
                                                            deployedIn:
                                                                enhancedRevision.deployedIn || [],
                                                            commitMessage:
                                                                enhancedRevision.commitMessage,
                                                            createdAtTimestamp:
                                                                enhancedRevision.createdAtTimestamp,
                                                        }
                                                    },
                                                )

                                                // Update availableRevisions with our properly transformed lightweight revisions
                                                clonedState.availableRevisions =
                                                    lightweightRevisions

                                                // Update dataRef to ensure SWR recognizes the change
                                                if (clonedState.dataRef) {
                                                    // clonedState.dataRef.current = {
                                                    // ...(clonedState.dataRef.current || {}),
                                                    // availableRevisions: lightweightRevisions,
                                                    // }
                                                }

                                                logger(
                                                    `[BACKGROUND] Updated state with ${allRevisions.length} revisions`,
                                                )

                                                if (
                                                    !clonedState.selected ||
                                                    clonedState.selected.length === 0
                                                ) {
                                                    const latestRevision =
                                                        clonedState.availableRevisions.find(
                                                            (rev) => rev.isLatestRevision,
                                                        )

                                                    const variant = atomStore
                                                        .get(allRevisionsAtom)
                                                        .find(
                                                            (rev) => rev.id === latestRevision?.id,
                                                        )

                                                    if (variant) {
                                                        clonedState.selected = [
                                                            latestRevision?.id || "",
                                                        ]
                                                        clonedState.variants = [variant]
                                                    }
                                                }

                                                clonedState.fetching = false

                                                clonedState.generationData.inputs =
                                                    initializeGenerationInputs(
                                                        clonedState.variants.filter((v) =>
                                                            clonedState.selected.includes(v.id),
                                                        ),
                                                        spec,
                                                        clonedState.uri?.routePath,
                                                    )

                                                clonedState.generationData.messages =
                                                    initializeGenerationMessages(
                                                        allRevisions.filter((rev) =>
                                                            clonedState.selected.includes(rev.id),
                                                        ),
                                                    )

                                                return clonedState
                                            },
                                        )
                                    })
                                    .catch((err) => {
                                        if (err.name !== "AbortError") {
                                            logger(
                                                `[BACKGROUND] Error loading additional revisions: ${err.message}`,
                                            )
                                            console.error("[BACKGROUND] Loading error:", err)
                                        } else {
                                            logger(`[BACKGROUND] Loading was aborted`)
                                        }
                                    })
                            })
                        }

                        // Clear any previous errors
                        state.error = undefined
                        return state
                    } catch (err) {
                        console.error("Error in openApiSchemaFetcher:", err)
                        state.error = err as Error
                        return state
                    }
                },
                [config.cache, fetcher, logger],
            )

            return useSWRNext(
                key,
                !config.projectId || config.projectId === DEFAULT_UUID
                    ? null
                    : openApiSchemaFetcher,
                {
                    ...config,
                    revalidateOnFocus: true,
                    revalidateOnReconnect: true,
                    revalidateIfStale: true,
                    revalidateOnMount: true,
                    compare: useCallback(
                        (a?: Data, b?: Data) => {
                            const wrappedComparison = config.compare?.(a, b)
                            logger(`COMPARE - ENTER`, wrappedComparison, a, b)
                            return wrappedComparison ?? true
                        },
                        [config, logger],
                    ),
                },
            ) as PlaygroundResponse<Data, Selected>
        }
        return useImplementation({key, fetcher, config})
    }
}

export default appSchemaMiddleware
