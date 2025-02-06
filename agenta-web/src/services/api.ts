import {getCurrentProject} from "@/contexts/project.context"
import axios from "@/lib/api/assets/axiosConfig"
import Session from "supertokens-auth-react/recipe/session"
import {formatDay} from "@/lib/helpers/dateTimeHelper"
import {
    detectChatVariantFromOpenAISchema,
    openAISchemaToParameters,
} from "@/lib/helpers/openapi_parser"
import {getAgentaApiUrl, removeKeys, shortPoll} from "@/lib/helpers/utils"
import {
    Variant,
    Parameter,
    ChatMessage,
    KeyValuePair,
    FuncResponse,
    BaseResponse,
    User,
} from "@/lib/Types"
import {uriFixer} from "@/components/NewPlayground/hooks/usePlayground/assets/helpers"

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

export async function fetchVariants(
    appId: string,
    ignoreAxiosError: boolean = false,
): Promise<Variant[]> {
    const {projectId} = getCurrentProject()

    const response = await axios.get(
        `${getAgentaApiUrl()}/api/apps/${appId}/variants?project_id=${projectId}`,
        {
            _ignoreError: ignoreAxiosError,
        } as any,
    )

    if (response.data && Array.isArray(response.data) && response.data.length > 0) {
        return response.data.map((variant: Record<string, any>) => {
            let v: Variant = {
                variantName: variant.variant_name,
                templateVariantName: variant.previous_variant_name,
                persistent: true,
                parameters: variant.parameters,
                previousVariantName: variant.previous_variant_name || null,
                variantId: variant.variant_id,
                baseId: variant.base_id,
                baseName: variant.base_name,
                configName: variant.config_name,
                revision: variant.revision,
                updatedAt: formatDay(variant.updated_at),
                modifiedById: variant.modified_by_id,
                createdAt: formatDay(variant.created_at),
                uri: uriFixer(variant.uri),
            }
            return v
        })
    }

    return []
}

/**
 * Get the JWT from SuperTokens
 */
export const getJWT = async () => {
    try {
        if (await Session.doesSessionExist()) {
            let jwt = await Session.getAccessToken()

            return jwt
        }
    } catch (error) {}

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
): Promise<string | FuncResponse | BaseResponse> {
    const isChatVariant = Array.isArray(chatMessages) && chatMessages.length > 0
    // Separate input parameters into two dictionaries based on the 'input' property
    const mainInputParams: Record<string, string> = {} // Parameters with input = true
    const secondaryInputParams: Record<string, string> = {} // Parameters with input = false

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

    requestBody["inputs"] = secondaryInputParams

    const appContainerURI = await fetchAppContainerURL(appId, undefined, baseId)
    const {projectId} = getCurrentProject()
    const jwt = await getJWT()

    const base_url = `${appContainerURI}/generate?application_id=${appId}`
    const secure_url = `${base_url}&project_id=${projectId}`
    const secure_headers = {Authorization: jwt && `Bearer ${jwt}`}

    let response = await axios
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

            let response = await axios
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
    ignoreAxiosError: boolean = false,
) => {
    const appContainerURI = await fetchAppContainerURL(appId, variantId, baseId)
    const {projectId} = getCurrentProject()
    const jwt = await getJWT()

    const base_url = `${appContainerURI}/openapi.json`
    const secure_url = `${base_url}?project_id=${projectId}`
    const secure_headers = {Authorization: jwt && `Bearer ${jwt}`}

    let response = await axios
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

            let response = await axios
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
        const {projectId} = getCurrentProject()

        // Retrieve container URL from backend
        const url = `${getAgentaApiUrl()}/api/containers/container_url?project_id=${projectId}`
        const response = await axios.get(url, {params: {variant_id: variantId, base_id: baseId}})
        if (response.status === 200 && response.data && response.data.uri) {
            return response.data.uri
        } else {
            return ""
        }
    } catch (error) {
        // Forward the error so it can be handled by the calling function
        throw error
    }
}

export const fetchProfile = async (ignoreAxiosError: boolean = false) => {
    return axios.get(`${getAgentaApiUrl()}/api/profile`, {
        _ignoreError: ignoreAxiosError,
    } as any)
}

export const fetchSingleProfile = async (
    userId: string,
    ignoreAxiosError: boolean = false,
): Promise<User> => {
    const {data} = await axios.get(`${getAgentaApiUrl()}/api/profile?user_id=${userId}`, {
        _ignoreError: ignoreAxiosError,
    } as any)

    return data
}

export const fetchData = async (url: string): Promise<any> => {
    const response = await fetch(url)
    return response.json()
}

export const waitForAppToStart = async ({
    appId,
    variant,
    timeout = 20000,
    interval = 2000,
}: {
    appId: string
    variant?: Variant
    timeout?: number
    interval?: number
}): Promise<{
    stopper: () => void
    promise: Promise<void>
}> => {
    const _variant = variant || (await fetchVariants(appId, true))[0]
    if (_variant) {
        const {stopper, promise} = shortPoll(
            () =>
                fetchVariantParametersFromOpenAPI(
                    appId,
                    _variant.variantId,
                    _variant.baseId,
                    true,
                ).then(() => stopper()),
            {delayMs: interval, timeoutMs: timeout},
        )

        return {stopper, promise}
    } else {
        return {stopper: () => {}, promise: Promise.reject(new Error("Variant not found"))}
    }
}
