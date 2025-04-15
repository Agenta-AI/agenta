import {useCallback, useRef} from "react"

import isEqual from "fast-deep-equal"
import {type Key, type SWRHook, useSWRConfig} from "swr"

import {type FetcherOptions} from "@/oss/lib/api/types"
import {type EnhancedVariant} from "@/oss/lib/shared/variant/transformer/types"
import {type OpenAPISpec} from "@/oss/lib/shared/variant/types"
import {fetchAndProcessRevisions, adaptRevisionToVariant} from "@/oss/lib/shared/variant/utils"

import {initialState, getIsFetching, startFetch, endFetch} from "../../state"
import {
    type PlaygroundMiddlewareParams,
    type PlaygroundMiddleware,
    type PlaygroundStateData,
} from "../../types"
import {type PlaygroundSWRConfig} from "../../types/playground"

// Add TypeScript interface for revalidation batches
interface RevalidationBatch {
    batch: any[]
    isLastBatch: boolean
    spec?: OpenAPISpec
    uri?: {
        routePath: string
        runtimePrefix: string
    }
}

// Use Record type instead of index signature as per linting rule
type RevalidationBatches = Record<string, RevalidationBatch[]>

// Declare the global property
declare global {
    interface Window {
        __revalidationBatches?: RevalidationBatches
    }
}

const appSchemaMiddleware: PlaygroundMiddleware = (useSWRNext: SWRHook) => {
    return <Data extends PlaygroundStateData = PlaygroundStateData>(
        key: Key,
        fetcher: ((url: string, options?: FetcherOptions) => Promise<Data>) | null,
        config: PlaygroundSWRConfig<Data>,
    ) => {
        const {fetcher: globalFetcher, mutate: globalMutate} = useSWRConfig()
        const useImplementation = ({key, fetcher, config}: PlaygroundMiddlewareParams<Data>) => {
            // Use refs to maintain values across renders and make them accessible in callbacks
            const controllerRef = useRef<AbortController | null>(null)
            const fetchKeyRef = useRef<string>("")

            const openApiSchemaFetcher = useCallback(
                async (url: string, options?: FetcherOptions): Promise<Data> => {
                    const cache = config.cache || new Map()
                    if (!url || !globalFetcher) {
                        return initialState as Data
                    }
                    const cachedValue = cache.get(url)?.data

                    const state = structuredClone(cachedValue || initialState) as Data

                    if (!fetcher) {
                        return state
                    }

                    try {
                        const appId = config.appId
                        const projectId = config.projectId

                        if (!appId || !projectId) {
                            throw new Error("Missing required app_id or project_id parameters")
                        }

                        // Generate a unique key for this fetch operation
                        fetchKeyRef.current = `${JSON.stringify(key)}`

                        // Check if we're already fetching data for this key
                        if (getIsFetching(fetchKeyRef.current)) {
                            return state
                        }

                        state.fetching = true
                        state.appType = config.appType
                        // Start a new fetch and get the abort controller
                        controllerRef.current = startFetch(fetchKeyRef.current)
                        // Get the signal from the controller to pass to fetch operations
                        const signal = controllerRef.current.signal

                        /**
                         * IMPORTANT ARCHITECTURAL SHIFT (March 2025):
                         * We now process all revisions individually rather than just the latest revision.
                         * The data model shifts from variant-centric to revision-centric while maintaining
                         * backward compatibility with existing components.
                         *
                         * What appears as "variants" to components are actually individual revisions
                         * that have been adapted to maintain the expected variant-like interface.
                         */

                        // Note: latestVariantId detection was previously used here
                        // Now all revision and variant flags are set in fetchAndProcessRevisions

                        // Use the consolidated function that handles the entire fetch & process flow
                        // We're now using the batched parallel processing approach
                        console.log("Starting parallel batched processing of revisions")

                        // Import the transformVariants function
                        const {transformVariants} = await import(
                            "@/oss/lib/shared/variant/transformer"
                        )

                        // Generate a unique key for this revalidation session based on appId
                        const revalidationKey = `${appId}`

                        // Initialize revalidation batches if not already done
                        if (!window.__revalidationBatches) {
                            window.__revalidationBatches = {}
                        }

                        // Initialize the array for this revalidation key if it doesn't exist
                        if (!window.__revalidationBatches[revalidationKey]) {
                            window.__revalidationBatches[revalidationKey] = []
                        }

                        // Create a reference to track batch processing
                        interface BatchTracker {
                            totalBatches: number
                            processedBatches: number
                            isComplete: boolean
                            batchesArray: EnhancedVariant[][]
                            processedVariantIds: Set<string> // Track processed variant IDs to avoid duplicates
                        }

                        const batchTracker: BatchTracker = {
                            totalBatches: 0,
                            processedBatches: 0,
                            isComplete: false,
                            batchesArray: [],
                            processedVariantIds: new Set<string>(), // Track processed variant IDs to avoid duplicates
                        }

                        // Define a callback function for incremental state updates
                        const updateStateWithBatch = async (
                            batchResults: EnhancedVariant[],
                            spec: OpenAPISpec,
                            uri: {
                                routePath: string
                                runtimePrefix: string
                            },
                            isLastBatch = false,
                        ) => {
                            console.log(
                                `updateStateWithBatch - Incrementally updating state with ${batchResults.length} variants${isLastBatch ? " (FINAL BATCH)" : ""}`,
                            )

                            try {
                                batchResults = batchResults.map((variant) => ({
                                    ...variant,
                                    uriObject: uri,
                                }))
                                // Apply transformVariants to the batch results if we have a schema
                                let transformedBatchResults = batchResults
                                if (spec) {
                                    try {
                                        transformedBatchResults = await transformVariants(
                                            batchResults,
                                            spec,
                                            config.appType
                                        )
                                    } catch (error) {
                                        console.error(
                                            "Error transforming batch with schema:",
                                            error,
                                        )
                                        // Continue with untransformed batch if transformation fails
                                        transformedBatchResults = batchResults
                                    }
                                }

                                // Store this batch with transformed variants
                                if (
                                    window.__revalidationBatches &&
                                    window.__revalidationBatches[revalidationKey]
                                ) {
                                    console.log(
                                        "Storing transformed variants in batch",
                                        transformedBatchResults,
                                    )
                                    window.__revalidationBatches[revalidationKey].push({
                                        batch: transformedBatchResults, // Store transformed variants
                                        isLastBatch,
                                        spec,
                                        uri,
                                    })
                                }
                                // Trigger a SWR mutation to refresh the UI with the new data
                                globalMutate(
                                    key,
                                    (currentState: Data | undefined) => {
                                        if (!currentState) return currentState

                                        // Create a deep clone of the current state
                                        const clonedState = structuredClone(currentState)

                                        // Helper function to extract app ID from fetch key
                                        const getAppIdFromKey = (key: Key) => {
                                            // Assuming key format includes the app ID
                                            // e.g., ["variants", { appId: "123", ... }]
                                            if (
                                                Array.isArray(key) &&
                                                typeof key[1] === "object" &&
                                                key[1] !== null
                                            ) {
                                                return (
                                                    (key[1] as Record<string, string>).appId || ""
                                                )
                                            }
                                            return "" // Default empty app ID if not found
                                        }

                                        // Get app ID from the fetch key for URI construction
                                        const appId = getAppIdFromKey(key)

                                        // We need to match how fetchAndProcessRevisions handles URIs
                                        // It uses findCustomWorkflowPath which returns an object with routePath and runtimePrefix
                                        // First, get the URI from the first variant if available
                                        const firstVariant = batchResults[0]
                                        const defaultUri = firstVariant?.uri

                                        // 1. Process each batch result using the same transformation as in fetchAndProcessRevisions
                                        // This ensures consistency with the final result
                                        const flattenedRevisions: EnhancedVariant[] =
                                            transformedBatchResults.flatMap((variant) => {
                                                const revs = structuredClone(variant.revisions)
                                                const _revisions =
                                                    revs
                                                        ?.filter((rev) => rev.revision > 0)
                                                        ?.map((revision) => {
                                                            // Get user profiles (would normally come from userProfilesMap)
                                                            const revisionUserProfile = null
                                                            const variantUserProfile = null

                                                            // Use the same utility function as in fetchAndProcessRevisions
                                                            const adapted = adaptRevisionToVariant(
                                                                {
                                                                    ...revision,
                                                                    userProfile:
                                                                        revisionUserProfile,
                                                                },
                                                                {
                                                                    ...variant,
                                                                    appId: variant.appId || appId,
                                                                    uri: variant.uri || defaultUri,
                                                                    // Create a uriObject with the routePath and runtimePrefix properties
                                                                    // that match what findCustomWorkflowPath would return
                                                                    uriObject: {
                                                                        routePath: "",
                                                                        runtimePrefix:
                                                                            variant.uri ||
                                                                            defaultUri,
                                                                    },
                                                                    userProfile: variantUserProfile,
                                                                    isStatelessVariant: true,
                                                                },
                                                            )
                                                            return adapted
                                                        }) || []

                                                return _revisions
                                            })

                                        // 2. Sort the flattened revisions by createdAtTimestamp
                                        const sortedRevisions = flattenedRevisions.sort(
                                            (a, b) => b.createdAtTimestamp - a.createdAtTimestamp,
                                        )

                                        // If this is the last batch, we need to set isLatestRevision flag properly
                                        if (isLastBatch && sortedRevisions.length > 0) {
                                            // Get all existing variants from the current state
                                            const existingVariants = clonedState.variants || []

                                            // Combine existing variants with the new batch
                                            const allVariants = [
                                                ...existingVariants,
                                                ...sortedRevisions,
                                            ]

                                            // Find the latest revision timestamp across all variants
                                            const latestTimestamp = Math.max(
                                                ...allVariants.map(
                                                    (r) => r.createdAtTimestamp || 0,
                                                ),
                                            )

                                            // Reset isLatestRevision flag for all variants
                                            allVariants.forEach((revision) => {
                                                revision.isLatestRevision =
                                                    revision.createdAtTimestamp === latestTimestamp
                                            })

                                            // Update sortedRevisions to include only the current batch with updated flags
                                            // This ensures we don't duplicate variants in the state
                                            const revisedSortedRevisions = sortedRevisions.map(
                                                (newVariant) => {
                                                    // Find the existing variant in allVariants
                                                    const existingVariant = existingVariants.find(
                                                        (v) => v.id === newVariant.id,
                                                    )

                                                    if (existingVariant) {
                                                        // If we found an existing variant, merge them properly
                                                        // Start with the new variant as the base to preserve new fields like deployedIn
                                                        const mergedVariant = {
                                                            ...newVariant,
                                                            // Set the isLatestRevision flag from allVariants
                                                            isLatestRevision:
                                                                newVariant.createdAtTimestamp ===
                                                                latestTimestamp,
                                                        }

                                                        return mergedVariant
                                                    }

                                                    // If no existing variant, just use the new one with updated flag
                                                    return {
                                                        ...newVariant,
                                                        isLatestRevision:
                                                            newVariant.createdAtTimestamp ===
                                                            latestTimestamp,
                                                    }
                                                },
                                            )

                                            // Replace sortedRevisions with the updated version
                                            sortedRevisions.splice(
                                                0,
                                                sortedRevisions.length,
                                                ...revisedSortedRevisions,
                                            )
                                        }

                                        // 3. Update the state with the flattened and sorted revisions
                                        // Check if we need to update variants by comparing with existing state
                                        if (
                                            clonedState.variants &&
                                            clonedState.variants.length > 0
                                        ) {
                                            // Create maps for quick lookup
                                            const existingVariantsMap = new Map()
                                            clonedState.variants.forEach((variant) => {
                                                existingVariantsMap.set(variant.id, variant)
                                            })

                                            const newVariantsMap = new Map()
                                            sortedRevisions.forEach((variant) => {
                                                newVariantsMap.set(variant.id, variant)
                                            })

                                            // Check if there are any differences
                                            let hasChanges = false
                                            const changedKeys = []
                                            let changedVariantId = ""

                                            // Check for new or updated variants
                                            for (const [
                                                id,
                                                newVariant,
                                            ] of newVariantsMap.entries()) {
                                                const existingVariant = existingVariantsMap.get(id)

                                                // If this is a new variant that doesn't exist in current state
                                                if (!existingVariant) {
                                                    hasChanges = true
                                                    changedVariantId = id
                                                    break
                                                }

                                                // Create copies without the prompts key for comparison
                                                const existingVariantForComparison = {
                                                    ...existingVariant,
                                                }
                                                const newVariantForComparison = {...newVariant}

                                                // Remove prompts from both objects before comparison
                                                if (existingVariantForComparison?.prompts) {
                                                    delete existingVariantForComparison.prompts
                                                    delete existingVariantForComparison.isLatestRevision
                                                }
                                                if (newVariantForComparison.prompts) {
                                                    delete newVariantForComparison.prompts
                                                    delete newVariantForComparison.isLatestRevision
                                                }

                                                // Compare the objects without prompts
                                                if (
                                                    JSON.stringify(existingVariantForComparison) !==
                                                    JSON.stringify(newVariantForComparison)
                                                ) {
                                                    // Find which keys are different
                                                    const allKeys = new Set([
                                                        ...Object.keys(
                                                            existingVariantForComparison || {},
                                                        ),
                                                        ...Object.keys(
                                                            newVariantForComparison || {},
                                                        ),
                                                    ])

                                                    for (const key of allKeys) {
                                                        // Skip prompts key as we're ignoring it
                                                        if (key === "prompts") continue

                                                        const existingValue =
                                                            existingVariantForComparison?.[key]
                                                        const newValue =
                                                            newVariantForComparison?.[key]

                                                        if (
                                                            JSON.stringify(existingValue) !==
                                                            JSON.stringify(newValue)
                                                        ) {
                                                            changedKeys.push(key)
                                                        }
                                                    }

                                                    hasChanges = true
                                                    changedVariantId = id
                                                    break
                                                }
                                            }

                                            // Check for removed variants only if we're on the last batch
                                            if (!hasChanges && isLastBatch) {
                                                for (const id of existingVariantsMap.keys()) {
                                                    if (!newVariantsMap.has(id)) {
                                                        hasChanges = true
                                                        changedVariantId = id
                                                        break
                                                    }
                                                }
                                            }

                                            // During revalidation (when we already have data), we'll only update on the last batch
                                            if (
                                                currentState?.variants?.length > 0 &&
                                                !isLastBatch
                                            ) {
                                                console.log(
                                                    "Collecting batch for later update (not the last batch)",
                                                )
                                                // Return current state unchanged until we get the last batch
                                                return currentState
                                            }

                                            // If this is the last batch during revalidation, process all collected batches
                                            if (
                                                // Removed the condition requiring existing variants
                                                isLastBatch &&
                                                window?.__revalidationBatches?.[revalidationKey] &&
                                                window?.__revalidationBatches?.[revalidationKey]
                                                    ?.length > 0
                                            ) {
                                                console.log(
                                                    "Processing all collected batches",
                                                    window.__revalidationBatches?.[revalidationKey]
                                                        ?.length,
                                                )

                                                // Use the already correct newVariantsMap data to populate our allBatchVariants
                                                // This ensures we're using the properly transformed variants
                                                const allBatchVariantsMap = new Map()

                                                // Use sortedRevisions which already contains the properly transformed variants
                                                sortedRevisions.forEach((variant) => {
                                                    if (variant && variant.id) {
                                                        allBatchVariantsMap.set(variant.id, variant)
                                                    }
                                                })

                                                // Clear the batches after processing to prevent reprocessing them
                                                if (
                                                    isLastBatch &&
                                                    window.__revalidationBatches?.[revalidationKey]
                                                ) {
                                                    console.log(
                                                        "Clearing processed batches to prevent reprocessing",
                                                    )
                                                    // Store the number of batches before clearing for logging
                                                    const batchesCleared =
                                                        window.__revalidationBatches[
                                                            revalidationKey
                                                        ].length
                                                    // Clear the batches
                                                    window.__revalidationBatches[revalidationKey] =
                                                        []
                                                    console.log(
                                                        `Cleared ${batchesCleared} processed batches`,
                                                    )
                                                }

                                                // Log information about our allBatchVariantsMap
                                                console.log(
                                                    "allBatchVariantsMap size:",
                                                    allBatchVariantsMap.size,
                                                    "keys:",
                                                    Array.from(allBatchVariantsMap.keys()),
                                                )

                                                // Now compare with existing variants
                                                const existingVariantsMap = new Map()
                                                clonedState.variants.forEach((variant) => {
                                                    if (variant.id) {
                                                        existingVariantsMap.set(variant.id, variant)
                                                    }
                                                })

                                                // Check for changes between existing and all batched variants
                                                let hasChanges = false
                                                let changedVariantId = null
                                                const changedKeys = []

                                                // Check for new or modified variants
                                                for (const [
                                                    id,
                                                    newVariant,
                                                ] of allBatchVariantsMap.entries()) {
                                                    const existingVariant =
                                                        existingVariantsMap.get(id)

                                                    if (!existingVariant) {
                                                        // New variant found
                                                        hasChanges = true
                                                        changedVariantId = id
                                                        break
                                                    }

                                                    // Deep compare existing and new variants
                                                    const existingVariantForComparison = {
                                                        ...existingVariant,
                                                    }
                                                    const newVariantForComparison = {...newVariant}

                                                    // Remove prompts and isLatestRevision from both objects before comparison
                                                    if (existingVariantForComparison?.prompts) {
                                                        delete existingVariantForComparison.prompts
                                                        delete existingVariantForComparison.isLatestRevision
                                                    }
                                                    if (newVariantForComparison.prompts) {
                                                        delete newVariantForComparison.prompts
                                                        delete newVariantForComparison.isLatestRevision
                                                    }

                                                    // Compare the objects
                                                    if (
                                                        JSON.stringify(
                                                            existingVariantForComparison,
                                                        ) !==
                                                        JSON.stringify(newVariantForComparison)
                                                    ) {
                                                        // Find which keys are different
                                                        const allKeys = new Set([
                                                            ...Object.keys(
                                                                existingVariantForComparison || {},
                                                            ),
                                                            ...Object.keys(
                                                                newVariantForComparison || {},
                                                            ),
                                                        ])

                                                        for (const key of allKeys) {
                                                            if (
                                                                key === "prompts" ||
                                                                key === "isLatestRevision"
                                                            )
                                                                continue

                                                            const existingValue =
                                                                existingVariantForComparison?.[key]
                                                            const newValue =
                                                                newVariantForComparison?.[key]

                                                            if (
                                                                JSON.stringify(existingValue) !==
                                                                JSON.stringify(newValue)
                                                            ) {
                                                                changedKeys.push(key)
                                                            }
                                                        }

                                                        hasChanges = true
                                                        changedVariantId = id
                                                        break
                                                    }
                                                }

                                                // Check for removed variants
                                                if (!hasChanges) {
                                                    for (const id of existingVariantsMap.keys()) {
                                                        if (!allBatchVariantsMap.has(id)) {
                                                            hasChanges = true
                                                            changedVariantId = id
                                                            break
                                                        }
                                                    }
                                                }

                                                if (hasChanges) {
                                                    if (changedVariantId) {
                                                        console.log(
                                                            `Detected changes in variants. Changed variant ID: ${changedVariantId}`,
                                                        )
                                                    }
                                                    if (changedKeys.length > 0) {
                                                        console.log(
                                                            `Detected changes in variants. Changed keys: ${changedKeys.join(", ")}`,
                                                        )
                                                    }

                                                    // Create a merged set of variants, ensuring no duplicates
                                                    // First, create a map of existing variants by ID
                                                    const existingVariantsById = new Map()
                                                    clonedState.variants.forEach((variant) => {
                                                        if (variant && variant.id) {
                                                            existingVariantsById.set(
                                                                variant.id,
                                                                variant,
                                                            )
                                                        }
                                                    })

                                                    // Keep existing variants that aren't in the new batches
                                                    const filteredExistingVariants =
                                                        clonedState.variants.filter(
                                                            (v) =>
                                                                v.id &&
                                                                !allBatchVariantsMap.has(v.id),
                                                        )

                                                    // Add all unique variants from the batches
                                                    const newVariantsArray = Array.from(
                                                        allBatchVariantsMap.values(),
                                                    )

                                                    const mergedVariants = [
                                                        ...filteredExistingVariants,
                                                        ...newVariantsArray,
                                                    ]
                                                    // Sort by timestamp
                                                    mergedVariants.sort(
                                                        (a, b) =>
                                                            b.createdAtTimestamp -
                                                            a.createdAtTimestamp,
                                                    )

                                                    clonedState.variants = mergedVariants
                                                } else {
                                                    console.log(
                                                        "No changes detected in variants, keeping existing state",
                                                    )
                                                    // Keep existing variants to preserve any additional data they might have
                                                }
                                            } else if (hasChanges) {
                                                if (changedVariantId) {
                                                    console.log(
                                                        `Detected changes in variants. Changed variant ID: ${changedVariantId}`,
                                                    )
                                                }
                                                if (changedKeys.length > 0) {
                                                    console.log(
                                                        `Detected changes in variants. Changed keys: ${changedKeys.join(", ")}`,
                                                    )
                                                }
                                                clonedState.variants = sortedRevisions
                                            } else {
                                                console.log(
                                                    "No changes detected in variants, keeping existing state",
                                                )
                                                // Keep existing variants to preserve any additional data they might have
                                            }
                                        } else {
                                            // No existing variants, just set the new ones
                                            clonedState.variants = sortedRevisions
                                        }

                                        // Always update spec and uri if they're provided
                                        // But for revalidation, only do this on the last batch
                                        if (
                                            (!currentState?.variants?.length || isLastBatch) &&
                                            spec
                                        ) {
                                            clonedState.spec = spec
                                        }
                                        if (
                                            (!currentState?.variants?.length || isLastBatch) &&
                                            uri
                                        ) {
                                            clonedState.uri = uri
                                        }

                                        if (isLastBatch) {
                                            clonedState.fetching = false
                                        }
                                        return clonedState
                                    },
                                    {revalidate: false},
                                )
                            } catch (error) {
                                console.error("Error updating state with batch:", error)
                            }
                        }

                        // Instead of awaiting the fetch promise here, we'll just let it run and use the batch updates
                        // The batch updates will handle updating the state incrementally
                        // and the .then() handler will end the fetch when everything is done

                        fetchAndProcessRevisions({
                            appId,
                            projectId,
                            appType: config.appType,
                            // TODO: Revisit this implementation @ardaerzin
                            // initialVariants: config.initialVariants,
                            logger: console.log,
                            // Enable parallel batched processing
                            batchSize: 20, // Process 10 revisions at a time
                            parallelProcessing: true,
                            // This callback is called before any batches are processed to set the total
                            onBeforeBatchProcessing: (totalBatches) => {
                                batchTracker.totalBatches = totalBatches
                                console.log(
                                    `Starting batch processing with ${totalBatches} total batches`,
                                )
                            },
                            // Provide the callback for incremental state updates
                            onBatchProcessed: (batchResults, spec, uri) => {
                                // Filter out any variants we've already processed to avoid duplicates
                                const uniqueResults = batchResults.filter((variant) => {
                                    // Skip variants without IDs or those we've already processed
                                    if (!variant.id) {
                                        console.log("Skipping variant without ID")
                                        return false
                                    }

                                    if (batchTracker.processedVariantIds.has(variant.id)) {
                                        console.log(`Skipping duplicate variant: ${variant.id}`)
                                        return false
                                    }

                                    // Add this variant ID to our tracking set
                                    batchTracker.processedVariantIds.add(variant.id)
                                    return true
                                })

                                // Store unique batch results for reference
                                batchTracker.batchesArray.push(uniqueResults)

                                // Increment the processed batches counter
                                batchTracker.processedBatches++

                                console.log(
                                    `onBatchProcessed: ${batchTracker.processedBatches}/${batchTracker.totalBatches}`,
                                )

                                // Check if this is the last batch based on the counter
                                const isLastBatch =
                                    batchTracker.processedBatches === batchTracker.totalBatches

                                // If this is the last batch, mark the batch tracker as complete
                                if (isLastBatch) {
                                    batchTracker.isComplete = true
                                    console.log(
                                        `Batch processing complete. Processed ${batchTracker.processedVariantIds.size} unique variants.`,
                                    )
                                }

                                // Call the original updateStateWithBatch with the isLastBatch flag
                                // We need to handle the async nature of updateStateWithBatch
                                updateStateWithBatch(batchResults, spec, uri, isLastBatch).catch(
                                    (error) => {
                                        console.error("Error in updateStateWithBatch:", error)
                                    },
                                )
                            },
                            // Pass the abort signal to allow cancellation
                            signal,
                        })
                            .then(({revisions, spec, uri}) => {
                                // This will run after all batches are processed
                                console.log(
                                    `All batches processed, total revisions: ${revisions.length}`,
                                    revisions,
                                )

                                // Mark the batch processing as complete
                                batchTracker.isComplete = true

                                // For the final update, we need to get all variants from the current state
                                // and properly set the isLatestRevision flag across all of them
                                globalMutate(
                                    key,
                                    (state: Data | undefined) => {
                                        if (!state) return state
                                        const currentState = structuredClone(state)

                                        // Get all existing variants
                                        const allVariants = [...(currentState.variants || [])]

                                        // Find the latest timestamp across all variants
                                        if (allVariants.length > 0) {
                                            const latestTimestamp = Math.max(
                                                ...allVariants.map(
                                                    (r) => r.createdAtTimestamp || 0,
                                                ),
                                            )

                                            // Set isLatestRevision flag only for the latest revision(s)
                                            allVariants.forEach((revision) => {
                                                revision.isLatestRevision =
                                                    revision.createdAtTimestamp === latestTimestamp
                                            })
                                        }

                                        // Update the state with the corrected variants
                                        currentState.variants = allVariants
                                        currentState.fetching = false

                                        return currentState
                                    },
                                    {revalidate: false},
                                )

                                // End the fetch for this key when everything is complete
                                endFetch(fetchKeyRef.current)
                            })
                            .catch((error) => {
                                // Handle errors in the fetch promise
                                if (error.name !== "AbortError") {
                                    console.error("Error in fetch promise:", error)
                                } else {
                                    console.log("Fetch operation was aborted")
                                }

                                // End the fetch on error
                                endFetch(fetchKeyRef.current)

                                globalMutate(
                                    key,
                                    (currentState: Data | undefined) => {
                                        if (!currentState) return currentState
                                        const clonedState = structuredClone(currentState)
                                        clonedState.fetching = false
                                        clonedState.error = error
                                        return clonedState
                                    },
                                    {revalidate: false},
                                )
                            })

                        // We don't need to update the state here anymore
                        // The batch updates will handle updating the state incrementally
                        // and the .then() handler will end the fetch when everything is done

                        console.log(
                            "Returning initial state while batch updates happen in background",
                        )

                        return state
                    } catch (error: unknown) {
                        // Handle AbortError specially
                        if (
                            controllerRef.current?.signal?.aborted ||
                            (error instanceof Error && error.name === "AbortError") ||
                            (error instanceof Error && error.message === "Operation was aborted")
                        ) {
                            console.log("Fetch operation was aborted")
                        } else {
                            console.error("Error in openApiSchemaFetcher:", error)
                            state.error = error instanceof Error ? error : new Error(String(error))
                        }

                        // End the fetch on error if we have a valid fetchKey
                        if (fetchKeyRef.current) {
                            endFetch(fetchKeyRef.current)
                        }

                        return state
                    }
                },
                [config, fetcher, globalFetcher],
            )

            return useSWRNext(key, openApiSchemaFetcher, {
                ...config,
                compare: (a, b) => {
                    return isEqual(a, b)
                },
            })
        }

        return useImplementation({key, fetcher, config})
    }
}

export default appSchemaMiddleware
