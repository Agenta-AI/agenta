/**
 * Agent requirements: the items an agent names that need setup where it runs.
 *
 * Endpoint: `POST /workflows/revisions/requirements/query`. Read-only on the server.
 */
import {getWorkflowsClient} from "@agenta/sdk/resources"

import {safeParseWithLogging} from "../../shared"
import {agentRequirementsSchema, type AgentRequirementsResult} from "../requirements"

export async function queryAgentRequirements({
    projectId,
    revisionId,
}: {
    projectId: string
    revisionId: string
}): Promise<AgentRequirementsResult | null> {
    if (!projectId || !revisionId) return null
    const data = await getWorkflowsClient().queryWorkflowRevisionRequirements(
        {workflow_revision_ref: {id: revisionId}},
        {queryParams: {project_id: projectId}},
    )
    return safeParseWithLogging(agentRequirementsSchema, data, "[queryAgentRequirements]") ?? null
}
