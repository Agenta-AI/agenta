import axios from "@/oss/lib/api/assets/axiosConfig"
import {getAgentaApiUrl} from "@/oss/lib/helpers/api"

export interface LoopsSyncProperties {
    company_size_v1?: string
    user_role_v1?: string
    user_experience_v1?: string
    interest_evaluation?: boolean
    interest_no_code?: boolean
    interest_prompt_management?: boolean
    interest_prompt_engineering?: boolean
    interest_observability?: boolean
    is_icp_v1?: boolean
    deviceTheme?: string
}

/**
 * Sync user properties from PostHog to Loops for email campaigns
 *
 * @param properties User properties to sync to Loops
 * @returns Response from the API
 */
export async function syncUserPropertiesToLoops(properties: LoopsSyncProperties) {
    try {
        const response = await axios.post(
            `${getAgentaApiUrl()}/analytics/sync-to-loops`,
            properties,
            {
                _ignoreError: false,
            } as any,
        )
        return response.data
    } catch (error) {
        console.error("Failed to sync properties to Loops:", error)
        // Don't throw - we don't want to block user flow if Loops sync fails
        return null
    }
}
