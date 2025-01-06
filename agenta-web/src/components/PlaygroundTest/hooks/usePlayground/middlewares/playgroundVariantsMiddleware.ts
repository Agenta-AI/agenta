import {useCallback} from "react"

import {message} from "antd"
import cloneDeep from "lodash/cloneDeep"
import {getCurrentProject} from "@/contexts/project.context"

import {transformToRequestBody} from "../../../assets/utilities/transformer/reverseTransformer"
import {createVariantsCompare, transformVariant, setVariant} from "../assets/helpers"

import usePlaygroundUtilities from "./hooks/usePlaygroundUtilities"

import type {Key, SWRHook} from "swr"
import type {FetcherOptions} from "@/lib/api/types"
import type {Variant} from "@/lib/Types"
import type {
    PlaygroundStateData,
    PlaygroundMiddleware,
    PlaygroundSWRConfig,
    PlaygroundMiddlewareParams,
} from "../types"

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
                }: {
                    baseVariantName: string
                    newVariantName: string
                }) => {
                    swr.mutate(
                        async (state) => {
                            if (!state || !state.spec) return state
                            const service = config.service
                            if (!service) return state

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

                            const parameters = transformToRequestBody(baseVariant)

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
                                state.spec,
                            )

                            const clone = cloneDeep(state)
                            clone.variants.push(variantWithConfig)

                            return clone
                        },
                        {revalidate: false},
                    )
                },
                [config.service, fetcher, swr],
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
