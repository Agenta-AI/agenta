/**
 * Skills API — the dedicated `/skills/*` endpoints (WP-A2/A3), through the Fern-generated
 * client (`getSkillsClient()`). Zod validation stays at the boundary: Fern's compile-time
 * types under-declare backend extra="allow" fields, so the local schemas remain the
 * independent drift check. Workflow-level writes (create/commit/roster) still ride the
 * entities layer, whose own Fern migration is tracked separately.
 */
import {safeParseWithLogging} from "@agenta/entities/shared"
import {retrieveWorkflowRevision} from "@agenta/entities/workflow"
import {getSkillsClient, getWorkflowsClient} from "@agenta/sdk/resources"
import {generateId} from "@agenta/shared/utils"

import {
    skillsQueryResponseSchema,
    skillSourceImportResponseSchema,
    skillSourceScanResponseSchema,
    skillReferencedByResponseSchema,
    updateApplyResponseSchema,
    updateCheckResponseSchema,
    type SkillsQueryResponse,
    type SkillSourceImportResponse,
    type SkillSourceScanResponse,
    type SkillReferencedByResponse,
    type SkillsWindowing,
    type UpdateApplyResponse,
    type UpdateCheckResponse,
} from "../core/schema"

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
        safeParseWithLogging(skillsQueryResponseSchema, data, "[querySkills]") ?? {
            count: 0,
            skills: [],
            builtin: [],
        }
    )
}

export interface QuerySkillReferencedByParams {
    projectId: string
    workflowId?: string
    workflowSlug?: string
}

/** `GET /skills/{id}/referenced-by` — the agents referencing this skill, latest vs pinned. */
export async function querySkillReferencedBy({
    projectId,
    workflowId,
}: QuerySkillReferencedByParams): Promise<SkillReferencedByResponse> {
    if (!projectId || !workflowId) {
        return {count: 0, referenced_by: []}
    }

    const data = await getSkillsClient().listSkillReferencedBy(
        {skill_id: workflowId},
        {queryParams: {project_id: projectId}},
    )

    const parsed = safeParseWithLogging(
        skillReferencedByResponseSchema,
        data,
        "[querySkillReferencedBy]",
    )
    return parsed ?? {count: 0, referenced_by: []}
}

/** Mirrors AGENTA_BUILTIN_SKILL_URI (sdk engines/running/utils.py) — the skill workflow URI. */
export const AGENTA_BUILTIN_SKILL_URI = "agenta:builtin:skill:v0"

export interface CreateSkillWorkflowParams {
    projectId: string
    /** Validated skill content (skillContentSchema) — becomes `data.parameters.skill`. */
    skill: Record<string, unknown> & {name: string; description: string}
}

/** Creates a registry skill through the /skills facade — the server owns validation,
 * the suffixed slug, and the flag/URI stamping. */
export interface CreatedSkillWorkflow {
    /** The generated (suffixed) workflow slug — what embeds must reference. */
    slug: string
    workflowId?: string
}

export async function createSkillWorkflow({
    projectId,
    skill,
}: CreateSkillWorkflowParams): Promise<CreatedSkillWorkflow> {
    const data = (await getSkillsClient().createSkill(
        {skill},
        {queryParams: {project_id: projectId}},
    )) as Record<string, unknown>
    return {
        slug: typeof data?.slug === "string" ? data.slug : skill.name,
        workflowId: typeof data?.workflow_id === "string" ? data.workflow_id : undefined,
    }
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
        {source_url: repoUrl, ...(ref ? {ref} : {})},
        {queryParams: {project_id: projectId}},
    )

    return safeParseWithLogging(skillSourceScanResponseSchema, data, "[scanSkillSource]")
}

export interface ImportSkillSourceParams {
    projectId: string
    repoUrl: string
    ref?: string
    /** `path_in_repo` values from a prior scan; omitted = every valid candidate. */
    paths?: string[]
}

/** `POST /skills/sources` — import the selected candidates as skill workflows. Throws on HTTP errors. */
export async function importSkillSource({
    projectId,
    repoUrl,
    ref,
    paths,
}: ImportSkillSourceParams): Promise<SkillSourceImportResponse | null> {
    if (!projectId || !repoUrl) return null

    const data = await getSkillsClient().importSkillSource(
        {
            source_url: repoUrl,
            ...(ref ? {ref} : {}),
            ...(paths ? {paths} : {}),
        },
        {queryParams: {project_id: projectId}},
    )

    return safeParseWithLogging(skillSourceImportResponseSchema, data, "[importSkillSource]")
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
    const data = (await getSkillsClient().logSkillRevisions(
        {skill_id: workflowId},
        {queryParams: {project_id: projectId}},
    )) as {revisions?: Record<string, unknown>[]}
    // Filtering (no v0) and ordering are server-side; this only maps field names.
    return (data.revisions ?? [])
        .map(
            (rev): SkillRevision => ({
                id: String(rev.id ?? ""),
                version: rev.version != null ? String(rev.version).replace(/^v/, "") : undefined,
                message: typeof rev.message === "string" ? rev.message : undefined,
                createdAt: typeof rev.created_at === "string" ? rev.created_at : undefined,
                variantId:
                    typeof rev.workflow_variant_id === "string"
                        ? rev.workflow_variant_id
                        : undefined,
                skill:
                    rev.skill && typeof rev.skill === "object" && !Array.isArray(rev.skill)
                        ? (rev.skill as Record<string, unknown>)
                        : undefined,
            }),
        )
        .filter((rev) => rev.id)
}

export interface CommitSkillRevisionParams {
    projectId: string
    workflowId: string
    /** The skill content — server-validated against the SkillTemplate contract. */
    skill: Record<string, unknown>
    message?: string
    /** Optimistic concurrency: a moved head answers revision_conflict, never a clobber. */
    baseRevisionId?: string
}

/** Commits a new revision through the /skills facade; the server stamps flags + URI. */
export async function commitSkillRevision({
    projectId,
    workflowId,
    skill,
    message,
    baseRevisionId,
}: CommitSkillRevisionParams) {
    return getSkillsClient().commitSkillRevision(
        {
            skill_id: workflowId,
            skill,
            message: message || undefined,
            base_revision_id: baseRevisionId || undefined,
        },
        {queryParams: {project_id: projectId}},
    )
}

/** The workflow slug an embed entry references (either ref level), for dedup checks. */
function embedEntrySlug(item: unknown): string | null {
    if (!item || typeof item !== "object") return null
    const embed = (item as Record<string, unknown>)["@ag.embed"]
    if (!embed || typeof embed !== "object") return null
    const refs = (embed as Record<string, unknown>)["@ag.references"]
    if (!refs || typeof refs !== "object") return null
    for (const key of ["workflow", "workflow_revision"]) {
        const ref = (refs as Record<string, unknown>)[key]
        if (ref && typeof ref === "object") {
            const slug = (ref as Record<string, unknown>).slug
            if (typeof slug === "string" && slug) return slug
        }
    }
    return null
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

            // Idempotent per agent: an already-embedded slug is a success, not a
            // duplicate entry the runner would silently drop.
            const entrySlug = embedEntrySlug(entry)
            if (entrySlug && skills.some((item) => embedEntrySlug(item) === entrySlug)) {
                result.added.push(workflowId)
                continue
            }

            const nextData = {
                ...data,
                parameters: {
                    ...parameters,
                    agent: {...agent, skills: [...skills, entry]},
                },
            }

            await getWorkflowsClient().commitWorkflowRevision(
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
                    } as never,
                },
                {queryParams: {project_id: projectId}},
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
    return getSkillsClient().archiveSkill(
        {skill_id: workflowId},
        {queryParams: {project_id: projectId}},
    )
}

export async function unarchiveSkill({
    projectId,
    workflowId,
}: {
    projectId: string
    workflowId: string
}) {
    return getSkillsClient().unarchiveSkill(
        {skill_id: workflowId},
        {queryParams: {project_id: projectId}},
    )
}

/** Read-only: compare one imported skill against its upstream origin. */
export async function checkSkillUpdate({
    projectId,
    workflowId,
}: {
    projectId: string
    workflowId: string
}): Promise<UpdateCheckResponse | null> {
    if (!projectId || !workflowId) return null
    const data = await getSkillsClient().checkSkillUpdate(
        {skill_id: workflowId},
        {queryParams: {project_id: projectId}},
    )
    return updateCheckResponseSchema.safeParse(data).data ?? null
}

/** Commit the upstream version of one imported skill as a new revision. */
export async function applySkillUpdate({
    projectId,
    workflowId,
}: {
    projectId: string
    workflowId: string
}): Promise<UpdateApplyResponse | null> {
    if (!projectId || !workflowId) return null
    const data = await getSkillsClient().applySkillUpdate(
        {skill_id: workflowId},
        {queryParams: {project_id: projectId}},
    )
    return updateApplyResponseSchema.safeParse(data).data ?? null
}
