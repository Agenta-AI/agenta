import axios from "@/oss/lib/api/assets/axiosConfig"
import {getAgentaApiUrl} from "@/oss/lib/helpers/api"

import {testcasesResponseSchema, type Testcase} from "./schema"

/**
 * Fetch a single testcase by ID
 */
export const fetchTestcase = async (params: {
    projectId: string
    testcaseId: string
}): Promise<Testcase | null> => {
    const {projectId, testcaseId} = params

    try {
        const response = await axios.post(
            `${getAgentaApiUrl()}/preview/testcases/query`,
            {testcase_ids: [testcaseId]},
            {params: {project_id: projectId}},
        )

        const validatedResponse = testcasesResponseSchema.parse(response.data)
        return validatedResponse.testcases[0] || null
    } catch (error) {
        console.error("[TestcaseEntity] Failed to fetch testcase:", error)
        return null
    }
}
