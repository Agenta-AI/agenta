// @ts-nocheck
import {Variant, Parameter, InputParameter} from "@/oss/lib/Types"
import {fetchVariantParametersFromOpenAPI} from "@/oss/services/api"

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

    const params = [...existingParams, ...newParams]

    return params
}

/**
 * Returns all the parameters, inputs and URIPath for a given variant
 * Uses the OpenAPI schema to get the parameters and inputs
 * Updates the inputs using the parameters specified by the user in the variant
 * @param appId
 * @param variant
 * @returns parameters, inputs, URIPath
 */
export const getAllVariantParameters = async (
    appId: string,
    _variant:
        | {
              variant?: Variant
          }
        | Variant,
) => {
    let parameters: Parameter[] = []
    let inputs: Parameter[] = []

    const variant =
        "variant" in _variant && _variant.variant ? _variant.variant : (_variant as Variant)

    try {
        const {initOptParams, inputParams, isChatVariant} = await fetchVariantParametersFromOpenAPI(
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
        console.error("getAllVariantParameters Error: ", err)
        throw err
    }
}

export const getVariantInputParameters = async (appId: string, variant: Variant) => {
    const {parameters, inputs} = await getAllVariantParameters(appId, variant)
    return updateInputParams(parameters, inputs || []) || inputs
}

export const variantNameWithRev = (variant: {
    variant_name: string
    revision?: number | string | null
}) => {
    let name = variant.variant_name
    if (![undefined, null].includes(variant.revision as any)) {
        name += ` v${variant.revision}`
    }
    return name
}

export const groupVariantsByParent = (variants: Variant[], showOnlyParents = false) => {
    const parentMap = {}

    variants.forEach((item) => {
        if (item._parentVariant) {
            const parentId =
                typeof item._parentVariant === "string"
                    ? item._parentVariant
                    : item._parentVariant.id

            if (!parentMap[parentId]) {
                parentMap[parentId] = {
                    id: parentId,
                    name: item.variantName,
                    variantName: item.variantName,
                    variantId: item.variantId,
                    // fallback values; detailed parent info should be fetched via selectors
                    revision: item.revision ?? 0,
                    createdAt: item.createdAt,
                    updatedAt: item.updatedAt ?? item.createdAt,
                    createdBy: item.createdBy,
                    children: showOnlyParents ? undefined : [],
                    revisions: [],
                }
            }

            if (!showOnlyParents) {
                parentMap[parentId].children.push(item)
            }
            parentMap[parentId].revisions.push(item)
        }
    })

    return Object.values(parentMap)
}
