import {useCallback} from "react"

import type {Key} from "swr"
import type {SWRHook} from "swr"

import {message} from "@/oss/components/AppMessageContext"
import {hashVariant} from "@/oss/components/NewPlayground/assets/hash"
import {getCurrentProject} from "@/oss/contexts/project.context"
import type {FetcherOptions} from "@/oss/lib/api/types"
import {useGlobalVariantsRefetch} from "@/oss/lib/hooks/useStatelessVariants"
import {
    getSpecLazy,
    getAllMetadata,
    atomStore,
    allRevisionsAtom,
    specAtom,
} from "@/oss/lib/hooks/useStatelessVariants/state"
import {LightweightRevision} from "@/oss/lib/hooks/useStatelessVariants/state/types"
import {transformVariant, fetchAndProcessRevisions} from "@/oss/lib/shared/variant"
import {generateId} from "@/oss/lib/shared/variant/stringUtils"
import {transformToRequestBody} from "@/oss/lib/shared/variant/transformer/transformToRequestBody"
import type {User, Variant} from "@/oss/lib/Types"
import {getJWT} from "@/oss/services/api"

import type {EnhancedVariant} from "../../../../../lib/shared/variant/transformer/types"
import useWebWorker from "../../useWebWorker"
import {
    createVariantsCompare,
    setVariant,
    findParentOfPropertyInObject,
    findItemInHistoryValueById,
} from "../assets/helpers"
import {constructChatHistory} from "../assets/messageHelpers"
import type {
    PlaygroundStateData,
    PlaygroundMiddleware,
    PlaygroundSWRConfig,
    PlaygroundMiddlewareParams,
    PlaygroundResponse,
} from "../types"

import usePlaygroundUtilities from "./hooks/usePlaygroundUtilities"

const playgroundVariantsMiddleware: PlaygroundMiddleware = <
    Data extends PlaygroundStateData = PlaygroundStateData,
    Selected = unknown,
>(
    useSWRNext: SWRHook,
) => {
    return (
        key: Key,
        fetcher: ((url: string, options?: FetcherOptions) => Promise<Data>) | null,
        config: PlaygroundSWRConfig<Data>,
    ) => {
        const useImplementation = ({key, fetcher, config}: PlaygroundMiddlewareParams<Data>) => {
            const {logger, valueReferences, addToValueReferences} = usePlaygroundUtilities({
                config: {
                    ...config,
                    name: "playgroundVariantsMiddleware",
                },
            })
            const refetchVariants = useGlobalVariantsRefetch()
            const swr = useSWRNext(key, fetcher, {
                ...config,
                revalidateOnMount:
                    config.revalidateOnMount ??
                    !(
                        valueReferences.current.includes("variants") ||
                        valueReferences.current.includes("variantIds")
                    ),
                compare: useCallback(
                    (a?: Data, b?: Data) => {
                        const variantsReferenced =
                            valueReferences.current.includes("variants") ||
                            valueReferences.current.includes("variantIds")
                        logger(`COMPARE - ENTER`, variantsReferenced)
                        const wrappedComparison = config.compare?.(a, b)

                        if (!variantsReferenced) {
                            logger(`COMPARE - WRAPPED 1`, wrappedComparison)
                            return wrappedComparison
                        } else {
                            if (wrappedComparison) {
                                logger(
                                    `COMPARE - VARIANTS REFERENCED - return wrapped`,
                                    wrappedComparison,
                                )
                                return true
                            } else {
                                logger(
                                    `COMPARE - VARIANTS REFERENCED - return COMPARISON`,
                                    wrappedComparison,
                                )
                                return createVariantsCompare()(a, b)
                            }
                        }
                    },
                    [config, logger, valueReferences],
                ),
            } as PlaygroundSWRConfig<Data>) as PlaygroundResponse<Data, Selected>

            const addVariant = useCallback(
                ({
                    baseVariantName,
                    newVariantName,
                    note,
                    callback,
                }: {
                    baseVariantName: string
                    newVariantName: string
                    note?: string
                    callback?: (variant: EnhancedVariant, state: PlaygroundStateData) => void
                }) => {
                    swr.mutate(
                        async (state) => {
                            const spec = getSpecLazy()
                            if (!state || !spec) return state

                            const allRevisions = atomStore.get(allRevisionsAtom) || []
                            const baseRevision =
                                (state.variants || []).find((rev) => {
                                    return rev._parentVariant?.variantName === baseVariantName
                                }) ||
                                allRevisions
                                    .filter(
                                        (rev) =>
                                            rev._parentVariant?.variantName === baseVariantName,
                                    )
                                    .sort((a, b) => Number(b.revision) - Number(a.revision))[0]

                            const baseVariant = baseRevision?._parentVariant

                            if (!baseVariant) {
                                message.error(
                                    "Template variant not found. Please choose a valid variant.",
                                )
                                return
                            }

                            const newTemplateVariantName = baseVariant.templateVariantName
                                ? baseVariant.templateVariantName
                                : newVariantName
                            const updateNewVariantName = `${newVariantName}`

                            const nameExists = state.availableRevisions?.some((rev) => {
                                return rev.variantName === updateNewVariantName
                            })
                            if (nameExists) {
                                message.error(
                                    "A variant with this name already exists. Please choose a different name.",
                                )
                                return
                            }

                            const parameters = transformToRequestBody({
                                variant: baseRevision,
                                allMetadata: getAllMetadata(),
                                spec,
                                routePath: state.uri?.routePath,
                            })

                            console.log("addVariant", parameters, baseRevision)

                            const newVariantBody: Partial<Variant> &
                                Pick<Variant, "variantName" | "configName" | "baseId"> = {
                                variantName: updateNewVariantName,
                                templateVariantName: newTemplateVariantName,
                                previousVariantName: baseVariant.variantName,
                                persistent: false,
                                parameters,
                                baseId: baseVariant.baseId,
                                baseName: baseVariant.baseName || newTemplateVariantName,
                                configName: newVariantName,
                            }

                            const {projectId} = getCurrentProject()
                            const createVariantResponse = await fetcher?.(
                                `/api/variants/from-base?project_id=${projectId}`,
                                {
                                    method: "POST",
                                    body: JSON.stringify({
                                        base_id: newVariantBody.baseId,
                                        new_variant_name: newVariantBody.variantName,
                                        new_config_name: newVariantBody.configName,
                                        parameters: newVariantBody.parameters,
                                        commit_message: note,
                                    }),
                                },
                            )

                            // Transform the response to get the new variant
                            const newVariant = transformVariant(
                                setVariant(createVariantResponse),
                                spec,
                            )

                            // Fetch and process revisions to ensure we have the latest data
                            message.loading("Updating playground with new variant...")
                            try {
                                const {
                                    revisions: _processedRevisions,
                                    spec: updatedSpec,
                                    uri,
                                } = await fetchAndProcessRevisions({
                                    appId: config.appId || "",
                                    projectId: projectId || "",
                                    forceRefresh: true, // Force refresh to get the new revision
                                    logger: console.log,
                                    // @ts-ignore
                                    initialVariants: [newVariant, baseVariant],
                                    keyParts: "playground",
                                })

                                const processedRevisions = _processedRevisions.filter((rev) => {
                                    return (
                                        rev.variantId === newVariant.id ||
                                        rev.variantId === baseVariant.variantId
                                    )
                                })

                                // Update URI and spec if needed
                                state.uri = uri
                                state.spec = updatedSpec

                                // Update the atom store with the new revisions
                                // We need to merge them with existing revisions in the atom
                                const existingRevisions = atomStore.get(allRevisionsAtom) || []

                                // Combine existing revisions with new ones, replacing any that have the same ID
                                const mergedRevisions = [
                                    ...existingRevisions.filter(
                                        (rev) =>
                                            !processedRevisions.some(
                                                (newRev) => newRev.id === rev.id,
                                            ),
                                    ),
                                    ...processedRevisions,
                                ]

                                // Update the atom store
                                atomStore.set(allRevisionsAtom, () => mergedRevisions)

                                // Update availableRevisions in the state
                                // First, convert the new revisions to lightweight format
                                const newLightweightRevisions = processedRevisions.map(
                                    (revision) => {
                                        const enhancedRevision = revision as EnhancedVariant & {
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
                                            name: revision.name || revision.variantName,
                                            revisionNumber: revision.revision,
                                            variantId: enhancedRevision.variantId,
                                            variantName: revision.variantName,
                                            createdAt: revision.createdAt,
                                            isLatestRevision: enhancedRevision.isLatestRevision,
                                            isLatestVariantRevision:
                                                enhancedRevision.isLatestVariantRevision,
                                            userProfile: enhancedRevision.userProfile,
                                            deployedIn: enhancedRevision.deployedIn || [],
                                            commitMessage: enhancedRevision.commitMessage,
                                            createdAtTimestamp: enhancedRevision.createdAtTimestamp,
                                        } as LightweightRevision
                                    },
                                )

                                // Merge with existing lightweight revisions
                                state.availableRevisions = [
                                    ...(state.availableRevisions || []).filter(
                                        (rev) =>
                                            !newLightweightRevisions.some(
                                                (newRev) => newRev.id === rev.id,
                                            ),
                                    ),
                                    ...newLightweightRevisions,
                                ]

                                // Sort revisions by createdAtTimestamp from newest to oldest
                                state.availableRevisions.sort(
                                    (a, b) => b.createdAtTimestamp - a.createdAtTimestamp,
                                )

                                // Store spec in atom
                                atomStore.set(specAtom, () => updatedSpec)

                                // Find the newly created variant in the processed revisions
                                // We need to find the latest revision for this variant
                                const variantRevisions = processedRevisions
                                    .filter((rev) => rev.variantId === newVariant.id)
                                    .sort((a, b) => b.createdAtTimestamp - a.createdAtTimestamp)

                                const newRevision =
                                    variantRevisions.length > 0 ? variantRevisions[0] : null

                                if (newRevision) {
                                    // Create a new variants array to avoid direct mutation
                                    const newVariants = [...state.variants]

                                    // Add the new variant to the variants array if it's not already there
                                    const existingIndex = newVariants.findIndex(
                                        (v) => v.id === newRevision.id,
                                    )
                                    if (existingIndex === -1) {
                                        newVariants.push(newRevision)
                                    } else {
                                        newVariants[existingIndex] = newRevision
                                    }

                                    state.variants = newVariants

                                    // Update the dataRef to track the new variant
                                    state.dataRef = structuredClone(state.dataRef || {})
                                    state.dataRef[newRevision.id] = hashVariant(newRevision)

                                    // Log the successful creation
                                    logger("New variant mounted successfully:", newRevision)

                                    // Allow the caller to perform additional operations on the state
                                    callback?.(newRevision, state)

                                    message.success("New variant created successfully")
                                    return state
                                } else {
                                    // If we couldn't find the new revision, try to fetch it directly
                                    console.warn(
                                        "Could not find new variant in processed revisions, trying direct fetch",
                                    )

                                    try {
                                        // Fetch the variant directly to get its latest revision
                                        const variantData = await fetcher?.(
                                            `/api/variants/${newVariant.variantId}?project_id=${projectId}`,
                                            {method: "GET"},
                                        )

                                        if (variantData) {
                                            // Transform the variant data
                                            const transformedVariant = transformVariant(
                                                setVariant(variantData),
                                                spec,
                                            )

                                            // Create a new variants array to avoid direct mutation
                                            const newVariants = [...state.variants]

                                            // Add the transformed variant to the variants array
                                            newVariants.push(transformedVariant)
                                            state.variants = newVariants

                                            // Update the dataRef to track the new variant
                                            state.dataRef = structuredClone(state.dataRef || {})
                                            state.dataRef[transformedVariant.id] =
                                                hashVariant(transformedVariant)

                                            // Log the successful creation
                                            logger(
                                                "New variant created successfully (direct fetch):",
                                                transformedVariant,
                                            )

                                            // Allow the caller to perform additional operations on the state
                                            callback?.(transformedVariant, state)

                                            message.success("New variant created successfully")
                                            return state
                                        } else {
                                            throw new Error("Failed to fetch variant data")
                                        }
                                    } catch (error) {
                                        console.error("Error fetching variant data:", error)

                                        // Fall back to using the original variant as a last resort
                                        console.warn("Falling back to original variant data")

                                        // Create a new variants array to avoid direct mutation
                                        const newVariants = [...state.variants]

                                        // Add the new variant to the variants array
                                        newVariants.push(newVariant)
                                        state.variants = newVariants

                                        // Update the dataRef to track the new variant
                                        state.dataRef = structuredClone(state.dataRef || {})
                                        state.dataRef[newVariant.id] = hashVariant(newVariant)

                                        // Log the creation with a warning
                                        logger(
                                            "New variant created successfully (fallback):",
                                            newVariant,
                                        )

                                        // Allow the caller to perform additional operations on the state
                                        callback?.(newVariant, state)
                                    }

                                    message.success("New variant created successfully")
                                    return state
                                }
                            } catch (error) {
                                console.error("Error updating revision state:", error)
                                message.error("Error updating revision state")

                                // Fall back to the original approach if there's an error
                                // Create a new variants array to avoid direct mutation
                                const newVariants = [...state.variants]

                                // Add the new variant to the variants array
                                newVariants.push(newVariant)
                                state.variants = newVariants

                                // Update the dataRef to track the new variant
                                state.dataRef = structuredClone(state.dataRef || {})
                                state.dataRef[newVariant.id] = hashVariant(newVariant)

                                // Log the successful creation with error note
                                logger(
                                    "New variant created successfully (with revision error):",
                                    newVariant,
                                )

                                // Allow the caller to perform additional operations on the state
                                callback?.(newVariant, state)
                                refetchVariants()
                                return state
                            }
                        },
                        {revalidate: false},
                    )
                },
                [fetcher, swr, config],
            )

            const getVariants = useCallback(() => {
                addToValueReferences("variants")
                return swr.data?.variants
            }, [swr, addToValueReferences])

            const getVariantIds = useCallback(() => {
                addToValueReferences("variantIds")
                return getVariants()?.map((v) => v.id)
            }, [addToValueReferences, getVariants])

            const getAddVariant = useCallback(() => {
                addToValueReferences("addVariant")
                return addVariant
            }, [addToValueReferences, addVariant])

            const {postMessageToWorker, createWorkerMessage} = useWebWorker(
                swr.handleWebWorkerMessage!,
                false,
            )

            const handleInputRowTestStart = useCallback(
                (
                    inputRow: PlaygroundStateData["generationData"]["inputs"]["value"][number],
                    variantId: string,
                    runId: string,
                ) => {
                    if (!inputRow?.__runs) {
                        inputRow.__runs = {}
                    }

                    if (!inputRow.__runs[variantId]) {
                        inputRow.__runs[variantId] = {
                            __isRunning: runId,
                            __result: undefined,
                        }
                    } else {
                        inputRow.__runs[variantId].__isRunning = runId
                        inputRow.__runs[variantId].__result = ""
                    }

                    return inputRow
                },
                [],
            )

            Object.defineProperty(swr, "rerunChatOutput", {
                get: () => {
                    addToValueReferences("rerunChatOutput")

                    const rerunChatOutput = (messageId: string, variantId?: string) => {
                        swr.mutate(
                            async (clonedState) => {
                                const jwt = await getJWT()
                                if (!clonedState) return clonedState

                                const outputHistoryItem = findItemInHistoryValueById(
                                    clonedState.generationData.messages.value,
                                    messageId,
                                )

                                const messageRowHistory = findParentOfPropertyInObject(
                                    clonedState,
                                    outputHistoryItem.__id,
                                )

                                const variableRows = clonedState.generationData.inputs.value

                                const messageRow = clonedState.generationData.messages.value.find(
                                    (m) => {
                                        return m.history.__id === messageRowHistory.__id
                                    },
                                )

                                if (variantId) {
                                    const variant = variantId
                                        ? clonedState.variants.find((v) => v.id === variantId)
                                        : undefined

                                    const chatHistory = constructChatHistory({
                                        messageRow,
                                        messageId,
                                        variantId,
                                    })

                                    const runId = generateId()

                                    handleInputRowTestStart(outputHistoryItem, variantId, runId)

                                    postMessageToWorker(
                                        createWorkerMessage("runVariantInputRow", {
                                            variant: variant,
                                            messageRow,
                                            chatHistory,
                                            messageId: outputHistoryItem.__id,
                                            inputRow: variableRows[0],
                                            rowId: messageRow?.__id,
                                            appId: config.appId!,
                                            uri: clonedState.uri,
                                            projectId: getCurrentProject().projectId,
                                            allMetadata: getAllMetadata(),
                                            headers: {
                                                ...(jwt
                                                    ? {
                                                          Authorization: `Bearer ${jwt}`,
                                                      }
                                                    : {}),
                                            },
                                            spec: getSpecLazy(),
                                        }),
                                    )
                                } else {
                                    for (const variantId of clonedState.selected) {
                                        // Find the variant object that matches this ID
                                        const variant = variantId
                                            ? clonedState.variants.find((v) => v.id === variantId)
                                            : undefined

                                        const chatHistory = constructChatHistory({
                                            messageRow,
                                            messageId,
                                            variantId,
                                            includeLastMessage: true,
                                        })

                                        const runId = generateId()

                                        // Mark this input row as being tested for this variant
                                        handleInputRowTestStart(outputHistoryItem, variantId, runId)

                                        postMessageToWorker(
                                            createWorkerMessage("runVariantInputRow", {
                                                // Use the variant we already found instead of searching again
                                                variant: variant,
                                                messageRow,
                                                chatHistory,
                                                messageId: outputHistoryItem.__id,
                                                inputRow: variableRows[0],
                                                rowId: messageRow?.__id,
                                                appId: config.appId!,
                                                uri: clonedState.uri,
                                                projectId: getCurrentProject().projectId,
                                                allMetadata: getAllMetadata(),
                                                headers: {
                                                    ...(jwt
                                                        ? {
                                                              Authorization: `Bearer ${jwt}`,
                                                          }
                                                        : {}),
                                                },
                                                spec: getSpecLazy(),
                                            }),
                                        )
                                    }
                                }

                                return clonedState
                            },
                            {
                                revalidate: false,
                            },
                        )
                    }

                    return rerunChatOutput
                },
            })

            Object.defineProperty(swr, "runTests", {
                get: () => {
                    addToValueReferences("runTests")
                    const runChatTests = (
                        clonedState: PlaygroundStateData,
                        jwt: string | undefined,
                        visibleVariants: string[],
                    ) => {
                        const variableRows = clonedState.generationData.inputs.value
                        const messageRows = clonedState.generationData.messages.value

                        for (const variableRow of variableRows) {
                            for (const messageRow of messageRows) {
                                const messagesInRow = messageRow.history.value

                                const lastMessage = messagesInRow[messagesInRow.length - 1]
                                for (const variantId of visibleVariants) {
                                    const variant = clonedState.variants.find(
                                        (v) => v.id === variantId,
                                    )

                                    if (!variant) continue

                                    const runId = generateId()

                                    handleInputRowTestStart(lastMessage, variantId, runId)

                                    postMessageToWorker(
                                        createWorkerMessage("runVariantInputRow", {
                                            variant,
                                            runId,
                                            messageRow,
                                            messageId: lastMessage.__id,
                                            inputRow: variableRow,
                                            rowId: messageRow.__id,
                                            appId: config.appId!,
                                            uri: clonedState.uri,
                                            projectId: getCurrentProject().projectId,
                                            allMetadata: getAllMetadata(),
                                            headers: {
                                                ...(jwt
                                                    ? {
                                                          Authorization: `Bearer ${jwt}`,
                                                      }
                                                    : {}),
                                            },
                                            spec: getSpecLazy(),
                                        }),
                                    )
                                }
                            }
                        }
                    }
                    const generateGenerationTestParams = (
                        clonedState: PlaygroundStateData,
                        rowId?: string,
                        jwt?: string | undefined,
                        visibleVariants: string[] = [],
                    ) => {
                        const testRows = rowId
                            ? [
                                  clonedState.generationData.inputs.value.find(
                                      (r) => r.__id === rowId,
                                  ),
                              ]
                            : clonedState.generationData.inputs.value

                        for (const testRow of testRows) {
                            for (const variantId of visibleVariants) {
                                const variant = clonedState.variants.find((v) => v.id === variantId)
                                if (!variant || !testRow) continue

                                const runId = generateId()

                                handleInputRowTestStart(testRow, variantId, runId)

                                postMessageToWorker(
                                    createWorkerMessage("runVariantInputRow", {
                                        variant,
                                        runId,
                                        inputRow: testRow,
                                        rowId: testRow.__id,
                                        appId: config.appId!,
                                        uri: clonedState.uri,
                                        projectId: getCurrentProject().projectId,
                                        allMetadata: getAllMetadata(),
                                        headers: {
                                            ...(jwt
                                                ? {
                                                      Authorization: `Bearer ${jwt}`,
                                                  }
                                                : {}),
                                        },
                                        spec: getSpecLazy(),
                                    }),
                                )
                            }
                        }
                    }

                    const runTests = (rowId?: string, variantId?: string) => {
                        swr.mutate(
                            async (clonedState) => {
                                const jwt = await getJWT()
                                if (!clonedState) return clonedState
                                const visibleVariants = variantId
                                    ? [variantId]
                                    : clonedState.selected

                                const isChat = clonedState.variants.some((v) => v.isChat)

                                if (isChat) {
                                    runChatTests(clonedState, jwt, visibleVariants)
                                } else {
                                    generateGenerationTestParams(
                                        clonedState,
                                        rowId,
                                        jwt,
                                        visibleVariants,
                                    )
                                }

                                return clonedState
                            },
                            {
                                revalidate: false,
                            },
                        )
                    }

                    return runTests
                },
            })

            Object.defineProperty(swr, "cancelRunTests", {
                get: () => {
                    const cancelTests = (rowId?: string, variantId?: string) => {
                        swr.mutate(
                            (clonedState) => {
                                if (!clonedState) return clonedState

                                const isChat = clonedState.variants.some((v) => v.isChat)

                                const visibleVariants = variantId
                                    ? [variantId]
                                    : clonedState.selected

                                if (isChat) {
                                    const messageRows = clonedState.generationData.messages.value

                                    for (const messageRow of messageRows) {
                                        const messagesInRow = messageRow.history.value

                                        const lastMessage = messagesInRow[messagesInRow.length - 1]
                                        for (const variantId of visibleVariants) {
                                            const variant = clonedState.variants.find(
                                                (v) => v.id === variantId,
                                            )

                                            if (!variant) continue

                                            if (lastMessage?.__runs?.[variantId]) {
                                                lastMessage.__runs[variantId].__isRunning = ""
                                                lastMessage.__runs[variantId].__result = ""
                                            }
                                        }
                                    }
                                } else {
                                    const testRows = rowId
                                        ? [
                                              clonedState.generationData.inputs.value.find(
                                                  (r) => r.__id === rowId,
                                              ),
                                          ]
                                        : clonedState.generationData.inputs.value

                                    for (const testRow of testRows) {
                                        for (const variantId of visibleVariants) {
                                            const variant = clonedState.variants.find(
                                                (v) => v.id === variantId,
                                            )
                                            if (!variant || !testRow) continue

                                            if (testRow?.__runs?.[variantId]) {
                                                testRow.__runs[variantId].__isRunning = ""
                                                testRow.__runs[variantId].__result = ""
                                            }
                                        }
                                    }
                                }

                                return clonedState
                            },
                            {revalidate: false},
                        )
                    }

                    return cancelTests
                },
            })

            Object.defineProperty(swr, "variants", {
                get: getVariants,
            })
            Object.defineProperty(swr, "variantIds", {
                get: getVariantIds,
            })
            Object.defineProperty(swr, "addVariant", {
                get: getAddVariant,
            })

            return swr
        }
        return useImplementation({key, fetcher, config})
    }
}

export default playgroundVariantsMiddleware
