import {Variant, Parameter, InputParameter} from "@/lib/Types"
import {getVariantParametersFromOpenAPI} from "@/lib/services/api"
import {globalErrorHandler} from "./errorHandler"

const inputParamsToParameters = (additionalInputs: InputParameter[]): Parameter[] => {
    return additionalInputs.map((value) => ({
        name: value.name,
        type: "string",
        input: false,
        required: false,
    }))
}

/**
 * Updates the input parameters using the parameters specified by the user in the optParams
 * @param optParams
 * @param currentInputParams
 * @returns
 */
export const updateInputParams = (
    optParams: Parameter[] | null,
    currentInputParams: Parameter[],
): Parameter[] => {
    // Extract optParameters which are used to define inputs (DictInputs in sdk)
    if (!optParams) {
        return currentInputParams
    }
    const additionalInputs: InputParameter[] = optParams
        .filter((param) => param.type === "object" && param.default)
        .flatMap((param) => param.default)
    // Convert them to InputParameters
    const newParams = inputParamsToParameters(additionalInputs)

    // Filter out the existing inputParams which have input=true
    const existingParams = currentInputParams.filter((param) => param.input)

    return [...existingParams, ...newParams]
}

/**
 * Returns all the parameters, inputs and URIPath for a given variant
 * Uses the OpenAPI schema to get the parameters and inputs
 * Updates the inputs using the parameters specified by the user in the variant
 * @param appId
 * @param variant
 * @returns parameters, inputs, URIPath
 */
export const getAllVariantParameters = async (appId: string, variant: Variant) => {
    let parameters: Parameter[] = []
    let inputs: Parameter[] = []
    try {
        const {initOptParams, inputParams, isChatVariant} = await getVariantParametersFromOpenAPI(
            appId,
            variant.variantId,
            variant.baseId,
            true,
        )
        if (variant.parameters) {
            const updatedInitOptParams = initOptParams.map((param) => {
                return variant.parameters && variant.parameters.hasOwnProperty(param.name)
                    ? {...param, default: variant.parameters[param.name]}
                    : param
            })
            parameters = [...updatedInitOptParams]
        } else {
            parameters = [...initOptParams]
        }
        inputs = updateInputParams(parameters, inputParams)
        const URIPath = `${appId}/${variant.baseId}`
        return {parameters, inputs, URIPath, isChatVariant}
    } catch (err) {
        console.log("getAllVariantParameters Error: ", err)
        throw err
    }
}

export const getVariantInputParameters = async (appId: string, variant: Variant) => {
    const {parameters, inputs} = await getAllVariantParameters(appId, variant)
    return updateInputParams(parameters, inputs || []) || inputs
}
