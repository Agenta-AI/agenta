import {getWorkflowsClient} from "@agenta/sdk/resources"
import {axios, getAgentaApiUrl} from "@agenta/shared/api"
import type {AgentaApi} from "@agentaai/api-client"
import {z} from "zod"

import {safeParseWithLogging} from "../../shared"

/** A bundled catalog template. */
export interface InternalAgentTemplateSource {
    kind: "internal"
    key: string
}

/** A template zip the user uploaded into a staging session. */
export interface UploadAgentTemplateSource {
    kind: "upload"
    staging_session_id: string
    attachment_id: string
}

/** The exact package bytes a validation accepted; load refuses a file that changed since. */
export interface AgentTemplateSourcePin {
    version: string
    digest: string
}

/** A template zip in a session's files, for example one the create-template skill wrote. */
export interface SessionFileAgentTemplateSource {
    kind: "session_file"
    session_id: string
    path: string
    pin?: AgentTemplateSourcePin
}

export type AgentTemplateSource =
    | InternalAgentTemplateSource
    | UploadAgentTemplateSource
    | SessionFileAgentTemplateSource

// Hand-written until the Fern client is regenerated with the new source union.
export type AgentTemplateLoadRequest = Omit<AgentaApi.TemplateLoadRequest, "source"> & {
    source: AgentTemplateSource
}
export type AgentTemplateLoadResult = AgentaApi.TemplateLoadResult

export async function loadAgentTemplate(
    request: Omit<AgentTemplateLoadRequest, "project_id">,
    idempotencyKey: string,
    projectId: string,
): Promise<AgentTemplateLoadResult> {
    return getWorkflowsClient().loadAgentTemplate(
        // The generated type still declares the internal source only.
        {...request, project_id: projectId} as unknown as AgentaApi.TemplateLoadRequest,
        {
            headers: {"Idempotency-Key": idempotencyKey},
        },
    )
}

export type AgentTemplateEntry = AgentaApi.AgentTemplateEntry
export type AgentTemplatesQuery = AgentaApi.TemplatesQueryRequest

export async function queryAgentTemplates(
    projectId: string,
    query: AgentTemplatesQuery = {},
): Promise<AgentaApi.TemplatesResponse> {
    // maxRetries 0: the catalog query retries; transport retries on top multiplied into a 40s wait.
    return getWorkflowsClient().queryAgentTemplates(query, {
        queryParams: {project_id: projectId},
        maxRetries: 0,
    })
}

const agentTemplateValidationIssueSchema = z.object({
    code: z.string(),
    path: z.string().nullable(),
    field: z.string().nullable(),
    message: z.string(),
    next_step: z.string().nullable(),
})

const agentTemplateValidationResultSchema = z.object({
    valid: z.boolean(),
    version: z.string().nullable(),
    digest: z.string().nullable(),
    supported_schema_versions: z.array(z.string()),
    issues: z.array(agentTemplateValidationIssueSchema),
})

export type AgentTemplateValidationIssue = z.infer<typeof agentTemplateValidationIssueSchema>
export type AgentTemplateValidationResult = z.infer<typeof agentTemplateValidationResultSchema>

/**
 * `POST /agent-templates/validate`: parse a template source without creating anything.
 * Raw axios only until the Fern client is regenerated with this endpoint.
 */
export async function validateAgentTemplate(
    source: AgentTemplateSource,
    projectId: string,
): Promise<AgentTemplateValidationResult | null> {
    if (!projectId) return null
    const response = await axios.post(
        `${getAgentaApiUrl()}/agent-templates/validate`,
        {source},
        {params: {project_id: projectId}},
    )
    return safeParseWithLogging(
        agentTemplateValidationResultSchema,
        response.data,
        "[validateAgentTemplate]",
    )
}
