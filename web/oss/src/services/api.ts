import {probeEndpointPath} from "@agenta/entities/shared/openapi"
import {
    queryWorkflowVariants,
    fetchWorkflowRevisionById,
    resolveBuiltinAppServiceUrl,
} from "@agenta/entities/workflow"
import {shortPoll} from "@agenta/shared/utils"
import Session from "supertokens-auth-react/recipe/session"

import axios from "@/oss/lib/api/assets/axiosConfig"
import {getAgentaApiUrl} from "@/oss/lib/helpers/api"
import {
    detectChatVariantFromOpenAISchema,
    openAISchemaToParameters,
} from "@/oss/lib/helpers/openapi_parser"
import {Parameter, ChatMessage, KeyValuePair, FuncResponse, BaseResponse} from "@/oss/lib/Types"
import {getProjectValues} from "@/oss/state/project"

const constructPlaygroundTestUrl = (
    uri: {routePath?: string; runtimePrefix?: string},
    endpoint = "/test",
    withPrefix = true,
) => {
    return `${withPrefix ? uri.runtimePrefix || "" : ""}${uri.routePath ? `/${uri.routePath}` : ""}${endpoint}`
}

//Prefix convention:
//  - fetch: GET single entity from server
//  - fetchAll: GET all entities from server
//  - create: POST data to server
//  - update: PUT data to server
//  - delete: DELETE data from server

/**
 * Raw interface for the parameters parsed from the openapi.json
 */

export const axiosFetcher = (url: string) => axios.get(url).then((res) => res.data)

/**
 * Get the JWT from SuperTokens
 */
export const getJWT = async () => {
    try {
        if (await Session.doesSessionExist()) {
            const jwt = await Session.getAccessToken()

            return jwt
        }
    } catch (error) {
        console.error("Failed to fetch JWT", process.env.NODE_ENV)
    }

    // In test environment, fall back to test JWT if available
    if (typeof process !== "undefined" && process.env.NODE_ENV === "test") {
        const testJWT = process.env.VITEST_TEST_JWT || process.env.TEST_JWT
        if (testJWT) {
            return testJWT
        }
    }

    return undefined
}

/**
 * Calls the variant endpoint with the input parameters and the optional parameters and returns the response.
 * @param inputParametersDict A dictionary of the input parameters to be passed to the variant endpoint
 * @param inputParamDefinition A list of the parameters that are defined in the openapi.json (these are only part of the input params, the rest is defined by the user in the optparms)
 * @param optionalParameters The optional parameters (prompt, models, AND DICTINPUTS WHICH ARE TO BE USED TO ADD INPUTS )
 * @param appId - The ID of the app.
 * @param baseId - The base ID.
 * @param chatMessages - An optional array of chat messages.
 * @returns A Promise that resolves with the response data from the POST request.
 */
export async function callVariant(
    inputParametersDict: KeyValuePair,
    inputParamDefinition: Parameter[],
    optionalParameters: Parameter[],
    appId: string,
    baseId: string,
    chatMessages?: ChatMessage[],
    signal?: AbortSignal,
    ignoreAxiosError?: boolean,
    isNewVariant?: boolean,
    isCustomVariant?: boolean,
    uriObject?: {
        runtimePrefix: string
        routePath?: string
    },
    variantId?: string,
): Promise<string | FuncResponse | BaseResponse> {
    const isChatVariant = Array.isArray(chatMessages) && chatMessages.length > 0
    const reservedInputKeys = new Set([
        "ag_config",
        "inputs",
        "messages",
        "environment",
        "revision_id",
        "variant_id",
        "app_id",
    ])
    const normalizedInputParamDefinition = (inputParamDefinition || []).filter((param) => {
        const name = param?.name
        return typeof name === "string" && name.length > 0 && !reservedInputKeys.has(name)
    })

    // Separate input parameters into two dictionaries based on the 'input' property
    const mainInputParams: Record<string, any> = {} // Parameters with input = true
    const secondaryInputParams: Record<string, string> = {} // Parameters with input = false

    for (const key of Object.keys(inputParametersDict)) {
        if (reservedInputKeys.has(key)) continue

        const paramDefinition = normalizedInputParamDefinition.find((param) => param.name === key)

        // If parameter definition is found and its 'input' property is false,
        // then it goes to 'secondaryInputParams', otherwise to 'mainInputParams'
        if (paramDefinition && !paramDefinition.input) {
            secondaryInputParams[key] = inputParametersDict[key]
        } else {
            mainInputParams[key] = inputParametersDict[key]
        }
    }
    optionalParameters = optionalParameters || []

    const optParams = Array.isArray(optionalParameters)
        ? optionalParameters
              .filter((param) => param.type !== "object") // remove dicts from optional parameters
              .reduce((acc: any, param) => {
                  acc[param.name] = param.default
                  return acc
              }, {})
        : optionalParameters

    const requestBody = {
        ...mainInputParams,
        ...optParams,
    }

    if (isChatVariant) {
        if (isNewVariant) {
            requestBody["messages"] = chatMessages
        } else {
            requestBody["inputs"] = chatMessages
        }
    }

    if (isCustomVariant) {
        for (const key of Object.keys(inputParametersDict)) {
            if (key !== "inputs") {
                requestBody[key] = inputParametersDict[key]
            }
        }
    } else {
        const inputs = {...secondaryInputParams}
        for (const x of normalizedInputParamDefinition) {
            if (!inputs[x.name]) {
                inputs[x.name] = null
            }
        }
        requestBody["inputs"] = inputs
    }

    if (uriObject) {
        const uri = constructPlaygroundTestUrl(uriObject, "/test", true)
        const jwt = await getJWT()
        const headers = {
            "Content-Type": "application/json",
            "ngrok-skip-browser-warning": "1",
            ...(jwt
                ? {
                      Authorization: `Bearer ${jwt}`,
                  }
                : {}),
        }

        const response = await axios
            .post(uri, requestBody, {
                signal,
                _ignoreError: ignoreAxiosError,
                headers: headers,
            } as any)
            .then((response) => {
                return response
            })
            .catch((error) => {
                console.log("Secure call to LLM App failed:", error)

                throw error
            })

        return response?.data
    } else {
        const appContainerURI = await fetchAppContainerURL(appId, variantId, baseId)
        const {projectId} = getProjectValues()
        const jwt = await getJWT()

        const base_url = `${appContainerURI}/test?application_id=${appId}`
        const secure_url = `${base_url}&project_id=${projectId}`
        const secure_headers = {Authorization: jwt && `Bearer ${jwt}`}

        const response = await axios
            .post(base_url, requestBody, {
                signal,
                _ignoreError: ignoreAxiosError,
            } as any)
            .then((response) => {
                return response
            })
            .catch(async (error) => {
                console.log("Unsecure call to LLM App failed:", error)

                if (error?.response?.status !== 401) {
                    throw error
                }

                const response = await axios
                    .post(secure_url, requestBody, {
                        signal,
                        _ignoreError: ignoreAxiosError,
                        headers: secure_headers,
                    } as any)
                    .then((response) => {
                        return response
                    })
                    .catch((error) => {
                        console.log("Secure call to LLM App failed:", error)

                        throw error
                    })

                return response
            })

        return response?.data
    }
}

/**
 * Parses the openapi.json from a variant and returns the parameters as an array of objects.
 * @param app
 * @param variantName
 * @returns
 */
export const fetchVariantParametersFromOpenAPI = async (
    appId: string,
    variantId?: string,
    baseId?: string,
    ignoreAxiosError = false,
) => {
    const appContainerURI = await fetchAppContainerURL(appId, variantId, baseId)
    const {projectId} = getProjectValues()
    const jwt = await getJWT()

    const base_url = `${appContainerURI}/openapi.json`
    const secure_url = `${base_url}?project_id=${projectId}`
    const secure_headers = {Authorization: jwt && `Bearer ${jwt}`}

    const response = await axios
        .get(base_url, {
            _ignoreError: ignoreAxiosError,
        } as any)
        .then((response) => {
            return response
        })
        .catch(async (error) => {
            console.log("Unsecure call to LLM App failed:", error)

            if (error?.response?.status !== 401) {
                throw error
            }

            const response = await axios
                .get(secure_url, {
                    _ignoreError: ignoreAxiosError,
                    headers: secure_headers,
                } as any)
                .then((response) => {
                    return response
                })
                .catch((error) => {
                    console.log("Secure call to LLM App failed:", error)

                    throw error
                })

            return response
        })

    const isChatVariant = detectChatVariantFromOpenAISchema(response?.data)
    let APIParams = openAISchemaToParameters(response?.data)

    // we create a new param for DictInput that will contain the name of the inputs
    APIParams = APIParams.map((param) => {
        if (param.type === "object") {
            // if param.default is defined
            if (param?.default) {
                param.default = param.default.map((item: string) => {
                    return {name: item}
                })
            } else {
                param.default = []
            }
        }
        return param
    })

    if (isChatVariant) APIParams = APIParams.filter((param) => param.name !== "inputs")
    const initOptParams = APIParams.filter((param) => !param.input) // contains the default values too!
    const inputParams = APIParams.filter((param) => param.input) // don't have input values
    return {
        initOptParams,
        inputParams,
        isChatVariant,
    }
}

/**
 * Retries the container url for an app
 * @param {string} appId - The id of the app
 * @param {string} variantId - The id of the variant
 * @returns {Promise<string>} - Returns the URL path or an empty string
 * @throws {Error} - Throws an error if the request fails
 */
export const fetchAppContainerURL = async (
    appId: string,
    variantId?: string,
    baseId?: string,
): Promise<string> => {
    try {
        // Null-check for the environment variable
        if (!getAgentaApiUrl()) {
            throw new Error("Environment variable NEXT_PUBLIC_AGENTA_API_URL is not set.")
        }
        const {projectId} = getProjectValues()

        // Retrieve container URL from backend
        const {data} = await axios.get(
            `${getAgentaApiUrl()}/variants/${variantId}?project_id=${projectId}`,
            {
                _ignoreError: true,
            } as any,
        )
        const uriObject = await probeEndpointPath(data.uri)
        if (uriObject) {
            return constructPlaygroundTestUrl(uriObject, "", true)
        } else {
            throw new Error("Failed to find container url")
        }
    } catch (error) {
        // Forward the error so it can be handled by the calling function
        throw error
    }
}

export const fetchProfile = async (ignoreAxiosError = false) => {
    return axios.get(`${getAgentaApiUrl()}/profile`, {
        _ignoreError: ignoreAxiosError,
    } as any)
}

export const fetchData = async (url: string): Promise<any> => {
    const response = await fetch(url)
    return response.json()
}

export const waitForAppToStart = async ({
    appId,
    variantId,
    timeout = 20000,
    interval = 2000,
}: {
    appId: string
    variantId?: string
    timeout?: number
    interval?: number
}): Promise<{
    stopper: () => void
    promise: Promise<void>
}> => {
    const {projectId} = getProjectValues()
    if (!projectId) {
        return {stopper: () => {}, promise: Promise.reject(new Error("Project not found"))}
    }

    // Resolve variant ID if not provided
    let resolvedVariantId = variantId
    if (!resolvedVariantId) {
        const result = await queryWorkflowVariants(appId, projectId)
        resolvedVariantId = result.workflow_variants[0]?.id
    }
    if (!resolvedVariantId) {
        return {stopper: () => {}, promise: Promise.reject(new Error("Variant not found"))}
    }

    // Fetch full revision data to resolve the service URL
    const revision = await fetchWorkflowRevisionById(resolvedVariantId, projectId)
    const serviceUrl = resolveBuiltinAppServiceUrl(revision) ?? revision.data?.url
    if (!serviceUrl) {
        return {stopper: () => {}, promise: Promise.reject(new Error("Service URL not found"))}
    }

    // Poll until the service responds on /openapi.json
    const {stopper, promise} = shortPoll(
        async () => {
            const result = await probeEndpointPath(serviceUrl, {endpoint: "/openapi.json"})
            if (result) stopper()
        },
        {delayMs: interval, timeoutMs: timeout},
    )

    return {stopper, promise}
}

// Re-export profile mutations for backward compatibility with older imports
export {updateProfile, changePassword} from "./profile"
