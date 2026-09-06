/**
 * Skills API — the dedicated `/skills/*` endpoints (WP-A2/A3), through the Fern-generated
 * client (`getSkillsClient()`). Zod validation stays at the boundary: Fern's compile-time
 * types under-declare backend extra="allow" fields, so the local schemas remain the
 * independent drift check. Workflow-level writes (create/commit/roster) still ride the
 * entities layer, whose own Fern migration is tracked separately.
 */
import {
    archiveWorkflow,
    createWorkflow,
    queryWorkflowRevisionsByWorkflow,
    retrieveWorkflowRevision,
    unarchiveWorkflow,
} from "@agenta/entities/workflow"
import {getSkillsClient} from "@agenta/sdk/resources"
import {getAgentaApiUrl, axios} from "@agenta/shared/api"
import {generateId} from "@agenta/shared/utils"
import type {z} from "zod"

import {
    refreshSourceResponseSchema,
    skillsQueryResponseSchema,
    skillSourceImportResponseSchema,
    skillSourceScanResponseSchema,
    skillUsageResponseSchema,
    type RefreshSourceResponse,
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

    const data = await getSkillsClient().queryRegistrySkills(
        {
            ...(search ? {search} : {}),
            ...(includeArchived !== undefined ? {include_archived: includeArchived} : {}),
            // Fern narrows `order` to an enum the lenient local windowing type doesn't share.
            ...(windowing ? {windowing: windowing as never} : {}),
        },
        {queryParams: {project_id: projectId}},
    )

    return (
        parseOrWarn(skillsQueryResponseSchema, data, "[querySkills]") ?? {
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

    const data = await getSkillsClient().querySkillUsage(
        {
            ...(workflowId ? {workflow_id: workflowId} : {}),
            ...(workflowSlug ? {workflow_slug: workflowSlug} : {}),
        },
        {queryParams: {project_id: projectId}},
    )

    return (
        parseOrWarn(skillUsageResponseSchema, data, "[querySkillUsage]") ?? {
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

    const data = await getSkillsClient().scanSkillSource(
        {repo_url: repoUrl, ...(ref ? {ref} : {})},
        {queryParams: {project_id: projectId}},
    )

    return parseOrWarn(skillSourceScanResponseSchema, data, "[scanSkillSource]")
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

    const data = await getSkillsClient().importSkillSource(
        {
            repo_url: repoUrl,
            ...(ref ? {ref} : {}),
            ...(paths?.length ? {paths} : {}),
            sync_enabled: Boolean(syncEnabled),
        },
        {queryParams: {project_id: projectId}},
    )

    return parseOrWarn(skillSourceImportResponseSchema, data, "[importSkillSource]")
}

/** One row of a skill workflow's revision history, as the detail drawer consumes it. */
export interface SkillRevision {
    id: string
    /** Numeric-ish tag without the "v" prefix, e.g. "3". */
    version?: string
    message?: string
    createdAt?: string
    variantId?: string
    /** The stored `data.parameters.skill` payload (snake_case), when the revision has one. */
    skill?: Record<string, unknown>
}

export interface FetchSkillRevisionsParams {
    projectId: string
    workflowId: string
}

/** A skill workflow's revision log, newest first, with each revision's stored content. */
export async function fetchSkillRevisions({
    projectId,
    workflowId,
}: FetchSkillRevisionsParams): Promise<SkillRevision[]> {
    if (!projectId || !workflowId) return []
    const response = await queryWorkflowRevisionsByWorkflow(workflowId, projectId)
    const revisions = (response.workflow_revisions ?? []) as Record<string, unknown>[]
    return (
        revisions
            .map((rev): SkillRevision => {
                const data = rev.data as Record<string, unknown> | undefined
                const parameters = data?.parameters as Record<string, unknown> | undefined
                const skill = parameters?.skill
                return {
                    id: String(rev.id ?? ""),
                    version:
                        rev.version != null ? String(rev.version).replace(/^v/, "") : undefined,
                    message: typeof rev.message === "string" ? rev.message : undefined,
                    createdAt: typeof rev.created_at === "string" ? rev.created_at : undefined,
                    variantId:
                        typeof rev.workflow_variant_id === "string"
                            ? rev.workflow_variant_id
                            : undefined,
                    skill:
                        skill && typeof skill === "object" && !Array.isArray(skill)
                            ? (skill as Record<string, unknown>)
                            : undefined,
                }
            })
            .filter((rev) => rev.id)
            // v0 is the empty bootstrap revision — history starts at v1.
            .filter((rev) => rev.version !== "0")
            .sort((a, b) => Number(b.version ?? 0) - Number(a.version ?? 0))
    )
}

export interface CommitSkillRevisionParams {
    projectId: string
    workflowId: string
    variantId?: string
    /** Validated skill content (skillContentSchema) — becomes `data.parameters.skill`. */
    skill: Record<string, unknown>
    message?: string
}

/**
 * Commits a new revision on an existing skill workflow, with the skill flags stamped
 * explicitly (the registry query filters on the REVISION flag — same contract as
 * `createSkillWorkflow`). The server infers them from the URI too; explicit is the belt.
 */
export async function commitSkillRevision({
    projectId,
    workflowId,
    variantId,
    skill,
    message,
}: CommitSkillRevisionParams) {
    const response = await axios.post(
        `${getAgentaApiUrl()}/workflows/revisions/commit`,
        {
            workflow_revision: {
                workflow_id: workflowId,
                workflow_variant_id: variantId ?? undefined,
                slug: generateId().replace(/-/g, "").slice(0, 12),
                data: {uri: AGENTA_BUILTIN_SKILL_URI, parameters: {skill}},
                flags: {is_skill: true, is_snippet: true},
                message: message || undefined,
            },
        },
        {params: {project_id: projectId}},
    )
    return response.data
}

export interface AddSkillToAgentsParams {
    projectId: string
    agentWorkflowIds: string[]
    /** A fully-built skill embed entry (buildSkillEmbedEntry output). */
    entry: Record<string, unknown>
    message?: string
}

export interface AddSkillToAgentsResult {
    added: string[]
    failed: {workflowId: string; error: string}[]
}

/**
 * Registry-side batch install (the pick-agents step): for each agent, read the HEAD
 * revision, append the embed entry to `parameters.agent.skills`, and commit — the same
 * whole-revision write the config panel's auto-commit performs, with the head's id as
 * `base_revision_id` so a concurrent edit conflicts instead of being clobbered.
 */
export async function addSkillToAgents({
    projectId,
    agentWorkflowIds,
    entry,
    message,
}: AddSkillToAgentsParams): Promise<AddSkillToAgentsResult> {
    const result: AddSkillToAgentsResult = {added: [], failed: []}

    for (const workflowId of agentWorkflowIds) {
        try {
            const head = (await retrieveWorkflowRevision({
                projectId,
                workflowRef: {id: workflowId},
            })) as Record<string, unknown> | null
            const data = head?.data as Record<string, unknown> | undefined
            if (!head || !data) throw new Error("The agent's head revision could not be read.")

            const parameters =
                data.parameters && typeof data.parameters === "object"
                    ? (data.parameters as Record<string, unknown>)
                    : {}
            const agent =
                parameters.agent && typeof parameters.agent === "object"
                    ? (parameters.agent as Record<string, unknown>)
                    : {}
            const skills = Array.isArray(agent.skills) ? agent.skills : []

            const nextData = {
                ...data,
                parameters: {
                    ...parameters,
                    agent: {...agent, skills: [...skills, entry]},
                },
            }

            await axios.post(
                `${getAgentaApiUrl()}/workflows/revisions/commit`,
                {
                    workflow_revision: {
                        workflow_id: workflowId,
                        workflow_variant_id:
                            typeof head.workflow_variant_id === "string"
                                ? head.workflow_variant_id
                                : undefined,
                        slug: generateId().replace(/-/g, "").slice(0, 12),
                        data: nextData,
                        message: message || undefined,
                        base_revision_id: typeof head.id === "string" ? head.id : undefined,
                    },
                },
                {params: {project_id: projectId}},
            )
            result.added.push(workflowId)
        } catch (err) {
            result.failed.push({
                workflowId,
                error: err instanceof Error && err.message ? err.message : "commit failed",
            })
        }
    }

    return result
}

/** Archive a registry skill (its slug stays reserved; unarchive brings it back). */
export async function archiveSkill({
    projectId,
    workflowId,
}: {
    projectId: string
    workflowId: string
}) {
    return archiveWorkflow(projectId, workflowId)
}

export async function unarchiveSkill({
    projectId,
    workflowId,
}: {
    projectId: string
    workflowId: string
}) {
    return unarchiveWorkflow(projectId, workflowId)
}

/** `POST /skills/sources/{id}/refresh` — re-scan the repo and commit changed skills.
 * Hand-edited skills detach instead of being overwritten. Throws on HTTP errors. */
export async function refreshSkillSource({
    projectId,
    sourceId,
}: {
    projectId: string
    sourceId: string
}): Promise<RefreshSourceResponse | null> {
    if (!projectId || !sourceId) return null
    const data = await getSkillsClient().refreshSkillSource(
        {source_id: sourceId},
        {queryParams: {project_id: projectId}},
    )
    return refreshSourceResponseSchema.safeParse(data).data ?? null
}
