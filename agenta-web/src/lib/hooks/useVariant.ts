import {useState, useEffect} from "react"
import {promptVersioning, saveNewVariant, updateVariantParams} from "@/lib/services/api"
import {Variant, Parameter, IPromptVersioning} from "@/lib/Types"
import {getAllVariantParameters, updateInputParams} from "@/lib/helpers/variantHelper"
import {isDemo} from "../helpers/utils"
import {PERMISSION_ERR_MSG} from "../helpers/axiosConfig"

/**
 * Hook for using the variant.
 * @param appId
 * @param variantName
 * @param sourceVariantName The original variant name, this is important for determining the URI path
 * @returns
 */
export function useVariant(appId: string, variant: Variant) {
    const [promptRevisions, setPromptRevisions] = useState<IPromptVersioning>()
    const [historyStatus, setHistoryStatus] = useState({loading: false, error: false})
    const [promptOptParams, setPromptOptParams] = useState<Parameter[] | null>(null)
    const [inputParams, setInputParams] = useState<Parameter[] | null>(null)
    const [URIPath, setURIPath] = useState<string | null>(null)
    const [isLoading, setIsLoading] = useState(true)
    const [isError, setIsError] = useState(false)
    const [error, setError] = useState<Error | null>(null)
    const [isParamSaveLoading, setIsParamSaveLoading] = useState(false)
    const [isChatVariant, setIsChatVariant] = useState<boolean | null>(null)

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
            if (variant.variantId && isDemo()) {
                const revisions = await promptVersioning(variant.variantId)
                setPromptRevisions(revisions)
            }
            setInputParams(inputs)
            setURIPath(URIPath)
            setIsChatVariant(isChatVariant)
            setHistoryStatus({loading: false, error: true})
        } catch (error: any) {
            if (error.message !== PERMISSION_ERR_MSG) {
                console.log(error)
                setIsError(true)
                setError(error)
                setHistoryStatus({loading: false, error: true})
            }
        } finally {
            setIsLoading(false)
            setHistoryStatus({loading: false, error: false})
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
                    await saveNewVariant(
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
        promptRevisions,
        historyStatus,
        setPromptOptParams,
        setPromptRevisions,
        setHistoryStatus,
    }
}

// array version of useVariant
export function useVariants(appId: string, variants: Variant[]) {
    const [optParams, setOptParams] = useState<(Parameter[] | null)[]>(variants.map(() => null))
    const [inputParams, setInputParams] = useState<(Parameter[] | null)[]>(variants.map(() => null))
    const [URIPath, setURIPath] = useState<(string | null)[]>(variants.map(() => null))
    const [isLoading, setIsLoading] = useState<boolean[]>(variants.map(() => true))
    const [isError, setIsError] = useState<boolean[]>(variants.map(() => false))
    const [error, setError] = useState<(Error | null)[]>(variants.map(() => null))
    const [isParamSaveLoading, setIsParamSaveLoading] = useState<boolean[]>(
        variants.map(() => false),
    )
    const [isChatVariant, setIsChatVariant] = useState<(boolean | null)[]>(variants.map(() => null))

    useEffect(() => {
        setIsLoading(variants.map(() => true))
        setIsError(variants.map(() => false))

        Promise.all(
            variants.map(async (variant) => {
                try {
                    const data = await getAllVariantParameters(appId, variant)
                    return {data, error: null}
                } catch (error) {
                    return {data: null, error}
                }
            }),
        ).then((res) => {
            const errorArr: typeof error = []
            const isErrorArr: typeof isError = []
            const optParamsArr: typeof optParams = []
            const inputParamsArr: typeof inputParams = []
            const uriPathArr: typeof URIPath = []
            const isChatVariantArr: typeof isChatVariant = []

            res.forEach(({data, error}) => {
                const {parameters, inputs, URIPath, isChatVariant} = data || {}
                errorArr.push(error as any)
                isErrorArr.push(!!error)
                optParamsArr.push(parameters || null)
                inputParamsArr.push(inputs || null)
                uriPathArr.push(URIPath || null)
                isChatVariantArr.push(isChatVariant || null)
            })

            setError(errorArr)
            setIsError(isErrorArr)
            setOptParams(optParamsArr)
            setInputParams(inputParamsArr)
            setURIPath(uriPathArr)
            setIsChatVariant(isChatVariantArr)
            setIsLoading(res.map(() => false))
        })
    }, [appId, variants])

    useEffect(() => {
        const updatedInputParams = optParams.map((params, ix) =>
            updateInputParams(params, inputParams[ix] || []),
        )
        setInputParams(updatedInputParams)
    }, [optParams])

    return variants.map((variant, ix) => {
        const getSaveOptParams =
            (ix: number) =>
            async (updatedOptParams: Parameter[], persist: boolean, updateVariant: boolean) => {
                setIsParamSaveLoading(isParamSaveLoading.map((val, i) => (i === ix ? true : val)))
                setIsError(isError.map((val, i) => (i === ix ? false : val)))
                try {
                    if (persist) {
                        if (!updateVariant) {
                            await saveNewVariant(
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
                    setOptParams(
                        optParams.map((params, i) => (i === ix ? updatedOptParams : params)),
                    )
                } catch (error) {
                    setIsError(isError.map((val, i) => (i === ix ? true : val)))
                } finally {
                    setIsParamSaveLoading(
                        isParamSaveLoading.map((val, i) => (i === ix ? false : val)),
                    )
                }
            }

        return {
            inputParams: inputParams[ix],
            optParams: optParams[ix],
            URIPath: URIPath[ix],
            isLoading: isLoading[ix],
            isError: isError[ix],
            error: error[ix],
            isParamSaveLoading: isParamSaveLoading[ix],
            saveOptParams: getSaveOptParams(ix),
            isChatVariant: isChatVariant[ix],
        }
    })
}
