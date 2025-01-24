import {useCallback} from "react"

import {getCurrentProject} from "@/contexts/project.context"
import {getJWT} from "@/services/api"

import {transformToRequestBody} from "../../../assets/utilities/transformer/reverseTransformer"
import {createVariantsCompare, transformVariant, setVariant} from "../assets/helpers"
import {message} from "../../../state/messageContext"

import usePlaygroundUtilities from "./hooks/usePlaygroundUtilities"
import {getAllMetadata, getMetadataLazy, getSpecLazy} from "@/components/NewPlayground/state"
import useWebWorker from "../../useWebWorker"

import type {Key, SWRHook} from "swr"
import type {FetcherOptions} from "@/lib/api/types"
import type {Variant} from "@/lib/Types"
import type {
    PlaygroundStateData,
    PlaygroundMiddleware,
    PlaygroundSWRConfig,
    PlaygroundMiddlewareParams,
} from "../types"
import type {EnhancedVariant} from "../../../assets/utilities/transformer/types"
import {createMessageFromSchema, createMessageRow} from "../assets/messageHelpers"
import {ConfigMetadata} from "@/components/NewPlayground/assets/utilities/genericTransformer/types"

const playgroundVariantsMiddleware: PlaygroundMiddleware = (useSWRNext: SWRHook) => {
    return <Data extends PlaygroundStateData = PlaygroundStateData>(
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
            } as PlaygroundSWRConfig<Data>)

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
                // @ts-ignore
                swr.handleWebWorkerMessage,
                valueReferences.current.includes("runVariantTestRow") ||
                    valueReferences.current.includes("runTests"),
            )

            Object.defineProperty(swr, "runTests", {
                get: () => {
                    addToValueReferences("runTests")
                    const handleInputRowTestStart = (inputRow, variantId) => {
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
                    }

                    const runChatTests = (
                        clonedState: PlaygroundStateData,
                        rowId: string,
                        jwt,
                        visibleVariants: string[],
                    ) => {
                        const variableRows = clonedState.generationData.inputs.value
                        const messageRows = clonedState.generationData.messages.value

                        for (const variableRow of variableRows) {
                            // handleInputRowTestStart(variableRow, variantId)

                            for (const messageRow of messageRows) {
                                const messagesInRow = messageRow.history.value
                                // console.log("messagesInRow", messagesInRow)

                                let lastMessage = messagesInRow[messagesInRow.length - 1]
                                const checkValidity = (
                                    obj: Record<string, unknown>,
                                    metadata: ConfigMetadata,
                                ) => {
                                    if (obj.__runs) return true
                                    if (!metadata?.properties) return true

                                    for (const [propName, propMetadata] of Object.entries(
                                        metadata.properties,
                                    )) {
                                        // const snakeCasePropName = toSnakeCase(propName)
                                        // If property is required (not nullable) and value is missing or undefined
                                        if (
                                            propMetadata.nullable === false &&
                                            (!(propName in obj) || !obj[propName]?.value)
                                        ) {
                                            return false
                                        }
                                    }
                                    return true
                                }
                                if (
                                    !!lastMessage &&
                                    !checkValidity(
                                        lastMessage,
                                        getMetadataLazy(lastMessage.__metadata),
                                    )
                                ) {
                                    console.log("removing INVALID last message")
                                    messageRow.history.value = [
                                        ...messageRow.history.value.filter(
                                            (m) => m.__id !== lastMessage.__id,
                                        ),
                                    ]
                                    lastMessage =
                                        messageRow.history.value[
                                            messageRow.history.value.length - 1
                                        ]
                                }
                                const emptyMessage = createMessageFromSchema(
                                    getMetadataLazy(
                                        clonedState.variants[0].prompts[0].messages.__metadata,
                                    ).itemMetadata,
                                )
                                messageRow.history.value.push(emptyMessage)

                                for (const variantId of visibleVariants) {
                                    const variant = clonedState.variants.find(
                                        (v) => v.id === variantId,
                                    )

                                    if (!variant) continue

                                    handleInputRowTestStart(emptyMessage, variantId)

                                    postMessageToWorker(
                                        createWorkerMessage("runVariantInputRow", {
                                            variant,
                                            messageRow,
                                            messageId: emptyMessage.__id,
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
                                        }),
                                    )
                                }
                            }
                            // const messageMetadata = getMetadataLazy(latestMessageRow.__metadata)
                            // for (const messageRow of messageRows) {
                            //     if (!messageMetadata) {
                            //         messageMetadata = getMetadataLazy(messageRow.__metadata)
                            //         break
                            //     }
                            // }

                            /**
                             * TODO: NEED TO GENERATE A NEW MESSAGE ROW HERE FOR
                             * INCOMING CHAT RESPONSE, AND USE ITS ID FOR rowId
                             */
                            // const newMessage = createMessageFromSchema(messageMetadata)
                            // console.log("created message from schema", newMessage)
                            // const newRow = createMessageRow(newMessage, messageMetadata)
                        }
                    }
                    const generateGenerationTestParams = (
                        clonedState: PlaygroundStateData,
                        rowId: string,
                        jwt,
                        visibleVariants: string[],
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
                                    runChatTests(clonedState, rowId, jwt, visibleVariants)
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
