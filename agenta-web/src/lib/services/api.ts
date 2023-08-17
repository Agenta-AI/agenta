import useSWR from "swr"
import axios from "axios"
import {parseOpenApiSchema} from "@/lib/helpers/openapi_parser"
import {Variant, Parameter, EvaluationResponseType, Evaluation} from "@/lib/Types"
import {
    fromEvaluationResponseToEvaluation,
    fromEvaluationScenarioResponseToEvaluationScenario,
} from "../transformers"
import {EvaluationType} from "../enums"
/**
 * Raw interface for the parameters parsed from the openapi.json
 */

const fetcher = (...args) => fetch(...args).then((res) => res.json())

export async function fetchVariants(app: string): Promise<Variant[]> {
    const response = await axios.get(
        `${process.env.NEXT_PUBLIC_AGENTA_API_URL}/api/app_variant/list_variants/?app_name=${app}`,
    )

    if (response.data && Array.isArray(response.data) && response.data.length > 0) {
        return response.data.map((variant: Record<string, any>) => {
            let v: Variant = {
                variantName: variant.variant_name,
                templateVariantName: variant.previous_variant_name,
                persistent: true,
                parameters: variant.parameters,
            }
            return v
        })
    }

    return []
}

/**
 * Calls the variant endpoint with the input parameters and the optional parameters and returns the response.
 * @param inputParametersDict A dictionary of the input parameters to be passed to the variant endpoint
 * @param inputParamDefinition A list of the parameters that are defined in the openapi.json (these are only part of the input params, the rest is defined by the user in the optparms)
 * @param optionalParameters The optional parameters (prompt, models, AND DICTINPUTS WHICH ARE TO BE USED TO ADD INPUTS )
 * @param URIPath
 * @returns
 */
export function callVariant(
    inputParametersDict: Record<string, string>,
    inputParamDefinition: Parameter[],
    optionalParameters: Parameter[],
    URIPath: string,
) {
    console.log("inputParametersDict", inputParametersDict)
    // Separate input parameters into two dictionaries based on the 'input' property
    const mainInputParams: Record<string, string> = {} // Parameters with input = true
    const secondaryInputParams: Record<string, string> = {} // Parameters with input = false
    const inputParams = Object.keys(inputParametersDict).reduce((acc: any, key) => {
        acc[key] = inputParametersDict[key]
        return acc
    }, {})
    for (let key of Object.keys(inputParametersDict)) {
        const paramDefinition = inputParamDefinition.find((param) => param.name === key)

        // If parameter definition is found and its 'input' property is false,
        // then it goes to 'secondaryInputParams', otherwise to 'mainInputParams'
        if (paramDefinition && !paramDefinition.input) {
            secondaryInputParams[key] = inputParametersDict[key]
        } else {
            mainInputParams[key] = inputParametersDict[key]
        }
    }

    optionalParameters = optionalParameters || []

    const optParams = optionalParameters
        .filter((param) => param.default)
        .filter((param) => param.type !== "object") // remove dics from optional parameters
        .reduce((acc: any, param) => {
            acc[param.name] = param.default
            return acc
        }, {})
    const requestBody = {
        ["inputs"]: secondaryInputParams,
        ...mainInputParams,
        ...optParams,
    }

    return axios
        .post(`${process.env.NEXT_PUBLIC_AGENTA_API_URL}/${URIPath}/generate`, requestBody, {
            headers: {
                accept: "application/json",
                "Content-Type": "application/json",
            },
        })
        .then((res) => {
            return res.data
        })
        .catch((error) => {
            if (error.response && error.response.status === 500) {
                throw new Error(error.response.data.error + " " + error.response.data.traceback)
            }
            if (error.response && error.response.status === 422) {
                throw new Error(
                    `Unprocessable Entity: The server understands the content type of the request, and the syntax of the request is correct, but it was unable to process the contained instructions. Data: ${JSON.stringify(
                        error.response.data,
                        null,
                        2,
                    )}`,
                )
            }
            throw error // If it's not a 500 status, or if error.response is undefined, rethrow the error so it can be handled elsewhere.
        })
}

/**
 * Parses the openapi.json from a variant and returns the parameters as an array of objects.
 * @param app
 * @param variantName
 * @returns
 */
export const getVariantParametersFromOpenAPI = async (app: string, variant: Variant) => {
    try {
        const sourceName = variant.templateVariantName
            ? variant.templateVariantName
            : variant.variantName
        const url = `${process.env.NEXT_PUBLIC_AGENTA_API_URL}/${app}/${sourceName}/openapi.json`
        const response = await axios.get(url)
        let APIParams = parseOpenApiSchema(response.data)
        // we create a new param for DictInput that will contain the name of the inputs
        APIParams = APIParams.map((param) => {
            if (param.type === "object") {
                param.default = param.default.map((item:string) => {
                                    return { name: item };
                                });
            }
            return param
        })
        const initOptParams = APIParams.filter((param) => !param.input) // contains the default values too!
        const inputParams = APIParams.filter((param) => param.input) // don't have input values
        return {initOptParams, inputParams}
    } catch (error) {
        throw error
    }
}

/**
 * Saves a new variant to the database based on previous
 */
export async function saveNewVariant(appName: string, variant: Variant, parameters: Parameter[]) {
    const appVariant = {
        app_name: appName,
        variant_name: variant.templateVariantName,
    }
    try {
        const response = await axios.post(
            `${process.env.NEXT_PUBLIC_AGENTA_API_URL}/api/app_variant/add/from_previous/`,
            {
                previous_app_variant: appVariant,
                new_variant_name: variant.variantName,
                parameters: parameters.reduce((acc, param) => {
                    return {...acc, [param.name]: param.default}
                }, {}),
            },
        )

        // You can use the response here if needed
    } catch (error) {
        console.error(error)
        // Handle error here
        throw error
    }
}

export async function updateVariantParams(
    appName: string,
    variant: Variant,
    parameters: Parameter[],
) {
    try {
        const response = await axios.put(
            `${process.env.NEXT_PUBLIC_AGENTA_API_URL}/api/app_variant/update_variant_parameters/`,
            {
                app_name: appName,
                variant_name: variant.variantName,
                parameters: parameters.reduce((acc, param) => {
                    return {...acc, [param.name]: param.default}
                }, {}),
            },
        )
    } catch (error) {
        console.error(error)
        throw error
    }
}

export async function removeApp(appName: string) {
    try {
        await axios.delete(
            `${process.env.NEXT_PUBLIC_AGENTA_API_URL}/api/app_variant/remove_app/`,
            {data: {app_name: appName}},
        )
        console.log("App removed: " + appName)
    } catch (error) {
        console.error("Error removing " + appName + " " + error)
        throw error
    }
}

export async function removeVariant(appName: string, variantName: string) {
    try {
        await axios.delete(
            `${process.env.NEXT_PUBLIC_AGENTA_API_URL}/api/app_variant/remove_variant/`,
            {data: {app_name: appName, variant_name: variantName}},
        )
        console.log("Variant removed: " + variantName)
    } catch (error) {
        console.error("Error removing " + variantName + " " + error)
        throw error
    }
}
/**
 * Loads the list of testsets
 * @returns
 */
export const useLoadTestsetsList = (app_name: string) => {
    const {data, error, mutate} = useSWR(
        `${process.env.NEXT_PUBLIC_AGENTA_API_URL}/api/testsets?app_name=${app_name}`,
        fetcher,
        {revalidateOnFocus: false},
    )
    return {
        testsets: data,
        isTestsetsLoading: !error && !data,
        isTestsetsLoadingError: error,
        mutate,
    }
}

export async function createNewTestset(appName: string, testsetName: string, testsetData: any) {
    try {
        const response = await axios.post(
            `${process.env.NEXT_PUBLIC_AGENTA_API_URL}/api/testsets/${appName}`,
            {
                name: testsetName,
                csvdata: testsetData,
            },
        )
        return response
    } catch (error) {
        console.error(error)
        throw error
    }
}

export async function updateTestset(testsetId: String, testsetName: string, testsetData: any) {
    try {
        const response = await axios.put(
            `${process.env.NEXT_PUBLIC_AGENTA_API_URL}/api/testsets/${testsetId}`,
            {
                name: testsetName,
                csvdata: testsetData,
            },
        )
        return response
    } catch (error) {
        console.error(error)
        throw error
    }
}

export const loadTestset = async (testsetId: string) => {
    return fetch(`${process.env.NEXT_PUBLIC_AGENTA_API_URL}/api/testsets/${testsetId}`, {
        headers: {
            "Content-Type": "application/json",
        },
    })
        .then((res) => res.json())
        .then((data) => {
            return data
        })
        .catch((err) => {
            console.error(err)
        })
}

export const deleteTestsets = async (ids: string[]) => {
    try {
        const response = await axios({
            method: "delete",
            url: `${process.env.NEXT_PUBLIC_AGENTA_API_URL}/api/testsets`,
            data: {testset_ids: ids},
        })
        if (response.status === 200) {
            return response.data
        }
    } catch (error) {
        console.error(`Error deleting entity: ${error}`)
        throw error
    }
}

const eval_endpoint = axios.create({
    baseURL: `${process.env.NEXT_PUBLIC_AGENTA_API_URL}/api/evaluations`,
})

export const loadEvaluations = async (app_name: string) => {
    try {
        return await eval_endpoint.get(`?app_name=${app_name}`).then((responseData) => {
            const evaluations = responseData.data.map((item: EvaluationResponseType) => {
                return fromEvaluationResponseToEvaluation(item)
            })

            return evaluations
        })
    } catch (error) {
        console.error(error)
        throw error
    }
}

export const loadEvaluation = async (evaluationId: string) => {
    try {
        return await eval_endpoint.get(evaluationId).then((responseData) => {
            return fromEvaluationResponseToEvaluation(responseData.data)
        })
    } catch (error) {
        console.error(error)
        throw error
    }
}

export const deleteEvaluations = async (ids: string[]) => {
    try {
        const response = await axios({
            method: "delete",
            url: `${process.env.NEXT_PUBLIC_AGENTA_API_URL}/api/evaluations`,
            data: {evaluations_ids: ids},
        })
        if (response.status === 200) {
            return response.data
        }
    } catch (error) {
        console.error(`Error deleting entity: ${error}`)
        throw error
    }
}

export const loadEvaluationsScenarios = async (
    evaluationTableId: string,
    evaluation: Evaluation,
) => {
    try {
        return await eval_endpoint
            .get(`${evaluationTableId}/evaluation_scenarios`)
            .then((responseData) => {
                const evaluationsRows = responseData.data.map((item: any) => {
                    return fromEvaluationScenarioResponseToEvaluationScenario(item, evaluation)
                })

                return evaluationsRows
            })
    } catch (error) {
        console.error(error)
        throw error
    }
}

export const updateEvaluation = async (evaluationId: string, data) => {
    const response = await eval_endpoint.put(`${evaluationId}`, data)
    return response.data
}

export const updateEvaluationScenario = async (
    evaluationTableId: string,
    evaluationScenarioId: string,
    data,
    evaluationType: EvaluationType,
) => {
    const response = await eval_endpoint.put(
        `${evaluationTableId}/evaluation_scenario/${evaluationScenarioId}/${evaluationType}`,
        data,
    )
    return response.data
}

export const postEvaluationScenario = async (evaluationTableId: string, data) => {
    const response = await eval_endpoint.post(`${evaluationTableId}/evaluation_scenario`, data)
    return response.data
}

export const fetchEvaluationResults = async (evaluationId: string) => {
    try {
        const response = await fetch(
            `${process.env.NEXT_PUBLIC_AGENTA_API_URL}/api/evaluations/${evaluationId}/results`,
        )
        if (response.ok) {
            const data = await response.json()
            return data
        } else {
            throw new Error("Failed to fetch results.")
        }
    } catch (error) {
        console.error("Error fetching results:", error)
        throw error
    }
}
