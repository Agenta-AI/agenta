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
import {getProjectValues} from "@/oss/state/project"

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
