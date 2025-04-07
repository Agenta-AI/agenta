// @ts-nocheck
import {formatDay} from "@/oss/lib/helpers/dateTimeHelper"
import dayjs from "@/oss/lib/helpers/dateTimeHelper/dayjs"
import {getIsFetching, startFetch, endFetch} from "@/oss/lib/hooks/useStatelessVariants/state"
import {User} from "@/oss/lib/Types"
import {fetchVariants, fetchSingleProfile} from "@/oss/services/api"

import {CamelCaseEnvironment} from "../../Types"

import {fetchAndTransformEnvironments, fetchVariantMetadata} from "./api"
import {Enhanced} from "./genericTransformer/types"
import {fetchOpenApiSchemaJson, findCustomWorkflowPath, transformVariants} from "./transformer"
import {EnhancedVariant} from "./transformer/types/transformedVariant"
import {RevisionObject, ParentVariantObject} from "./transformer/types/variant"
import {SharedEnrichmentOptions} from "./types/enriched"

/**
 * Recursively omit specified keys from an object
 */
export const omitDeep = (obj: any, keys: string[]): any => {
    if (!obj || typeof obj !== "object") return obj

    if (Array.isArray(obj)) {
        return obj.map((item) => omitDeep(item, keys))
    }

    return Object.entries(obj).reduce(
        (acc, [key, value]) => {
            if (keys.includes(key)) return acc
            acc[key] = typeof value === "object" ? omitDeep(value, keys) : value
            return acc
        },
        {} as Record<string, any>,
    )
}

/**
 * Remove trailing slash from a URI
 */
export const removeTrailingSlash = (uri: string) => {
    return uri.endsWith("/") ? uri.slice(0, -1) : uri
}

export const uriFixer = (uri: string) => {
    if (!uri.includes("http://") && !uri.includes("https://")) {
        // for oss.agenta.ai
        uri = `https://${uri}`
    } else if (!uri.includes("/services/")) {
        uri = uri.replace("/chat", "/services/chat")
        uri = uri.replace("/completion", "/services/completion")
    }

    // Remove trailing slash if it exists
    return removeTrailingSlash(uri)
}

/**
 * Construct variant URL for testing
 */
export const constructVariantUrl = (
    uri: {routePath?: string; runtimePrefix?: string},
    endpoint = "/test",
    withPrefix = true,
) => {
    const {routePath = "", runtimePrefix = ""} = uri
    const prefix = withPrefix ? runtimePrefix : ""
    return `${prefix}${routePath}${endpoint}`
}

/**
 * Finds all environments where a specific revision is deployed
 */
export const findRevisionDeployment = (
    revisionId: string,
    environments: CamelCaseEnvironment[],
): CamelCaseEnvironment[] => {
    return environments.filter((env) => env.deployedAppVariantRevisionId === revisionId)
}

/** Enhanced property utilities */
export const getEnhancedProperties = (obj: Record<string, any> | undefined, exclude?: string[]) => {
    if (!obj) return []
    return Object.entries(obj)
        .filter(([key]) => !exclude?.includes(key))
        .reduce((acc, [_, value]) => {
            if (value && typeof value === "object" && "__id" in value) {
                acc.push(value)
            }
            return acc
        }, [] as Enhanced<unknown>[])
}

/**
 * Creates batches from an array of items for processing
 *
 * @param items Array of items to split into batches
 * @param batchSize Number of items per batch
 * @returns Array of batches
 */
export const createBatches = <T>(items: T[], batchSize: number): T[][] => {
    return Array.from({length: Math.ceil(items.length / batchSize)}, (_, i) =>
        items.slice(i * batchSize, (i + 1) * batchSize),
    )
}

/**
 * Process batches sequentially with optional callback after each batch
 *
 * @param batches Array of batches to process
 * @param processFn Function to process each batch
 * @param onBatchProcessed Optional callback after each batch is processed
 * @returns Array of all processed results
 */
export const processBatchesSequentially = async <T, R>(
    batches: T[][],
    processFn: (batch: T[]) => Promise<R[]>,
    onBatchProcessed?: (results: R[], batchIndex: number, totalBatches: number) => void,
): Promise<R[]> => {
    const allResults: R[] = []

    for (let i = 0; i < batches.length; i++) {
        const batch = batches[i]
        const results = await processFn(batch)
        allResults.push(...results)

        if (onBatchProcessed) {
            onBatchProcessed(results, i, batches.length)
        }
    }

    return allResults
}

/**
 * Standardized error handling for variant processing operations
 *
 * @param error The error that occurred
 * @param fetchKey The fetch key to end if needed
 * @param logger Optional logging function
 * @throws The original error or a wrapped error
 */
export const handleVariantProcessingError = (
    error: any,
    fetchKey: string,
    logger = console.log,
) => {
    if (error.name === "AbortError") {
        logger("Fetch aborted by user")
        endFetch(fetchKey)
        throw new Error("AbortError")
    }

    logger("Error in variant processing:", error)
    endFetch(fetchKey)
    throw error
}

/**
 * Process variants and their revisions with common error handling and logging
 */
async function processVariantsWithMetadata({
    variants,
    spec,
    uri,
    fetchKey,
    batchSize = 5,
    parallelProcessing = false,
    onBatchProcessed = null,
    onBeforeBatchProcessing = null,
}: {
    variants: any[]
    spec: any
    uri: any
    fetchKey: string
    batchSize?: number
    parallelProcessing?: boolean
    onBatchProcessed?: ((batchResults: any[], spec: any, uri: any) => void) | null
    onBeforeBatchProcessing?: ((totalBatches: number) => void) | null
}) {
    try {
        // Extract revisions from variants
        const allRevisions = variants.flatMap((variant) => {
            if (!variant.revisions?.length) {
                console.warn(`No revisions found for variant ${variant.variantId}`, variant)
                return []
            }
            return variant.revisions
        })

        // Process revisions in batches
        const batches = createBatches(allRevisions, batchSize)

        if (onBeforeBatchProcessing) {
            onBeforeBatchProcessing(batches.length)
        }

        const processedVariants = await processBatchesSequentially(batches, async (batch) => {
            const transformed = await transformVariants(batch, spec)

            if (onBatchProcessed) {
                onBatchProcessed(transformed, spec, uri)
            }
            return transformed
        })

        return processedVariants
    } catch (error) {
        endFetch(fetchKey)
        throw error
    }
}

export async function fetchPriorityRevisions({
    appId,
    projectId,
    revisionIds,
    fallbackToLatest = true,
}: SharedEnrichmentOptions & {
    revisionIds?: string[]
    fallbackToLatest?: boolean
}): Promise<{
    revisions: any[]
    spec: any
    uri: any
}> {
    const fetchKey = `priority_${appId}}`

    try {
        // 1. Fetch variants and environments in parallel
        const [rawVariants, environments] = await Promise.all([
            fetchVariants(appId),
            fetchAndTransformEnvironments(appId),
        ])

        // 2. Get URI information
        const uri = rawVariants[0].uri ? await findCustomWorkflowPath(rawVariants[0].uri) : null
        if (!uri) {
            throw new Error("Failed to find URI path")
        }

        // 3. Fetch OpenAPI schema
        const spec = (await fetchOpenApiSchemaJson(uri.runtimePrefix))?.schema
        if (!spec) {
            throw new Error("Failed to fetch OpenAPI schema")
        }

        // Skip if no variants or no revisions needed
        if (!rawVariants.length || (!revisionIds?.length && !fallbackToLatest)) {
            endFetch(fetchKey)
            return {revisions: [], spec, uri}
        }

        // Group revisions by variant
        const variantMap = new Map()
        for (const variant of [
            rawVariants.sort((a, b) => b.updatedAtTimestamp - a.updatedAtTimestamp)[0],
        ]) {
            const [revisions] = await fetchVariantMetadata(
                variant.variantId,
                projectId,
                variant.modifiedById,
            )

            // Get variant-specific environments
            const variantEnvironments = environments.filter(
                (env) => env.deployedAppVariantId === variant.variantId,
            )

            // Filter and transform revisions
            const filteredRevisions = revisions
                .filter((rev) => !!revisionIds && revisionIds.includes(rev.id))
                .map((rev) => {
                    const adapted = adaptRevisionToVariant(
                        {
                            id: rev.id,
                            revision: rev.revision,
                            modifiedBy: rev.modified_by,
                            commitMessage: rev.commit_message || null,
                            parameters: rev.config.parameters,
                            createdAt: formatDay(rev.created_at),
                            createdAtTimestamp: dayjs(
                                rev.created_at,
                                "YYYY/MM/DD H:mm:ssAZ",
                            ).valueOf(),
                            deployedIn: findRevisionDeployment(rev.id, variantEnvironments),
                        },
                        variant,
                    )

                    return adapted
                })

            if (filteredRevisions.length > 0) {
                variantMap.set(variant.variantId, {
                    ...variant,
                    deployedIn: variantEnvironments,
                    revisions: filteredRevisions,
                })
            }
        }

        // Process the variants with their revisions
        const processedRevisions = await processVariantsWithMetadata({
            variants: Array.from(variantMap.values()),
            spec,
            uri,
            fetchKey,
            prefix: "PRIORITY",
            batchSize: 5,
        })

        // End the fetch for this key when complete
        endFetch(fetchKey)

        return {
            revisions: processedRevisions,
            spec,
            uri,
        }
    } catch (error) {
        endFetch(fetchKey)
        throw error
    }
}

/**
 * Fetches revisions for specific variant IDs
 * This is optimized for cases where we need to fetch only specific variants (e.g., after creating a new variant)
 *
 * @param appId The application ID
 * @param projectId The project ID
 * @param variantIds Array of variant IDs to fetch
 * @param logger Optional logging function
 * @returns Processed revisions for the specified variants, spec and URI info
 */
export async function fetchRevisionsByVariantIds({
    appId,
    projectId,
    variantIds,
    logger = console.log,
}: SharedEnrichmentOptions & {
    variantIds: string[]
}): Promise<{
    revisions: any[]
    spec: any
    uri: any
}> {
    const fetchKey = `variant_${appId}}`
    startFetch(fetchKey)

    logger(
        `[VARIANT_PRIORITY] Starting with ${variantIds.length} variant IDs: ${JSON.stringify(variantIds)}`,
    )

    try {
        // 1. Fetch variants and environments in parallel
        const [rawVariants, environments] = await Promise.all([
            fetchVariants(appId),
            fetchAndTransformEnvironments(appId),
        ])

        if (!rawVariants.length) {
            throw new Error("No variants found")
        }

        // 2. Get URI information (needed for schema)
        const uriStartTime = performance.now()
        const uri = rawVariants[0].uri ? await findCustomWorkflowPath(rawVariants[0].uri) : null

        if (!uri) {
            throw new Error("Failed to find URI path")
        }

        // 3. Fetch OpenAPI schema (needed for transformation)
        const schemaStartTime = performance.now()
        const spec = (await fetchOpenApiSchemaJson(uri.runtimePrefix))?.schema
        logger(
            `[VARIANT_PRIORITY] Fetched schema in ${(performance.now() - schemaStartTime).toFixed(2)}ms`,
        )
        if (!spec) {
            throw new Error("Failed to fetch OpenAPI schema")
        }

        // 4. Filter variants to only those we need
        const targetVariants = rawVariants.filter((variant) =>
            variantIds.includes(variant.variantId),
        )
        logger(
            `[VARIANT_PRIORITY] Found ${targetVariants.length}/${variantIds.length} requested variants`,
        )

        if (targetVariants.length === 0) {
            logger("[VARIANT_PRIORITY] No matching variants found")
            return {
                revisions: [],
                spec,
                uri,
            }
        }

        // 5. Fetch metadata for the target variants
        const metadataStartTime = performance.now()
        logger(`[VARIANT_PRIORITY] Starting metadata fetch for ${targetVariants.length} variants`)

        const targetRevisions = []

        // Process variants one by one
        for (const variant of targetVariants) {
            const variantStartTime = performance.now()
            logger(`[VARIANT_PRIORITY] Fetching metadata for variant ${variant.variantId}`)

            const [revisions] = await fetchVariantMetadata(
                variant.variantId,
                projectId,
                variant.modifiedById,
            )

            logger(
                `[VARIANT_PRIORITY] Fetched metadata for variant ${variant.variantId} with ${revisions.length} revisions in ${(performance.now() - variantStartTime).toFixed(2)}ms`,
            )

            // Add all revisions for this variant
            // Get variant-specific environments
            const variantEnvironments = environments.filter(
                (env) => env.deployedAppVariantId === variant.variantId,
            )

            targetRevisions.push(
                ...revisions.map((rev) => ({
                    ...rev,
                    variantId: variant.variantId,
                    variant,
                    deployedIn: findRevisionDeployment(rev.id, variantEnvironments),
                })),
            )
        }

        logger(
            `[VARIANT_PRIORITY] Completed metadata fetch in ${(performance.now() - metadataStartTime).toFixed(2)}ms`,
        )
        logger(
            `[VARIANT_PRIORITY] Found ${targetRevisions.length} total revisions for requested variants`,
        )

        // 6. Transform the revisions
        logger(`[VARIANT_PRIORITY] Starting transformation of ${targetRevisions.length} revisions`)

        // Adapt revisions to variant-like format using the standard adapter function
        const adaptedRevisions = await Promise.all(
            targetRevisions.map(async (revision) => {
                // Use the standard adapter function to ensure consistency
                return adaptRevisionToVariant(revision, revision.variant)
            }),
        )

        console.log("add variant adaptedRevisions", adaptedRevisions)

        // 7. Use core processing utility for transformation and marking latest revisions
        try {
            // Use our core processing function
            const result = await processVariantsCore({
                rawVariants: targetVariants,
                targetRevisions: adaptedRevisions,
                spec,
                uri,
                logger: (msg, ...params) => logger(`[VARIANT_PRIORITY] ${msg}`, ...params),
                fetchKey,
                batchSize: 10, // Process more revisions at once for variant-specific fetches
            })

            // Mark latest revision for each variant
            if (result.revisions.length > 0) {
                // Group revisions by variant
                const variantMap = new Map()

                // Group revisions by variant ID
                for (const revision of result.revisions) {
                    if (!variantMap.has(revision.variantId)) {
                        variantMap.set(revision.variantId, [])
                    }
                    variantMap.get(revision.variantId).push(revision)
                }

                // For each variant, find its latest revision
                for (const [, revisions] of variantMap.entries()) {
                    // Sort by timestamp descending
                    revisions.sort((a, b) => b.createdAtTimestamp - a.createdAtTimestamp)

                    // Mark the first one (latest) as the latest variant revision
                    if (revisions.length > 0) {
                        revisions[0].isLatestVariantRevision = true
                    }
                }
            }

            const totalTime = performance.now() - startTime
            logger(
                `[VARIANT_PRIORITY] Completed in ${totalTime.toFixed(2)}ms for ${result.revisions.length} revisions`,
            )
            endFetch(fetchKey)
            return result
        } catch (error) {
            logger(`[VARIANT_PRIORITY] Error processing variant revisions: ${error.message}`)
            endFetch(fetchKey)

            // Return unprocessed revisions if transformation fails
            return {
                revisions: adaptedRevisions,
                spec,
                uri,
            }
        }
    } catch (error) {
        return handleVariantProcessingError(error, fetchKey, (msg, ...params) =>
            logger(`[VARIANT_PRIORITY] ${msg}`, ...params),
        )
    }
}

/**
 * Core function for processing variants and revisions
 * This is used by other specialized fetch functions to avoid code duplication
 *
 * @param options Processing options including variants, revisions, and callbacks
 * @returns Processed variants/revisions with spec and URI information
 */
export const processVariantsCore = async ({
    rawVariants,
    targetRevisions,
    spec,
    uri,
    signal,
    batchSize = 5,
    parallelProcessing = false,
    onBatchProcessed = null,
    onBeforeBatchProcessing = null,
    logger = console.log,
    fetchKey,
}: {
    rawVariants: any[]
    targetRevisions: any[]
    spec: any
    uri: any
    signal?: AbortSignal
    batchSize?: number
    parallelProcessing?: boolean
    onBatchProcessed?: ((batchResults: any[], spec: any, uri: any) => void) | null
    onBeforeBatchProcessing?: ((totalBatches: number) => void) | null
    logger?: (message?: any, ...optionalParams: any[]) => void
    fetchKey: string
}): Promise<{
    revisions: any[]
    spec: any
    uri: any
}> => {
    try {
        // Create batches for processing
        const batches = createBatches(targetRevisions, batchSize)

        if (onBeforeBatchProcessing) {
            onBeforeBatchProcessing(batches.length)
        }

        logger(`Processing ${targetRevisions.length} revisions in ${batches.length} batches`)

        // Process batches sequentially
        const processedRevisions = await processBatchesSequentially(
            batches,
            async (batch) => {
                // Transform the batch of revisions
                const transformedBatch = await transformVariants(batch, spec)

                if (onBatchProcessed) {
                    onBatchProcessed(transformedBatch, spec, uri)
                }

                return transformedBatch
            },
            (results, batchIndex, totalBatches) => {
                logger(
                    `Processed batch ${batchIndex + 1}/${totalBatches} with ${results.length} revisions`,
                )
            },
        )

        return {
            revisions: processedRevisions,
            spec,
            uri,
        }
    } catch (error) {
        return handleVariantProcessingError(error, fetchKey, logger)
    }
}

export async function fetchAndProcessRevisions({
    appId,
    projectId,
    initialVariants,
    initialSpec,
    forceRefresh = false,
    keyParts,
    excludeRevisionIds = [],
    signal,
    logger = console.log,
    priorityMode = false, // New flag to indicate if this is a priority fetch
    batchSize = 5, // Default batch size for parallel processing
    parallelProcessing = false, // Flag to enable parallel processing
    onBatchProcessed = null, // Callback for incremental state updates
    onBeforeBatchProcessing = null, // Callback to notify about total batches before processing starts
}: SharedEnrichmentOptions & {
    forceRefresh?: boolean
    excludeRevisionIds?: string[]
    signal?: AbortSignal
    priorityMode?: boolean // Flag to control early termination behavior
    batchSize?: number // Number of variants to process in parallel
    parallelProcessing?: boolean // Whether to use parallel processing
    onBatchProcessed?: ((batchResults: any[], spec: any, uri: any) => void) | null // Callback for incremental state updates
    onBeforeBatchProcessing?: ((totalBatches: number) => void) | null // Callback to notify about total batches before processing starts
    keyParts?: string
}): Promise<{
    revisions: any[]
    spec: any
    uri: any
}> {
    // Generate a unique key for this fetch operation
    const fetchKey = JSON.stringify({
        appId,
        projectId,
        priorityMode,
        excludeRevisionIds: excludeRevisionIds.length,
        keyParts: keyParts || "",
    })

    // Check if we're already fetching data for this key
    if (getIsFetching(fetchKey)) {
        logger(`Already fetching data for key: ${fetchKey}, skipping this request`)
        return {
            revisions: [],
        }
        throw new Error("Already fetching data for this key")
    }

    // Start a new fetch and get the abort controller
    const controller = startFetch(fetchKey)
    // Create a composite abort signal that combines our controller with any passed signal
    const abortController = new AbortController()
    const compositeSignal = abortController.signal

    // If the passed signal aborts, abort our controller too
    if (signal) {
        signal.addEventListener("abort", () => {
            abortController.abort()
        })
    }

    // If our controller aborts, abort the composite signal
    controller.signal.addEventListener("abort", () => {
        abortController.abort()
    })

    try {
        // 1. Fetch variants and environments in parallel
        const [rawVariants, environments] = await Promise.all([
            !forceRefresh && initialVariants?.length ? initialVariants : fetchVariants(appId),
            fetchAndTransformEnvironments(appId),
        ])

        if (!rawVariants.length) {
            return {
                revisions: [],
            }
        }

        // Check for abort signal
        if (compositeSignal.aborted) {
            throw new Error("Operation was aborted")
        }

        // 2. Find correct URI path early (needed for OpenAPI schema)
        // But don't throw if we can't find it - we'll handle it gracefully
        let uri = null
        try {
            uri = rawVariants[0].uri ? await findCustomWorkflowPath(rawVariants[0].uri) : null
            if (!uri) {
                logger("Warning: Failed to find URI path, some functionality may be limited")
            }
        } catch (error) {
            logger("Warning: Error finding URI path, some functionality may be limited", error)
        }

        // 3. Fetch OpenAPI schema (always fetch if forceRefresh is true)
        let spec = null
        // Track app status based on whether we can fetch the schema
        let appStatus = false

        if (uri?.runtimePrefix) {
            try {
                spec =
                    !forceRefresh && initialSpec
                        ? initialSpec
                        : (await fetchOpenApiSchemaJson(uri.runtimePrefix))?.schema

                if (spec) {
                    // If we successfully fetched the schema, set appStatus to true
                    appStatus = true
                } else {
                    logger(
                        "Warning: Failed to fetch OpenAPI schema, some functionality may be limited",
                    )
                }
            } catch (error) {
                logger(
                    "Warning: Error fetching OpenAPI schema, some functionality may be limited",
                    error,
                )
            }
        } else {
            logger("Skipping OpenAPI schema fetch due to missing URI")
        }

        // Check for abort signal
        if (compositeSignal.aborted) {
            throw new Error("Operation was aborted")
        }

        // 4. Minimal processing to get revision data (without unnecessary transformations)
        // This fetches revision history and environment deployments, but doesn't transform variants
        // Log if we're in background mode
        const isBackgroundMode = excludeRevisionIds.length > 0
        if (isBackgroundMode) {
            logger(
                `Processing in background mode, excluding ${excludeRevisionIds.length} already loaded revisions`,
            )
        }

        // Set up for parallel processing
        // Use custom batch size if parallel processing is enabled
        const actualBatchSize = parallelProcessing ? batchSize : 5
        const variantsWithRevisions = []

        // Process variants in parallel batches
        logger(
            `Starting parallel processing of ${rawVariants.length} variants in batches of ${actualBatchSize}`,
        )

        // Calculate total number of batches
        const totalBatches = Math.ceil(rawVariants.length / actualBatchSize)

        // Call the onBeforeBatchProcessing callback if provided
        if (typeof onBeforeBatchProcessing === "function") {
            logger(`Calling onBeforeBatchProcessing with totalBatches: ${totalBatches}`)
            onBeforeBatchProcessing(totalBatches)
        }

        // Split variants into batches
        for (let i = 0; i < rawVariants.length; i += actualBatchSize) {
            // Check for abort signal before processing each batch
            if (compositeSignal.aborted) {
                throw new Error("Operation was aborted")
            }

            const variantBatch = rawVariants.slice(i, i + actualBatchSize)
            logger(
                `Processing batch ${Math.floor(i / actualBatchSize) + 1} with ${variantBatch.length} variants`,
            )

            // Process each batch in parallel
            const batchResults = await Promise.all(
                variantBatch.map(async (variant) => {
                    // Fetch revisions and deployments for this variant

                    logger(
                        `[Batch ${Math.floor(i / actualBatchSize) + 1}] Fetching metadata for variant ${variant.variantId}`,
                    )

                    try {
                        const [revisions] = await fetchVariantMetadata(
                            variant.variantId,
                            projectId,
                            variant.modifiedById,
                        )

                        // Filter out excluded revisions
                        const filteredRevisions = revisions.filter(
                            (rev) => !excludeRevisionIds.includes(rev.id),
                        )

                        // Get variant-specific environments
                        const variantEnvironments = environments.filter(
                            (env) => env.deployedAppVariantId === variant.variantId,
                        )

                        const updated = {
                            ...variant,
                            appStatus,
                            deployedIn: variantEnvironments,
                            revisions: filteredRevisions.map((rev) => ({
                                id: rev.id,
                                appStatus,
                                revision: rev.revision,
                                modifiedBy: rev.modified_by,
                                variantId: variant.variantId,
                                commitMessage: rev.commit_message || null,
                                config: {
                                    configName: rev.config.config_name,
                                    parameters: rev.config.parameters,
                                },
                                createdAt: formatDay(rev.created_at),
                                createdAtTimestamp: dayjs(
                                    rev.created_at,
                                    "YYYY/MM/DD H:mm:ssAZ",
                                ).valueOf(),
                                deployedIn: findRevisionDeployment(rev.id, variantEnvironments),
                            })),
                        }

                        return updated
                    } catch (error) {
                        logger(
                            `[Batch ${Math.floor(i / actualBatchSize) + 1}] Error fetching metadata for variant ${variant.variantId}: ${error.message}`,
                        )
                        // Return variant with empty revisions to avoid breaking the entire process
                        return {
                            ...variant,
                            appStatus,
                            deployedIn: [],
                            revisions: [],
                        }
                    }
                }),
            )

            // Add batch results to our collection
            variantsWithRevisions.push(...batchResults)
            // Call the callback function if provided to update state incrementally
            if (onBatchProcessed) {
                onBatchProcessed([...variantsWithRevisions], spec, uri)
            }
        }

        // 5. Collect all user IDs for revisions and variants
        const userIds = new Set<string>()
        variantsWithRevisions.forEach((variant) => {
            if (variant.modifiedBy) userIds.add(variant.modifiedBy)
            variant.revisions?.forEach((revision) => {
                if (revision.modifiedBy) userIds.add(revision.modifiedBy)
            })
        })

        // 6. Fetch all user profiles in one batch
        const userProfilesMap = new Map<string, User | null>()
        try {
            const userProfiles = await Promise.all(
                Array.from(userIds).map(async (userId) => {
                    try {
                        return await fetchSingleProfile(userId, true)
                    } catch (e) {
                        return null
                    }
                }),
            )
            userProfiles.forEach((profile) => {
                if (profile && profile.id) {
                    userProfilesMap.set(profile.id, profile)
                }
            })
        } catch (error) {
            console.error("Error fetching user profiles:", error)
        }

        // 7. Flatten variants to revisions and adapt each revision to look like a variant
        const adaptedRevisions = variantsWithRevisions.flatMap((_variant) => {
            const variant = _variant
            const _revisions = structuredClone(variant.revisions)
            return (
                _revisions?.map((revision) => {
                    // Get user profiles for both variant and revision
                    const revisionUserProfile = revision.modifiedBy
                        ? userProfilesMap.get(revision.modifiedBy)
                        : null
                    const variantUserProfile = variant.modifiedBy
                        ? userProfilesMap.get(variant.modifiedBy)
                        : null

                    // Create a variant-like object from the revision
                    const adapted = adaptRevisionToVariant(
                        {
                            ...revision,
                            userProfile: revisionUserProfile,
                        },
                        {
                            ...variant,
                            userProfile: variantUserProfile,
                            // Add URI for proper transformation if available, otherwise use a default
                            uriObject: uri || {
                                routePath: "",
                                runtimePrefix: variant.uri,
                            },
                        },
                    )

                    variant.createdBy = adapted._parentVariant?.createdBy

                    return adapted
                }) || []
            )
        })

        // 8. Mark latest revision and variant revision flags
        if (adaptedRevisions.length > 0) {
            // We no longer need to find the latest variant since we're using timestamps directly
            // This code has been removed as it's no longer needed

            // Find the single latest revision across all variants
            let latestRevisionTimestamp = 0
            let latestRevisionId = null

            // First pass: find the latest revision timestamp across all revisions
            adaptedRevisions.forEach((revision) => {
                if (revision.createdAtTimestamp > latestRevisionTimestamp) {
                    latestRevisionTimestamp = revision.createdAtTimestamp
                    latestRevisionId = revision.id
                }
            })

            // Second pass: set isLatestRevision flag for all revisions
            adaptedRevisions.forEach((revision) => {
                // Only the single latest revision gets isLatestRevision = true
                revision.isLatestRevision = revision.id === latestRevisionId

                // We no longer need to set isLatestVariantRevision as we're using timestamps directly
                // Keep this property for backward compatibility but set it to false
                revision.isLatestVariantRevision = false
            })

            logger("Applied latest revision flag to a single revision across the app")
        }

        // 9. Use core processing utility for transformation
        try {
            // Use our core processing function
            const result = await processVariantsCore({
                rawVariants,
                targetRevisions: adaptedRevisions,
                spec,
                uri,
                signal: compositeSignal,
                batchSize,
                parallelProcessing,
                onBatchProcessed,
                onBeforeBatchProcessing: null, // We've already called this earlier
                logger,
                fetchKey,
            })

            // Add appStatus to each variant
            result.revisions.forEach((revision) => {
                revision.appStatus = appStatus
            })

            // End the fetch for this key when complete
            endFetch(fetchKey)

            return {
                ...result,
                // Include the overall app status in the return value
                appStatus,
            }
        } catch (error) {
            logger("Error in core processing:", error)

            // Add appStatus to each variant even if transformation failed
            adaptedRevisions.forEach((revision) => {
                revision.appStatus = appStatus
            })

            // End the fetch for this key when complete
            endFetch(fetchKey)

            return {
                revisions: adaptedRevisions,
                // Return whatever spec and uri we have, even if they're null
                spec,
                uri,
                // Include the overall app status in the return value
                appStatus,
            }
        }
    } catch (error) {
        // Handle AbortError specially
        if (
            compositeSignal.aborted ||
            error.name === "AbortError" ||
            error.message === "Operation was aborted"
        ) {
            logger("Fetch operation was aborted")
            // End the fetch on abort
            endFetch(fetchKey)
            throw new Error("AbortError")
        }

        logger("Error in fetchAndProcessRevisions:", error)
        // End the fetch on any other error
        endFetch(fetchKey)
        throw error
    }
}

/**
 * Validates a variant or revision object has all required fields
 *
 * @param object The variant or revision object to validate
 * @param requiredFields Array of field names that must exist
 * @param objectType Name of the object type for logging purposes
 * @returns boolean indicating if the object is valid
 */
export const validateVariantObject = (
    object: any,
    requiredFields: string[] = ["id"],
    objectType = "object",
): boolean => {
    if (!object) {
        console.warn(`Missing ${objectType}`)
        return false
    }

    const missingFields = requiredFields.filter((field) => !object[field])
    if (missingFields.length > 0) {
        console.warn(
            `Missing required fields in ${objectType}: ${missingFields.join(", ")}`,
            object,
        )
        return false
    }

    return true
}

/**
 * Merges a variant with new data, ensuring critical fields are preserved
 *
 * @param existingVariant The existing variant in the state
 * @param newVariant The new variant data to merge
 * @returns The merged variant with all fields properly preserved
 */
export const mergeVariantData = (existingVariant: any, newVariant: any): any => {
    if (!existingVariant) return newVariant
    if (!newVariant) return existingVariant

    // Start with the new variant data as the base
    const result = {
        ...existingVariant,
        ...newVariant,
    }

    // Special handling for critical fields that need to be preserved
    // deployedIn is especially important to preserve from the new variant
    result.deployedIn = newVariant.deployedIn || existingVariant.deployedIn || []

    // Preserve nested objects with special merging logic if needed
    if (existingVariant.parameters && newVariant.parameters) {
        result.parameters = {
            ...existingVariant.parameters,
            ...newVariant.parameters,
        }
    }

    return result
}

/**
 * Adapts a revision to appear as a variant for UI/API compatibility
 *
 * IMPORTANT: This function creates a base adapter revision that can be passed to
 * transformVariants later for proper schema-based transformation. It prioritizes
 * revision-specific configuration values over parent variant values.
 *
 * @param revision The revision object to adapt
 * @param parentVariant The parent variant that contains this revision
 * @returns An EnhancedVariant-like object that combines revision and parent variant data
 */
export const adaptRevisionToVariant = (
    revision: RevisionObject,
    parentVariant: ParentVariantObject,
): EnhancedVariant => {
    // Validate input objects
    validateVariantObject(revision, ["id", "_id"], "revision")
    validateVariantObject(parentVariant, ["id", "variantId"], "parent variant")

    // Ensure we have a valid parent variant ID
    const parentId = parentVariant.id || parentVariant.variantId
    if (!parentId) {
        console.warn("Missing parent variant ID in adaptRevisionToVariant", parentVariant)
    }

    // Ensure revision ID exists
    const revisionId = revision.id || revision._id
    if (!revisionId) {
        console.warn("Missing revision ID in adaptRevisionToVariant", revision)
    }

    if (revision.revision === 0) {
        parentVariant.createdBy = revision.createdBy || revision.modifiedBy
    } else if (revision.revision === 1 && !parentVariant.createdBy) {
        parentVariant.createdBy = revision.modifiedBy
    }

    return {
        // Core variant properties needed for compatibility
        id: revisionId,
        name: parentVariant.name || parentVariant.variantName, // Fallback to variantName if name is missing
        variantName: parentVariant.variantName,
        baseId: parentVariant.baseId,
        baseName: parentVariant.baseName,
        configName: parentVariant.configName,
        appId: parentVariant.appId,
        appStatus: revision.appStatus || parentVariant.appStatus,
        uri: parentVariant.uri,
        uriObject: parentVariant.uriObject,
        inputs: parentVariant.inputs,
        inputParams: parentVariant.inputParams,

        // Copy variant essential properties for UI components
        isChat: parentVariant.isChat,
        isCustom: parentVariant.isCustom,
        isChatVariant: parentVariant.isChatVariant,
        isStatelessVariant: parentVariant.isStatelessVariant,

        // These are the fields we want to prioritize from the revision, NOT from parent variant
        // Each revision has its own unique configuration values
        parameters: revision.parameters || revision.config?.parameters,
        prompts: revision.prompts || parentVariant.prompts,
        customProperties: revision.customProperties || parentVariant.customProperties,

        // Variant ID for backwards compatibility with APIs
        variantId: parentId,

        // Revision-specific fields
        _revisionId: revisionId,
        revision: revision.revision,
        updatedAt: revision.createdAt || parentVariant.createdAt,
        createdAt: revision.createdAt || parentVariant.createdAt,
        updatedAtTimestamp: revision.createdAtTimestamp || parentVariant.createdAtTimestamp,
        createdAtTimestamp: revision.createdAtTimestamp || parentVariant.createdAtTimestamp,
        modifiedById: revision.modifiedById || parentVariant.modifiedById,
        modifiedBy: revision.modifiedBy || parentVariant.modifiedBy || null,
        userProfile: revision.userProfile || parentVariant.userProfile || null, // Store full user profile object
        commitMessage: revision.commitMessage || null,

        // Status flags - ensure they're boolean values
        isLatestRevision: revision.isLatestRevision,
        isLatestVariantRevision: !!revision.isLatestVariantRevision,
        _isRevisionBased: true, // Internal flag for documentation

        // Deployment information - essential for showing environment badges
        deployedIn: revision.deployedIn || [],

        // Preserve full parent variant reference for component access
        _parentVariant: {
            id: parentId,
            name: parentVariant.name || parentVariant.variantName,
            variantName: parentVariant.name || parentVariant.variantName, // TODO: Deprecate later @ardaerzi
            variantId: parentId,
            revision: parentVariant.revision,
            isLatestRevision: revision.isLatestRevision,
            baseId: parentVariant.baseId,
            baseName: parentVariant.baseName,
            configName: parentVariant.configName,
            parameters: parentVariant.parameters,
            createdAt: parentVariant.createdAt,
            updatedAt: parentVariant.updatedAt,
            createdBy: parentVariant.createdBy,
            templateVariantName: parentVariant.templateVariantName,
            commitMessage: (parentVariant.revisions || []).sort(
                (a, b) => b.revision - a.revision,
            )[0]?.commitMessage,
            inputs: parentVariant.inputs,
            inputParams: parentVariant.inputParams,
        },
    }
}

/**
 * Set variant with URI information
 */
// TODO: DEPRECATE
export const setVariant = (
    variant: any,
    uri: {
        runtimePrefix: string
        routePath?: string
    },
): EnhancedVariant => {
    // TEMPORARY FIX FOR PREVIOUSLY CREATED AGENTA_CONFIG
    // TODO: REMOVE THIS BEFORE RELEASE.
    if (variant.parameters.agenta_config) {
        variant.parameters.ag_config = variant.parameters.agenta_config
        delete variant.parameters.agenta_config
    }

    if (variant.variantId) {
        variant.id = variant.variantId
        variant.parameters = {
            ...variant.parameters,
            agConfig: variant.parameters.agConfig || variant.parameters.ag_config || {},
        }

        return variant
    }

    return {
        id: variant.variant_id,
        uri: uriFixer(variant.uri),
        appId: variant.app_id,
        baseId: variant.base_id,
        baseName: variant.base_name,
        variantName: variant.variant_name,
        templateVariantName: variant.template_variant_name,
        revision: variant.revision,
        configName: variant.config_name,
        projectId: variant.project_id,
        appName: variant.app_name,
        parameters: {
            agConfig: variant.parameters.ag_config || {},
        },
        isChat: false,
        inputs: {} as EnhancedVariant["inputs"],
        messages: {} as EnhancedVariant["messages"],
        name: "",
        uriObject: uri,
    } as EnhancedVariant
}
