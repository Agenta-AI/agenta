import {type ApiRevision} from "@/oss/lib/Types"
import {fetchAllPromptVersioning} from "@/oss/services/promptVersioning/api"

/**
 * Fetches revisions for a given variant ID
 */
export const fetchRevisions = async (
    variantId: string,
    projectId: string,
): Promise<ApiRevision[]> => {
    const response = await fetchAllPromptVersioning(variantId)
    return response as ApiRevision[]
}
