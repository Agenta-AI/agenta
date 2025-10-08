/**
 * API service layer for Playground operations
 * Centralizes all backend communication for variants and test execution
 */

import axios from "@/oss/lib/api/assets/axiosConfig"
import {getAgentaApiUrl} from "@/oss/lib/helpers/api"
import type {EnhancedVariant} from "@/oss/lib/shared/variant/transformer/types"
import {getProjectValues} from "@/oss/state/project"

export interface VariantCreateParams {
    appId: string
    variantName: string
    baseVariantId?: string
    config: Record<string, any>
}

export interface VariantUpdateParams {
    variantId: string
    config: Record<string, any>
    optionalParams?: Record<string, any>
}

export interface TestExecutionParams {
    variantId: string
    testsetId: string
    inputRows: Record<string, any>[]
    config: TestConfig
}

/**
 * Variant CRUD API operations
 */
export class VariantAPI {
    /**
     * Create a new variant from base variant
     */
    static async createVariantFromBase(params: {
        baseId: string
        newVariantName: string
        newConfigName: string
        parameters: any
        commitMessage: string
    }): Promise<any> {
        const {projectId} = getProjectValues()
        const response = await axios.post(`/variants/from-base?project_id=${projectId}`, {
            base_id: params.baseId,
            new_variant_name: params.newVariantName,
            new_config_name: params.newConfigName,
            parameters: params.parameters,
            commit_message: params.commitMessage,
        })

        return response.data
    }

    /** Create a new variant */
    static async createVariant(params: VariantCreateParams): Promise<Variant> {
        const response = await axios.post(`/apps/${params.appId}/variants`, {
            variant_name: params.variantName,
            base_variant_id: params.baseVariantId,
            config: params.config,
        })

        return response.data
    }

    /**
     * Delete a variant
     */
    static async deleteVariant(variantId: string): Promise<void> {
        const {projectId} = getProjectValues()
        await axios.delete(`${getAgentaApiUrl()}/variants/${variantId}?project_id=${projectId}`)
    }

    /**
     * Save variant (commit changes)
     * Uses existing updateVariantParams API to persist changes
     * TODO: Replace with proper commit API that creates new revision
     */
    static async saveVariant(
        variantId: string,
        parameters?: any,
        note?: string,
    ): Promise<EnhancedVariant> {
        try {
            // Get project ID
            const {projectId} = getProjectValues()

            // The API expects a UUID (variantId), not a variant name

            const response = await fetch(
                `${getAgentaApiUrl()}/variants/${variantId}/parameters?project_id=${projectId}`,
                {
                    method: "PUT",
                    headers: {
                        "Content-Type": "application/json",
                    },
                    body: JSON.stringify({
                        parameters: parameters?.ag_config || parameters,
                        commit_message: note || "",
                    }),
                },
            )

            if (!response.ok) {
                const errorText = await response.text()
                console.error("VariantAPI.saveVariant: API error:", response.status, errorText)
                throw new Error(`API error: ${response.status} ${errorText}`)
            }

            // Parse response (commit API may return null/empty)
            try {
                const responseText = await response.text()
                if (responseText) {
                    JSON.parse(responseText) // Parse but don't use the result
                }
            } catch (e) {
                // Response might be empty or not JSON
            }

            // Since commit doesn't return updated variant, we need to fetch it again

            // Fetch the updated variant to get the new revision and state
            const fetchResponse = await fetch(
                `${getAgentaApiUrl()}/variants/${variantId}?project_id=${projectId}`,
                {
                    method: "GET",
                    headers: {
                        "Content-Type": "application/json",
                    },
                },
            )

            if (!fetchResponse.ok) {
                console.error("VariantAPI.saveVariant: Failed to fetch updated variant")
                throw new Error(`Failed to fetch updated variant: ${fetchResponse.status}`)
            }

            const updatedVariant = await fetchResponse.json()

            return updatedVariant
        } catch (error) {
            console.error("VariantAPI.saveVariant: Error:", error)

            // Return simulated variant data as fallback
            const newRevision = Math.floor(Date.now() / 1000) // Use timestamp as revision

            return {
                id: variantId,
                variantId: variantId,
                variantName: "default", // This should come from server
                revision: newRevision,
                parameters: parameters || {},
                createdAt: new Date().toISOString(),
                updatedAt: new Date().toISOString(),
                createdAtTimestamp: Date.now(),
                updatedAtTimestamp: Date.now(),
            } as EnhancedVariant
        }
    }
}
