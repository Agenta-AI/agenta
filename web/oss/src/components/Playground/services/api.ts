/**
 * API service layer for Playground operations
 */

import axios from "@/oss/lib/api/assets/axiosConfig"
import {getProjectValues} from "@/oss/state/project"

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
}
