/**
 * Skills API — the dedicated `/skills/*` endpoints (WP-A2/A3).
 *
 * Raw axios in the entities style: the generated Fern client cannot send a flags body to
 * `workflows/query`, and the `/skills/*` resources are not in the generated client yet.
 * These functions keep the signatures a future Fern-backed swap must preserve.
 */
import {getAgentaApiUrl, axios} from "@agenta/shared/api"
import type {z} from "zod"

import {
    skillsQueryResponseSchema,
    skillUsageResponseSchema,
    type SkillsQueryResponse,
    type SkillUsageResponse,
    type SkillsWindowing,
} from "../core/schema"

function parseOrWarn<T extends z.ZodType>(
    schema: T,
    data: unknown,
    label: string,
): z.infer<T> | null {
    const result = schema.safeParse(data)
    if (!result.success) {
        console.warn(`${label} response failed validation`, result.error)
        return null
    }
    return result.data
}

export interface QuerySkillsParams {
    projectId: string
    search?: string
    includeArchived?: boolean
    windowing?: SkillsWindowing
}

/** `POST /skills/query` — head-revision registry listing plus the builtin block. */
export async function querySkills({
    projectId,
    search,
    includeArchived,
    windowing,
}: QuerySkillsParams): Promise<SkillsQueryResponse> {
    if (!projectId) {
        return {count: 0, skills: [], builtin: []}
    }

    const response = await axios.post(
        `${getAgentaApiUrl()}/skills/query`,
        {
            ...(search ? {search} : {}),
            ...(includeArchived !== undefined ? {include_archived: includeArchived} : {}),
            ...(windowing ? {windowing} : {}),
        },
        {params: {project_id: projectId}},
    )

    return (
        parseOrWarn(skillsQueryResponseSchema, response.data, "[querySkills]") ?? {
            count: 0,
            skills: [],
            builtin: [],
        }
    )
}

export interface QuerySkillUsageParams {
    projectId: string
    workflowId?: string
    workflowSlug?: string
}

/** `POST /skills/usage` — which agents embed this skill, and latest vs pinned. */
export async function querySkillUsage({
    projectId,
    workflowId,
    workflowSlug,
}: QuerySkillUsageParams): Promise<SkillUsageResponse> {
    if (!projectId || (!workflowId && !workflowSlug)) {
        return {count: 0, usage: []}
    }

    const response = await axios.post(
        `${getAgentaApiUrl()}/skills/usage`,
        {
            ...(workflowId ? {workflow_id: workflowId} : {}),
            ...(workflowSlug ? {workflow_slug: workflowSlug} : {}),
        },
        {params: {project_id: projectId}},
    )

    return (
        parseOrWarn(skillUsageResponseSchema, response.data, "[querySkillUsage]") ?? {
            count: 0,
            usage: [],
        }
    )
}
