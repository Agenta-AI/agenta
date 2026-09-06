/**
 * Skills API — the dedicated `/skills/*` endpoints (WP-A2/A3).
 *
 * Raw axios in the entities style: the generated Fern client cannot send a flags body to
 * `workflows/query`, and the `/skills/*` resources are not in the generated client yet.
 * These functions keep the signatures a future Fern-backed swap must preserve.
 */
import {createWorkflow} from "@agenta/entities/workflow"
import {getAgentaApiUrl, axios} from "@agenta/shared/api"
import type {z} from "zod"

import {
    skillsQueryResponseSchema,
    skillSourceImportResponseSchema,
    skillSourceScanResponseSchema,
    skillUsageResponseSchema,
    type SkillsQueryResponse,
    type SkillSourceImportResponse,
    type SkillSourceScanResponse,
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

/** Mirrors AGENTA_BUILTIN_SKILL_URI (sdk engines/running/utils.py) — the skill workflow URI. */
export const AGENTA_BUILTIN_SKILL_URI = "agenta:builtin:skill:v0"

export interface CreateSkillWorkflowParams {
    projectId: string
    /** Validated skill content (skillContentSchema) — becomes `data.parameters.skill`. */
    skill: Record<string, unknown> & {name: string; description: string}
}

/**
 * Creates a registry skill: a workflow with `is_skill`+`is_snippet` stamped on BOTH the
 * artifact and the v1 revision — the registry query filters on the REVISION flag, so a
 * commit without it is invisible to /skills/query. Mirrors the server import path
 * (import_service.py SimpleWorkflowCreate). Throws on HTTP errors (409 = slug taken).
 */
export async function createSkillWorkflow({projectId, skill}: CreateSkillWorkflowParams) {
    const flags = {is_skill: true, is_snippet: true}
    return createWorkflow(projectId, {
        slug: skill.name,
        name: skill.name,
        description: skill.description,
        flags,
        data: {uri: AGENTA_BUILTIN_SKILL_URI, parameters: {skill}},
        revisionFlags: flags,
        message: "Create skill",
    })
}

export interface ScanSkillSourceParams {
    projectId: string
    repoUrl: string
    ref?: string
}

/** `POST /skills/sources/scan` — fetch + parse a GitHub repo without importing. Throws on HTTP errors. */
export async function scanSkillSource({
    projectId,
    repoUrl,
    ref,
}: ScanSkillSourceParams): Promise<SkillSourceScanResponse | null> {
    if (!projectId || !repoUrl) return null

    const response = await axios.post(
        `${getAgentaApiUrl()}/skills/sources/scan`,
        {repo_url: repoUrl, ...(ref ? {ref} : {})},
        {params: {project_id: projectId}},
    )

    return parseOrWarn(skillSourceScanResponseSchema, response.data, "[scanSkillSource]")
}

export interface ImportSkillSourceParams {
    projectId: string
    repoUrl: string
    ref?: string
    /** `path_in_repo` values from a prior scan; omitted = every valid candidate. */
    paths?: string[]
    syncEnabled?: boolean
}

/** `POST /skills/sources` — import the selected candidates as skill workflows. Throws on HTTP errors. */
export async function importSkillSource({
    projectId,
    repoUrl,
    ref,
    paths,
    syncEnabled,
}: ImportSkillSourceParams): Promise<SkillSourceImportResponse | null> {
    if (!projectId || !repoUrl) return null

    const response = await axios.post(
        `${getAgentaApiUrl()}/skills/sources`,
        {
            repo_url: repoUrl,
            ...(ref ? {ref} : {}),
            ...(paths?.length ? {paths} : {}),
            sync_enabled: Boolean(syncEnabled),
        },
        {params: {project_id: projectId}},
    )

    return parseOrWarn(skillSourceImportResponseSchema, response.data, "[importSkillSource]")
}
