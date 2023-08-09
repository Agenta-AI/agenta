import {useState, useEffect} from "react"
import {
    getVariantParametersFromOpenAPI,
    saveNewVariant,
    updateVariantParams,
} from "@/lib/services/api"
import {Variant, Parameter} from "@/lib/Types"
import {getAllVariantParameters, updateInputParams} from "@/lib/helpers/variantHelper"

/**
 * Hook for using the variant.
 * @param appName
 * @param variantName
 * @param sourceVariantName The original variant name, this is important for determining the URI path
 * @returns
 */
export function useVariant(appName: string, variant: Variant) {
    const [optParams, setOptParams] = useState<Parameter[] | null>(null)
    const [inputParams, setInputParams] = useState<Parameter[] | null>(null)
    const [URIPath, setURIPath] = useState<string | null>(null)
    const [isLoading, setIsLoading] = useState(true)
    const [isError, setIsError] = useState(false)
    const [error, setError] = useState<Error | null>(null)
    const [isParamSaveLoading, setIsParamSaveLoading] = useState(false)

    useEffect(() => {
        const fetchParameters = async () => {
            setIsLoading(true)
            setIsError(false)
            try {
                const {parameters, inputs, URIPath} = await getAllVariantParameters(
                    appName,
                    variant,
                )
                setOptParams(parameters)
                setInputParams(inputs)
                setURIPath(URIPath)
                // console.log("useEffect", parameters, inputs, URIPath)
                // console.log("useEffect", optParams, inputParams, URIPath)
            } catch (error: any) {
                setIsError(true)
                setError(error)
            } finally {
                setIsLoading(false)
            }
        }

        fetchParameters()
    }, [appName, variant])

    useEffect(() => {
        const updatedInputParams = updateInputParams(optParams, inputParams || [])
        setInputParams(updatedInputParams)
    }, [optParams])

    /**
     * Saves new values for the optional parameters of the variant.
     * @param updatedOptParams
     * @param persist
     */
    const saveOptParams = async (
        updatedOptParams: Parameter[],
        persist: boolean,
        updateVariant: boolean,
    ) => {
        console.log(updatedOptParams)
        setIsParamSaveLoading(true)
        setIsError(false)
        try {
            if (persist) {
                if (!updateVariant) {
                    await saveNewVariant(appName, variant, updatedOptParams)
                } else if (updateVariant) {
                    await updateVariantParams(appName, variant, updatedOptParams)
                }
                variant.parameters = updatedOptParams.reduce((acc, param) => {
                    return {...acc, [param.name]: param.default}
                }, {})
            }
            setOptParams(updatedOptParams)
        } catch (error) {
            setIsError(true)
        } finally {
            setIsParamSaveLoading(false)
        }
    }

    return {
        inputParams,
        optParams,
        URIPath,
        isLoading,
        isError,
        error,
        isParamSaveLoading,
        saveOptParams,
    }
}
