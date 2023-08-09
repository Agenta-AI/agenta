import {useState, useEffect} from "react"
import {
    getVariantParametersFromOpenAPI,
    saveNewVariant,
    updateVariantParams,
} from "@/lib/services/api"
import {Variant, Parameter} from "@/lib/Types"

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
                // get the parameters of the variant by parsing the openapi.json
                const {initOptParams, inputParams} = await getVariantParametersFromOpenAPI(
                    appName,
                    variant,
                )

                if (variant.parameters) {
                    const updatedInitOptParams = initOptParams.map((param) => {
                        return variant.parameters && variant.parameters.hasOwnProperty(param.name)
                            ? {...param, default: variant.parameters[param.name]}
                            : param
                    })
                    setOptParams(updatedInitOptParams)
                } else {
                    setOptParams(initOptParams)
                }

                setInputParams(inputParams)

                setURIPath(
                    `${appName}/${
                        variant.templateVariantName
                            ? variant.templateVariantName
                            : variant.variantName
                    }`,
                )
            } catch (error: any) {
                setIsError(true)
                setError(error)
            } finally {
                setIsLoading(false)
            }
        }

        fetchParameters()
    }, [appName, variant])

    const extractDefaultStrings = (params: Parameter[]): string[] => {
        return params
            .filter((param) => param.type === "object" && param.default)
            .flatMap((param) => param.default)
    }
    const stringsToParameters = (strings: string[]): Parameter[] => {
        return strings.map((value) => ({
            name: value.name,
            type: "string",
            input: false,
            required: false,
        }))
    }
    const generateInputParams = (
        optParams: Parameter[],
        currentInputParams: Parameter[],
    ): Parameter[] => {
        // Extract combined list of strings
        const defaultStrings = extractDefaultStrings(optParams)
        console.log("defaultStrings:", defaultStrings)
        // Convert them to Parameters
        const newParams = stringsToParameters(defaultStrings)
        console.log("newParams:", newParams)

        // Filter out the existing inputParams which have input=true
        const existingParams = currentInputParams.filter((param) => param.input)

        return [...existingParams, ...newParams]
    }

    useEffect(() => {
        if (optParams) {
            const updatedInputParams = generateInputParams(optParams, inputParams || [])
            setInputParams(updatedInputParams)
        } else {
            let newParams = [...(inputParams || [])]
            setInputParams(newParams)
        }
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
