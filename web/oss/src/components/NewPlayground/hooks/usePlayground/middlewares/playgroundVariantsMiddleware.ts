import {useCallback} from "react"

import type {Key} from "swr"
import type {SWRHook} from "swr"

import {getSpecLazy, getAllMetadata} from "@/oss/components/NewPlayground/state"
import {getCurrentProject} from "@/oss/contexts/project.context"
import type {FetcherOptions} from "@/oss/lib/api/types"
import type {Variant} from "@/oss/lib/Types"
import {getJWT} from "@/oss/services/api"

import {transformToRequestBody} from "../../../assets/utilities/transformer/reverseTransformer"
import type {EnhancedVariant} from "../../../assets/utilities/transformer/types"
import {message} from "../../../state/messageContext"
import useWebWorker from "../../useWebWorker"
import {
    createVariantsCompare,
    transformVariant,
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
                    callback,
                }: {
                    baseVariantName: string
                    newVariantName: string
                    callback?: (variant: EnhancedVariant, state: PlaygroundStateData) => void
                }) => {
                    swr.mutate(
                        async (state) => {
                            const spec = getSpecLazy()
                            if (!state || !spec) return state

                            const baseVariant = state.variants.find(
                                (variant) => variant.variantName === baseVariantName,
                            )

                            if (!baseVariant) {
                                message.error(
                                    "Template variant not found. Please choose a valid variant.",
                                )
                                return
                            }

                            const newTemplateVariantName = baseVariant.templateVariantName
                                ? baseVariant.templateVariantName
                                : newVariantName
                            const updateNewVariantName = `${baseVariant.baseName}.${newVariantName}`

                            const existingVariant = state.variants.find(
                                (variant) => variant.variantName === updateNewVariantName,
                            )
                            if (existingVariant) {
                                message.error(
                                    "A variant with this name already exists. Please choose a different name.",
                                )
                                return
                            }

                            const parameters = transformToRequestBody({
                                variant: baseVariant,
                                allMetadata: getAllMetadata(),
                                spec,
                            })

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
                                    }),
                                },
                            )

                            const variantWithConfig = transformVariant(
                                setVariant(createVariantResponse),
                                spec,
                            )

                            state.variants.push(variantWithConfig)

                            callback?.(variantWithConfig, state)
                            return state
                        },
                        {revalidate: false},
                    )
                },
                [fetcher, swr],
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
                ) => {
                    if (!inputRow?.__runs) {
                        inputRow.__runs = {}
                    }

                    if (!inputRow.__runs[variantId]) {
                        inputRow.__runs[variantId] = {
                            __isRunning: true,
                            __result: undefined,
                        }
                    } else {
                        inputRow.__runs[variantId].__isRunning = true
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

                                    handleInputRowTestStart(outputHistoryItem, variantId)

                                    postMessageToWorker(
                                        createWorkerMessage("runVariantInputRow", {
                                            variant: variant,
                                            messageRow,
                                            chatHistory,
                                            messageId: outputHistoryItem.__id,
                                            inputRow: variableRows[0],
                                            rowId: messageRow?.__id,
                                            appId: config.appId!,
                                            uri: variant?.uri,
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
                                        const variant = variantId
                                            ? clonedState.variants.find((v) => v.id === variantId)
                                            : undefined

                                        const chatHistory = constructChatHistory({
                                            messageRow,
                                            messageId,
                                            variantId,
                                            includeLastMessage: true,
                                        })

                                        handleInputRowTestStart(outputHistoryItem, variantId)

                                        postMessageToWorker(
                                            createWorkerMessage("runVariantInputRow", {
                                                variant: clonedState.variants.find(
                                                    (v) => v.id === variantId,
                                                ),
                                                messageRow,
                                                chatHistory,
                                                messageId: outputHistoryItem.__id,
                                                inputRow: variableRows[0],
                                                rowId: messageRow?.__id,
                                                appId: config.appId!,
                                                uri: variant?.uri,
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

                                    handleInputRowTestStart(lastMessage, variantId)

                                    postMessageToWorker(
                                        createWorkerMessage("runVariantInputRow", {
                                            variant,
                                            messageRow,
                                            messageId: lastMessage.__id,
                                            inputRow: variableRow,
                                            rowId: messageRow.__id,
                                            appId: config.appId!,
                                            uri: variant.uri,
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

                                handleInputRowTestStart(testRow, variantId)

                                postMessageToWorker(
                                    createWorkerMessage("runVariantInputRow", {
                                        variant,
                                        inputRow: testRow,
                                        rowId: testRow.__id,
                                        appId: config.appId!,
                                        uri: variant.uri,
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
