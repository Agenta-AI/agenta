import {getWorkflowsClient} from "@agenta/sdk/resources"
import type {AgentaApi} from "@agentaai/api-client"

export type AgentTemplateLoadRequest = AgentaApi.TemplateLoadRequest
export type AgentTemplateLoadResult = AgentaApi.TemplateLoadResult

export async function loadAgentTemplate(
    request: Omit<AgentTemplateLoadRequest, "project_id">,
    idempotencyKey: string,
    projectId: string,
): Promise<AgentTemplateLoadResult> {
    return getWorkflowsClient().loadAgentTemplate(
        {...request, project_id: projectId},
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
    return getWorkflowsClient().queryAgentTemplates(query, {
        queryParams: {project_id: projectId},
    })
}
