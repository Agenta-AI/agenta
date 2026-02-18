import {metadataAtom, type ConfigMetadata} from "@agenta/entities/legacyAppRevision"
import {atom, getDefaultStore} from "jotai"
import {queryClientAtom} from "jotai-tanstack-query"

import axios from "@/oss/lib/api/assets/axiosConfig"
import {fetchJson} from "@/oss/lib/api/assets/fetchClient"
import {getAgentaApiUrl} from "@/oss/lib/helpers/api"
import {LlmProvider} from "@/oss/lib/helpers/llmProviders"
import {fetchOpenApiSchemaJson, findCustomWorkflowPath} from "@/oss/lib/shared/variant"
import {detectChatVariantFromOpenAISchema} from "@/oss/lib/shared/variant/genericTransformer"
import {extractVariables} from "@/oss/lib/shared/variant/inputHelpers"
import {
    deriveCustomPropertiesFromSpec,
    derivePromptsFromSpec,
} from "@/oss/lib/shared/variant/transformer/transformer"
import {transformToRequestBody} from "@/oss/lib/shared/variant/transformer/transformToRequestBody"
import {recentAppIdAtom} from "@/oss/state/app"
// removed unused transformedPromptsAtomFamily
import {getOrgValues} from "@/oss/state/org"
import {getProjectValues} from "@/oss/state/project"
import {writePlaygroundSelectionToQuery} from "@/oss/state/url/playground"

import {revisionListAtom} from "./variants"

/**
 * App Creation Mutation Atoms
 * Handles app creation with automatic revision bumping and playground integration
 */

export enum ServiceType {
    Completion = "SERVICE:completion",
    Chat = "SERVICE:chat",
    Custom = "CUSTOM",
}

export interface CreateAppParams {
    appName: string
    templateKey: ServiceType
    serviceUrl?: string
    providerKey: LlmProvider[]
    folderId?: string | null
    isCustomWorkflow?: boolean
    onStatusChange?: (
        status:
            | "creating_app"
            | "starting_app"
            | "success"
            | "bad_request"
            | "timeout"
            | "error"
            | "permission_denied",
        details?: any,
        appId?: string,
    ) => void
}

export interface AppCreationResult {
    success: boolean
    appId?: string
    variantId?: string
    error?: string
    message?: string
}

// Helper function to create app
// Use axios so that global interceptors handle errors like 403
const createApp = async ({
    templateKey,
    appName,
    folderId,
}: {
    appName: string
    templateKey: ServiceType
    folderId?: string | null
}) => {
    const {selectedOrg} = getOrgValues()
    const {project, projectId} = getProjectValues()
    // Prefer selectedOrg, fallback to current project's org/workspace when available
    const organization_id = (selectedOrg as any)?.id || (project as any)?.organization_id || null
    const workspace_id =
        (selectedOrg as any)?.default_workspace?.id || (project as any)?.workspace_id || null
    const url = new URL(`${getAgentaApiUrl()}/apps?project_id=${projectId}`)

    const basePayload: Record<string, any> = {
        app_name: appName,
        template_key: templateKey,
    }

    if (folderId !== undefined) {
        basePayload.folder_id = folderId
    }

    const response = await fetchJson(url, {
        method: "POST",
        body: JSON.stringify(
            organization_id && workspace_id
                ? {
                      ...basePayload,
                      organization_id,
                      workspace_id,
                  }
                : basePayload,
        ),
    })

    return response
}

// Helper function to create variant
const createVariant = async ({
    appId,
    variantName = "default",
    baseName = "app",
    templateKey,
    serviceUrl,
    isCustomWorkflow = false,
}: {
    appId: string
    variantName?: string
    baseName?: string
    templateKey?: ServiceType
    serviceUrl?: string
    isCustomWorkflow?: boolean
}) => {
    interface CreateVariantRequestBody {
        config_name: string
        variant_name: string
        base_name: string
        key?: ServiceType
        url?: string
    }

    // Check for correct usage of serviceUrl and templateKey
    if (serviceUrl && templateKey) {
        throw new Error("Either serviceUrl or templateKey should be provided")
    } else if (!serviceUrl && !templateKey) {
        throw new Error("Either serviceUrl or templateKey should be provided")
    }

    const {projectId} = getProjectValues()

    const endpoint = new URL(
        `${getAgentaApiUrl()}/apps/${appId}/variant/${
            serviceUrl ? "from-service" : "from-template"
        }?project_id=${projectId}`,
    )

    const body: CreateVariantRequestBody = {
        variant_name: variantName,
        base_name: baseName,
        config_name: variantName,
    }

    if (isCustomWorkflow) {
        body.config_name = variantName
        body.url = serviceUrl
    } else if (serviceUrl) {
        body.url = serviceUrl
    } else if (templateKey) {
        body.key = templateKey
    }

    const response = await axios.post(endpoint.toString(), body)

    return response.data
}

// Main app creation mutation atom
// The atom system handles all the complex logic:
// - App creation
// - Variant creation
// - Revision bumping (creates revision 1, hides revision 0)
// - Schema processing
// - Parameter updates
// - Query invalidation
// - Playground state integration
// - Automatic variant selection
export const createAppMutationAtom = atom(
    null,
    async (get, set, params: CreateAppParams): Promise<AppCreationResult> => {
        const {projectId} = getProjectValues()

        // Helper: wait until a revision for the given parent variant appears via store subscription
        const waitForRevision = (parentVariantId: string): Promise<string | undefined> => {
            const store = getDefaultStore()
            return new Promise((resolve) => {
                let unsub: () => void = () => {}

                const check = () => {
                    try {
                        const revs = store.get(revisionListAtom) as any[]
                        const match = (revs || []).find((r: any) => r.variantId === parentVariantId)
                        if (match && match.id) {
                            unsub()
                            resolve(match.id as string)
                        }
                    } catch {
                        // ignore, will retry on next subscription tick
                    }
                }

                unsub = store.sub(revisionListAtom, check)
                // Run once in case data is already present
                check()
            })
        }

        const waitForMetadata = (
            parentVariantId: string,
        ): Promise<Record<string, ConfigMetadata>> => {
            const store = getDefaultStore()
            return new Promise((resolve) => {
                let unsub: () => void = () => {}

                const check = () => {
                    try {
                        const metadata = store.get(metadataAtom)

                        if (Object.keys(metadata)?.length > 0) {
                            unsub()
                            resolve(metadata)
                        }
                    } catch {
                        // ignore, will retry on next subscription tick
                    }
                }

                unsub = store.sub(metadataAtom, check)
                // Run once in case data is already present
                check()
            })
        }

        const {
            appName,
            templateKey,
            serviceUrl,
            providerKey: _providerKey, // retained if needed elsewhere
            folderId,
            isCustomWorkflow = false,
            onStatusChange,
        } = params

        const queryClient = get(queryClientAtom)

        try {
            onStatusChange?.("creating_app")

            // Step 1: Create the app
            const app = await createApp({
                appName,
                templateKey,
                folderId,
            })

            await Promise.all([
                queryClient.invalidateQueries({queryKey: ["apps"]}),
                queryClient.invalidateQueries({
                    queryKey: ["oss-apps-for-selection"],
                    exact: false,
                }),
            ])
            set(recentAppIdAtom, app.app_id)

            // Step 2: Create the variant
            const variant = await (async () => {
                if (templateKey === ServiceType.Custom && serviceUrl) {
                    return createVariant({
                        appId: app.app_id,
                        serviceUrl,
                        isCustomWorkflow,
                    })
                }
                return createVariant({
                    appId: app.app_id,
                    templateKey,
                })
            })()

            // Step 3: Resolve workflow path and schema
            const uri = await findCustomWorkflowPath(variant.uri)
            if (!uri) {
                throw new Error("No URI found for variant")
            }

            const {schema} = await fetchOpenApiSchemaJson(uri.runtimePrefix)
            if (!schema) {
                throw new Error("No schema found")
            }

            // Step 4: Derive prompts from OpenAPI schema and route (no transformVariant side-effects)
            // Resolve routePath from runtimePrefix and variant.uri (similar to prompts family logic)
            let routePath = uri?.routePath
            const runtimePrefix = uri?.runtimePrefix
            const variantUri = (variant as any)?.uri as string | undefined
            if (!routePath && runtimePrefix && variantUri && variantUri.startsWith(runtimePrefix)) {
                const remainder = variantUri.slice(runtimePrefix.length)
                // Preserve empty string as a valid root path (do NOT coerce to undefined)
                routePath = remainder.replace(/^\//, "")
            }

            const prompts = derivePromptsFromSpec(variant as any, schema as any, routePath)

            // Also derive non-prompt custom properties to seed parameters correctly
            const customProperties = deriveCustomPropertiesFromSpec(
                variant as any,
                schema as any,
                routePath,
            )

            const metadata = await waitForMetadata(variant.id)
            if (!metadata) {
                throw new Error("No metadata found for variant")
            }

            // Compute variables referenced in messages (string or array parts)
            const variables = (() => {
                const vars = new Set<string>()
                // 1) From prompt messages
                ;(prompts || []).forEach((prompt: any) => {
                    const messages = prompt?.messages?.value || []
                    messages.forEach((message: any) => {
                        const content = message?.content?.value
                        if (typeof content === "string") {
                            extractVariables(content).forEach((v) => vars.add(v))
                        } else if (Array.isArray(content)) {
                            content.forEach((part: any) => {
                                const text = part?.text?.value ?? part?.text ?? ""
                                if (typeof text === "string") {
                                    extractVariables(text).forEach((v) => vars.add(v))
                                }
                            })
                        }
                    })
                })
                // 2) Fallback: From custom properties (e.g., string prompts in custom workflows)
                Object.entries(customProperties || {}).forEach(([key, value]) => {
                    try {
                        const v = (value as any)?.value
                        if (typeof v === "string") {
                            extractVariables(v).forEach((vv) => vars.add(vv))
                        }
                    } catch {
                        // best-effort
                    }
                })
                return Array.from(vars)
            })()

            // Step 5: Prepare parameters for revision bump from prompts + custom properties
            const detectedChat = detectChatVariantFromOpenAISchema(schema as any, {
                runtimePrefix,
                routePath: routePath || "",
            })
            const isChat = detectedChat
            // Explicitly mark custom to avoid adding non-existent input_keys for custom workflows
            const isCustomFinal =
                app?.app_type === "custom" ||
                templateKey === ServiceType.Custom ||
                !!isCustomWorkflow

            const parameters = transformToRequestBody({
                prompts,
                allMetadata: metadata,
                customProperties,
                isChat,
                isCustom: isCustomFinal,
                // Provide schema context so input key handling is accurate
                spec: schema as any,
                routePath: routePath || "",
                revisionId: (variant as any)?.id,
                appType: app?.app_type,
                variables,
            })

            // Exclude system_prompt and user_prompt keys as per original logic
            if (parameters?.ag_config) {
                for (const key in parameters.ag_config) {
                    const value = parameters.ag_config[key]
                    if (typeof value === "object" && value !== null) {
                        const config = value as Record<string, unknown>
                        delete config.system_prompt
                        delete config.user_prompt
                    }
                }
            }

            // Step 6: Bump revision (this creates revision 1, hiding revision 0)
            // Use the parent variant UUID as required by the API (not the revision id)
            const targetVariantId = variant?.variant_id || variant?.variantId || variant?.id

            if (!targetVariantId) {
                throw new Error(
                    "Missing variant id for parameter update; expected variant_id/variantId on create response",
                )
            }

            await axios.put(`/variants/${targetVariantId}/parameters?project_id=${projectId}`, {
                parameters: parameters.ag_config,
            })

            await queryClient.invalidateQueries({
                queryKey: ["variants", app.app_id, projectId],
            })

            // Also invalidate entity package queries used by playgroundRevisionListAtom
            // These are the queries that the Playground UI depends on for displaying variants/revisions
            await Promise.all([
                queryClient.invalidateQueries({
                    queryKey: ["oss-variants-for-selection", app.app_id, projectId],
                }),
                queryClient.invalidateQueries({
                    queryKey: ["oss-revisions-for-selection"],
                    exact: false,
                }),
            ])

            // Do not block the UI on revision detection
            onStatusChange?.("success", undefined, app.app_id)

            // Fire and forget: wait for the revision and select it if it appears
            void (async () => {
                // Wait for the first revision belonging to the created parent variant
                const parentVariantId =
                    (variant as any)?.variant_id ||
                    (variant as any)?.variantId ||
                    (variant as any)?.id
                const revisionId = parentVariantId
                    ? await waitForRevision(parentVariantId)
                    : undefined
                if (revisionId) {
                    void writePlaygroundSelectionToQuery([revisionId])
                }
            })()

            return {
                success: true,
                appId: app.app_id,
                variantId: variant.id,
                message: `App "${appName}" created successfully with initial revision`,
            }
        } catch (error: any) {
            const status = error?.status ?? error?.response?.status

            if (status === 400 || status === 409 || status === 422) {
                onStatusChange?.("bad_request", error)
                return {
                    success: false,
                    error: error.message || "Bad request during app creation",
                }
            } else if (status === 403) {
                onStatusChange?.("permission_denied", error)
                return {
                    success: false,
                    error: error.message || "Permission denied during app creation",
                }
            }

            // Handle any other errors
            onStatusChange?.("error")
            return {
                success: false,
                error: error.message || "An unexpected error occurred during app creation",
            }
        }
    },
)
