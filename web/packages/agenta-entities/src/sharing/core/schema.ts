/**
 * Zod boundary schemas for the Sharing API (agent privacy, session sharing, member picker).
 *
 * Wire names are snake_case and match the backend DTOs in `api/oss/src/core/sharing/dtos.py`
 * and the router models in `api/oss/src/apis/fastapi/sharing/models.py`. Objects use zod's
 * default strip mode, so fields the backend adds later do not leak into the UI state.
 *
 * The router answers with `response_model_exclude_none`, so every backend `Optional` field is
 * absent (not null) when it has no value: those fields are `nullable().optional()` here.
 */
import {z} from "zod"

export const visibilitySchema = z.enum(["private", "project"])

export const sessionRoleSchema = z.enum(["viewer", "participant"])

/** Computed by the backend, never stored. Agents only use owner, viewer and none. */
export const effectiveRoleSchema = z.enum(["owner", "participant", "viewer", "none"])

/** A private item always has an owner; a project item may be ownerless. */
export const accessPolicySchema = z
    .object({
        visibility: visibilitySchema,
        owner_user_id: z.string().nullable().optional(),
    })
    .refine((policy) => policy.visibility !== "private" || Boolean(policy.owner_user_id), {
        message: "A private policy requires an owner.",
        path: ["owner_user_id"],
    })

export const sessionGrantSchema = z.object({
    stream_id: z.string(),
    user_id: z.string(),
    role: sessionRoleSchema,
    created_at: z.string().nullable().optional(),
    created_by_id: z.string().nullable().optional(),
})

export const disclosedConnectionSchema = z.object({
    provider: z.string(),
    integration: z.string(),
    connection: z.string(),
})

/** The three booleans select fixed UI statements; the backend sends no copy. */
export const shareDisclosureSchema = z.object({
    connections: z.array(disclosedConnectionSchema),
    turns_use_run_credentials: z.boolean(),
    files_and_tool_results_shared: z.boolean(),
    trace_readers_can_read: z.boolean(),
})

/** Why a session cannot be shared: a channel (Slack) chat, an ownerless chat (an API key or
 *  an automation started it), or a chat with no agent reference yet (before its first turn). */
export const notShareableReasonSchema = z.enum(["channel", "ownerless", "no_agent"])

export const agentSharingStateSchema = z.object({
    policy: accessPolicySchema,
    owner_is_active: z.boolean(),
    my_role: effectiveRoleSchema,
    can_take_ownership: z.boolean(),
})

export const sessionSharingStateSchema = z.object({
    policy: accessPolicySchema,
    owner_is_active: z.boolean(),
    /** Returned to the owner only; empty for everyone else. */
    grants: z.array(sessionGrantSchema),
    my_role: effectiveRoleSchema,
    can_send: z.boolean(),
    /** False for channel, ownerless and non-agent sessions. */
    shareable: z.boolean(),
    /** Absent when the session is shareable. */
    not_shareable_reason: notShareableReasonSchema.nullable().optional(),
})

export const agentSharingResponseSchema = z.object({
    count: z.number(),
    sharing: agentSharingStateSchema,
    disclosure: shareDisclosureSchema,
})

export const sessionSharingResponseSchema = z.object({
    count: z.number(),
    sharing: sessionSharingStateSchema,
    /** Absent when the session cannot be shared. */
    disclosure: shareDisclosureSchema.nullable().optional(),
})

export const projectMemberProfileSchema = z.object({
    user_id: z.string(),
    email: z.string(),
    name: z.string().nullable().optional(),
    /** Absent for an EE project member row without a role. */
    role: z.string().nullable().optional(),
    /** Whether the member's role may send in a session ("Can send" works for them). */
    can_run_sessions: z.boolean().nullable().optional(),
})

/** Backend `Windowing` (`sdks/python/agenta/sdk/models/shared.py`); cursor = user_id. */
export const sharingMembersWindowingSchema = z.object({
    newest: z.string().nullable().optional(),
    oldest: z.string().nullable().optional(),
    next: z.string().nullable().optional(),
    limit: z.number().nullable().optional(),
    order: z.enum(["ascending", "descending"]).nullable().optional(),
})

export const sharingMembersResponseSchema = z.object({
    count: z.number(),
    members: z.array(projectMemberProfileSchema),
    windowing: sharingMembersWindowingSchema.nullable().optional(),
})

export type Visibility = z.infer<typeof visibilitySchema>
export type SessionRole = z.infer<typeof sessionRoleSchema>
export type EffectiveRole = z.infer<typeof effectiveRoleSchema>
export type AccessPolicy = z.infer<typeof accessPolicySchema>
export type SessionGrant = z.infer<typeof sessionGrantSchema>
export type DisclosedConnection = z.infer<typeof disclosedConnectionSchema>
export type ShareDisclosure = z.infer<typeof shareDisclosureSchema>
export type NotShareableReason = z.infer<typeof notShareableReasonSchema>
export type AgentSharingState = z.infer<typeof agentSharingStateSchema>
export type SessionSharingState = z.infer<typeof sessionSharingStateSchema>
export type AgentSharingResponse = z.infer<typeof agentSharingResponseSchema>
export type SessionSharingResponse = z.infer<typeof sessionSharingResponseSchema>
export type ProjectMemberProfile = z.infer<typeof projectMemberProfileSchema>
export type SharingMembersResponse = z.infer<typeof sharingMembersResponseSchema>
