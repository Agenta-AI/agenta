/**
 * Skill registry schemas.
 *
 * The skill CONTENT shape mirrors the SDK's `SkillTemplate`
 * (sdks/python/agenta/sdk/agents/skills/models.py) in its STORAGE form: snake_case
 * `model_dump`, which is what `data.parameters.skill` holds on a skill workflow revision.
 * (The camelCase `to_wire()` shape exists only on the runner wire — never here.)
 *
 * The registry/list shapes mirror the dedicated skills API
 * (api/oss/src/apis/fastapi/skills/models.py).
 */
import {z} from "zod"

// ---------------------------------------------------------------------------
// Skill content (storage shape, mirrors SkillTemplate limits)
// ---------------------------------------------------------------------------

export const SKILL_NAME_MAX = 64
export const SKILL_DESCRIPTION_MAX = 1024
export const SKILL_BODY_MAX = 50_000
export const SKILL_FILE_CONTENT_MAX = 200_000

/** kebab-case, ≤64 chars — the SDK's `_SKILL_NAME` pattern. */
export const SKILL_NAME_PATTERN = /^[a-z0-9]+(-[a-z0-9]+)*$/

export const skillFileSchema = z.object({
    path: z.string().min(1).max(255),
    content: z.string().max(SKILL_FILE_CONTENT_MAX),
    executable: z.boolean().optional(),
})
export type SkillFile = z.infer<typeof skillFileSchema>

export const skillContentSchema = z.object({
    name: z.string().min(1).max(SKILL_NAME_MAX).regex(SKILL_NAME_PATTERN),
    description: z.string().min(1).max(SKILL_DESCRIPTION_MAX),
    body: z.string().min(1).max(SKILL_BODY_MAX),
    files: z.array(skillFileSchema).optional(),
    disable_model_invocation: z.boolean().optional(),
    allow_executable_files: z.boolean().optional(),
})
export type SkillContent = z.infer<typeof skillContentSchema>

// ---------------------------------------------------------------------------
// Registry list (mirrors SkillsResponse / SkillRegistryItem)
// ---------------------------------------------------------------------------

/** Cursor pagination block; kept lenient — the FE only passes `next` back. */
export const skillsWindowingSchema = z
    .object({
        newest: z.string().optional().nullable(),
        oldest: z.string().optional().nullable(),
        next: z.string().optional().nullable(),
        limit: z.number().optional().nullable(),
        order: z.string().optional().nullable(),
    })
    .passthrough()
export type SkillsWindowing = z.infer<typeof skillsWindowingSchema>

export const skillRegistryItemSchema = z
    .object({
        /** Head revision id doubling as the pagination cursor id. */
        id: z.string().optional().nullable(),
        workflow_id: z.string().optional().nullable(),
        workflow_slug: z.string().optional().nullable(),
        name: z.string().optional().nullable(),
        description: z.string().optional().nullable(),
        head_revision_id: z.string().optional().nullable(),
        version: z.string().optional().nullable(),
        message: z.string().optional().nullable(),
        created_at: z.string().optional().nullable(),
        updated_at: z.string().optional().nullable(),
        is_static: z.boolean().optional().nullable(),
        skill_name: z.string().optional().nullable(),
        skill_description: z.string().optional().nullable(),
        files_count: z.number().optional().nullable(),
    })
    .passthrough()
export type SkillRegistryItem = z.infer<typeof skillRegistryItemSchema>

export const skillsQueryResponseSchema = z
    .object({
        count: z.number().optional(),
        skills: z.array(skillRegistryItemSchema).optional(),
        /** Code-defined Agenta built-ins: a separate, unpaginated block. */
        builtin: z.array(skillRegistryItemSchema).optional(),
        windowing: skillsWindowingSchema.optional().nullable(),
    })
    .passthrough()
export type SkillsQueryResponse = z.infer<typeof skillsQueryResponseSchema>

// ---------------------------------------------------------------------------
// Usage (mirrors SkillUsageResponse / SkillUsageItem)
// ---------------------------------------------------------------------------

export const skillUsageItemSchema = z
    .object({
        agent_workflow_id: z.string().optional().nullable(),
        agent_slug: z.string().optional().nullable(),
        agent_name: z.string().optional().nullable(),
        /** "latest" = artifact-level embed follows the head; "pinned" = revision-level. */
        mode: z.enum(["latest", "pinned"]).optional(),
        pinned_version: z.string().optional().nullable(),
    })
    .passthrough()
export type SkillUsageItem = z.infer<typeof skillUsageItemSchema>

export const skillUsageResponseSchema = z
    .object({
        count: z.number().optional(),
        usage: z.array(skillUsageItemSchema).optional(),
    })
    .passthrough()
export type SkillUsageResponse = z.infer<typeof skillUsageResponseSchema>
