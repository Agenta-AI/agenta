import {useState, useEffect, useRef, useCallback} from "react"
import {Variant, Parameter} from "@/lib/Types"
import {getAllVariantParameters, updateInputParams} from "@/lib/helpers/variantHelper"
import {PERMISSION_ERR_MSG} from "../api/assets/axiosConfig"
import {createNewVariant, fetchVariantLogs, updateVariantParams} from "@/services/playground/api"
import {fetchVariants} from "@/services/api"

/**
 * Hook for using the variant.
 * @param appId
 * @param variantName
 * @param sourceVariantName The original variant name, this is important for determining the URI path
 * @returns
 */
export function useLegacyVariant(options: {appId: string}, variant: Variant) {
    const {appId} = options
    const [historyStatus, setHistoryStatus] = useState({loading: false, error: false})
    const [promptOptParams, setPromptOptParams] = useState<Parameter[] | null>(null)
    const [inputParams, setInputParams] = useState<Parameter[] | null>(null)
    const [URIPath, setURIPath] = useState<string | null>(null)
    const [isLoading, setIsLoading] = useState(true)
    const [isError, setIsError] = useState(false)
    const [error, setError] = useState<Error | null>(null)
    const [isParamSaveLoading, setIsParamSaveLoading] = useState(false)
    const [isChatVariant, setIsChatVariant] = useState<boolean | null>(null)
    const [isLogsLoading, setIsLogsLoading] = useState(false)
    const [variantErrorLogs, setVariantErrorLogs] = useState("")
    const onClickShowLogs = useRef(false)

    const getVariantLogs = async () => {
        try {
            setIsLogsLoading(true)
            const logs = await fetchVariantLogs(variant.variantId)
            setVariantErrorLogs(logs)
        } catch (error) {
            console.error(error)
        } finally {
            setIsLogsLoading(false)
        }
    }

    const fetchParameters = async () => {
        setIsLoading(true)
        setIsError(false)
        setHistoryStatus({loading: true, error: false})
        try {
            const {parameters, inputs, URIPath, isChatVariant} = await getAllVariantParameters(
                appId,
                variant,
            )
            setPromptOptParams(parameters)
            setInputParams(inputs)
            setURIPath(URIPath)
            setIsChatVariant(isChatVariant)
            setHistoryStatus({loading: false, error: false})
        } catch (error: any) {
            if (error.message !== PERMISSION_ERR_MSG) {
                console.error(error)
                setIsError(true)
                setError(error)
                setHistoryStatus({loading: false, error: true})
            }
        } finally {
            setIsLoading(false)
        }
    }

    useEffect(() => {
        if (variant?.variantName && appId) fetchParameters()
    }, [variant?.variantName])

    useEffect(() => {
        const updatedInputParams = updateInputParams(promptOptParams, inputParams || [])
        setInputParams(updatedInputParams)
    }, [promptOptParams])

    /**
     * Saves new values for the optional parameters of the variant.
     * @param updatedOptParams
     * @param persist
     */
    const saveOptParams = async (
        updatedOptParams: Parameter[],
        persist: boolean,
        updateVariant: boolean,
        onSuccess?: (isNew: boolean) => void,
    ) => {
        setIsParamSaveLoading(true)
        setIsError(false)
        try {
            if (persist) {
                if (!updateVariant) {
                    await createNewVariant(
                        variant.baseId,
                        variant.variantName,
                        variant.configName,
                        updatedOptParams,
                    )
                } else if (updateVariant) {
                    await updateVariantParams(variant.variantId, updatedOptParams)
                }
                if (onSuccess) onSuccess(!updateVariant)
                variant.parameters = updatedOptParams.reduce((acc, param) => {
                    return {...acc, [param.name]: param.default}
                }, {})
            }
            setPromptOptParams(updatedOptParams)
        } catch (error: any) {
            if (error.message !== PERMISSION_ERR_MSG) {
                setIsError(true)
            }
        } finally {
            setIsParamSaveLoading(false)
        }
    }

    return {
        inputParams,
        promptOptParams,
        URIPath,
        isLoading,
        isError,
        error,
        isParamSaveLoading,
        saveOptParams,
        refetch: fetchParameters,
        isChatVariant,
        historyStatus,
        setPromptOptParams,
        setHistoryStatus,
        getVariantLogs,
        isLogsLoading,
        variantErrorLogs,
        setIsLogsLoading,
        onClickShowLogs,
    }
}

// array version of useLegacyVariant
export function useLegacyVariants(options: {appId: string}, propsVariants: Variant[] = []) {
    const appId = options.appId
    const [isVariantsLoading, setIsVariantsLoading] = useState<boolean>(false)
    const [state, setState] = useState<ReturnType<typeof useLegacyVariant>[]>([])
    const [isVariantsError, setIsVariantsError] = useState<boolean | string>(false)

    const fetchDetails = useCallback(
        async (variants: Variant[]) => {
            const res = await Promise.all(
                variants.map(async (variant) => {
                    try {
                        const data = await getAllVariantParameters(appId, variant)
                        return {
                            data: {
                                ...data,
                                variant,
                            },
                            error: null,
                        }
                    } catch (error) {
                        return {data: null, error}
                    }
                }),
            )

            const newState = res.map(({data, error}) => {
                const {variant, parameters, inputs, URIPath, isChatVariant} = data || {}
                return {
                    variant: variant,
                    promptOptParams: parameters,
                    inputParams: inputs,
                    URIPath,
                    isLoading: false,
                    isError: !!error,
                    error,
                    isParamSaveLoading: false,
                    isChatVariant,
                }
            })
            return newState
        },
        [appId],
    )

    useEffect(() => {
        if (isVariantsLoading) return
        if (state.length) return

        const fetchData = async () => {
            setIsVariantsLoading(true)
            try {
                const variants = propsVariants.length ? propsVariants : await fetchVariants(appId)
                if (variants.length > 0) {
                    const newState = await fetchDetails(variants)
                    setState(newState)
                }
            } catch (error) {
                setIsVariantsError(error)
            } finally {
                setIsVariantsLoading(false)
            }
        }
        fetchData()
    }, [appId, fetchDetails, isVariantsLoading, state.length, propsVariants])

    const getSaveOptParams =
        (ix: number) =>
        async (updatedOptParams: Parameter[], persist: boolean, updateVariant: boolean) => {
            setState((prevState) => {
                return prevState.map((prev, i) => {
                    if (i === ix) {
                        return {
                            ...prev,
                            isParamSaveLoading: true,
                            isError: false,
                        }
                    }
                    return prev
                })
            })
            const variant = variants[ix]
            try {
                if (persist) {
                    if (!updateVariant) {
                        await createNewVariant(
                            variant.baseId,
                            variant.variantName,
                            variant.configName,
                            updatedOptParams,
                        )
                    } else if (updateVariant) {
                        await updateVariantParams(variant.variantId, updatedOptParams)
                    }
                    variant.parameters = updatedOptParams.reduce((acc, param) => {
                        return {...acc, [param.name]: param.default}
                    }, {})
                }

                setState((prevState) => {
                    return prevState.map((prev, i) => {
                        if (i === ix) {
                            return {
                                ...prev,
                                promptOptParams: updatedOptParams,
                            }
                        }
                        return prev
                    })
                })
            } catch (error) {
                setState((prevState) => {
                    return prevState.map((prev, i) => {
                        if (i === ix) {
                            return {
                                ...prev,
                                isError: true,
                            }
                        }
                        return prev
                    })
                })
            } finally {
                setState((prevState) => {
                    return prevState.map((prev, i) => {
                        if (i === ix) {
                            return {
                                ...prev,
                                isParamSaveLoading: false,
                            }
                        }
                        return prev
                    })
                })
            }
        }

    return {
        getSaveOptParams,
        error: isVariantsError,
        isLoading: isVariantsLoading,
        data: {
            variants: state,
        },
    }
}
