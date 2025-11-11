import {type Environment, type CamelCaseEnvironment, type ApiRevision} from "@/oss/lib/Types"
import {fetchSingleProfile} from "@/oss/services/api"
import {fetchEnvironments} from "@/oss/services/deployment/api"
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

/**
 * Fetches and transforms deployment environments for an app
 */
export const fetchAndTransformEnvironments = async (
    appId: string,
): Promise<CamelCaseEnvironment[]> => {
    return fetchEnvironments(appId).then((environments) =>
        environments.map(
            (env: Environment): CamelCaseEnvironment => ({
                name: env.name,
                appId: env.app_id,
                deployedAppVariantId: env.deployed_app_variant_id,
                deployedVariantName: env.deployed_variant_name,
                deployedAppVariantRevisionId: env.deployed_app_variant_revision_id,
                revision: env.revision,
            }),
        ),
    )
}

/**
 * Fetches user profile and revisions data in parallel
 */
export const fetchVariantMetadata = async (
    variantId: string,
    projectId: string,
    modifiedById: string,
) => {
    return Promise.all([fetchRevisions(variantId, projectId), fetchSingleProfile(modifiedById)])
}
