import {useCallback, useEffect} from "react"
import {useSWRConfig, type Key} from "swr"
import usePlaygroundState from "../usePlaygroundState"
import type {UsePlaygroundVariantsReturn, UsePlaygroundVariantsOptions} from "./types"
import type {StateMiddleware, InitialStateType, StateVariant} from "../../state/types"
import type {UsePlaygroundStateOptions} from "../usePlaygroundState/types"
import {
    createVariantCompare,
    fetchAndUpdateVariant,
    setVariant,
} from "../usePlaygroundState/assets/helpers"
import {message} from "antd"
import {Variant} from "@/lib/Types"
import {getCurrentProject} from "@/contexts/project.context"
import cloneDeep from "lodash/cloneDeep"

const usePlaygroundVariants = (
    options?: UsePlaygroundVariantsOptions,
): UsePlaygroundVariantsReturn => {
    const {fetcher} = useSWRConfig()
    const swr = usePlaygroundState({
        use: [
            // ((swrNext: StateMiddleware) =>
            //     (
            //         key: Key,
            //         fetcher: null | (() => Promise<InitialStateType>),
            //         config: {cache: Map<string, any>; options: any; test: any},
            //     ) => {
            //         console.log("do we have options?", config.options, config.test)
            //         const cache = config.cache
            //         if (!key) return null
            //         if (!cache.has(String(key))) {
            //             return swrNext(key, fetcher, config)
            //         } else {
            //             return swrNext(key, null, config)
            //         }
            //     }) as StateMiddleware,
            ...(options?.use || []),
        ],
        neverFetch: options?.neverFetch,
        compare: useCallback<NonNullable<UsePlaygroundStateOptions["compare"]>>(
            (a, b) => createVariantCompare(options?.compare)(a, b),
            [options?.compare],
        ),
        ...options,
        hookId: options?.hookId || "variants-wrapper",
    })
    const {variants, mutate, service, projectId} = swr

    const addVariant = useCallback(
        ({baseVariantName, newVariantName}: {baseVariantName: string; newVariantName: string}) => {
            mutate(
                async (state) => {
                    if (!state) return state

                    const baseVariant = state.variants.find(
                        (variant) => variant.variantName === baseVariantName,
                    )

                    if (!baseVariant) {
                        message.error("Template variant not found. Please choose a valid variant.")
                        return
                    }

                    const newTemplateVariantName = baseVariant.templateVariantName
                        ? baseVariant.templateVariantName
                        : newVariantName
                    const updateNewVariantName = `${baseVariant.baseName}.${newVariantName}`

                    // Check if variant with the same name already exists
                    const existingVariant = state.variants.find(
                        (variant) => variant.variantName === updateNewVariantName,
                    )
                    // Check if the variant exists
                    if (existingVariant) {
                        message.error(
                            "A variant with this name already exists. Please choose a different name.",
                        )
                        return
                    }

                    const existingParameters =
                        baseVariant.schema?.promptConfig?.[0].llm_config.value

                    const newVariantBody: Partial<Variant> &
                        Pick<Variant, "variantName" | "configName" | "baseId"> = {
                        variantName: updateNewVariantName,
                        templateVariantName: newTemplateVariantName,
                        previousVariantName: baseVariant.variantName,
                        persistent: false,
                        parameters: existingParameters,
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
                                parameters: {},
                            }),
                        },
                    )

                    const newVariant = setVariant(createVariantResponse)
                    const variantWithConfig = await fetchAndUpdateVariant(newVariant, service)

                    const clone = cloneDeep(state)
                    clone.variants.push(variantWithConfig)

                    return clone
                },
                {
                    revalidate: false,
                },
            )
        },
        [fetcher, mutate, service],
    )

    return Object.assign({}, swr, {variants: variants || [], addVariant, mutate, projectId})
    // {variants: variants || [], addVariant, mutate, projectId}
}

export type {UsePlaygroundVariantsOptions, UsePlaygroundVariantsReturn}
export default usePlaygroundVariants
