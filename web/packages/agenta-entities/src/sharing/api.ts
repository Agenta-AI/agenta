/**
 * Sharing API calls (agent privacy, session sharing, the member picker) through the Fern
 * `sharing` resource client.
 *
 * Every call is project-scoped through the `project_id` query parameter and validated with the
 * boundary schemas in `core/schema.ts`. Errors are not swallowed: a refused write (403, 404,
 * 409) reaches the caller with the API's own message, so the UI can show it.
 */
import {getSharingClient} from "@agenta/sdk/resources"
import type {z} from "zod"

import {safeParseWithLogging} from "../shared/utils/zodSchema"

import {
    agentSharingResponseSchema,
    sessionSharingResponseSchema,
    sharingMembersResponseSchema,
    type AgentSharingResponse,
    type ProjectMemberProfile,
    type SessionRole,
    type SessionSharingResponse,
    type SharingMembersResponse,
    type Visibility,
} from "./core/schema"

interface ProjectScopedParams {
    projectId: string
    abortSignal?: AbortSignal
}

export interface AgentSharingParams extends ProjectScopedParams {
    workflowId: string
}

export interface SessionSharingParams extends ProjectScopedParams {
    sessionId: string
}

export interface SetAgentVisibilityParams extends AgentSharingParams {
    visibility: Visibility
}

export interface TransferAgentParams extends AgentSharingParams {
    /** The new owner: an active human member of the project. */
    userId: string
}

export interface UpsertSessionGrantParams extends SessionSharingParams {
    userId: string
    role: SessionRole
}

export interface RevokeSessionGrantParams extends SessionSharingParams {
    userId: string
}

export interface SetSessionVisibilityParams extends SessionSharingParams {
    visibility: Visibility
}

export interface QuerySharingMembersParams extends ProjectScopedParams {
    /** Case-insensitive prefix of the member's email or name. */
    search?: string
    /** Page size. The server uses 50 when omitted. */
    limit?: number
    /** The cursor of the previous page (`windowing.next`). */
    next?: string
}

function scopedRequest({projectId, abortSignal}: ProjectScopedParams) {
    return {queryParams: {project_id: projectId}, abortSignal}
}

function parseOrThrow<T>(schema: z.ZodType<T>, data: unknown, label: string): T {
    const parsed = safeParseWithLogging(schema, data, label)
    if (parsed === null) throw new Error(`${label} returned an unexpected response`)
    return parsed
}

// -- agents ----------------------------------------------------------------------------------

/** `GET /workflows/{workflow_id}/sharing` */
export async function fetchAgentSharing(params: AgentSharingParams): Promise<AgentSharingResponse> {
    const data = await getSharingClient().fetchAgentSharing(
        {workflow_id: params.workflowId},
        scopedRequest(params),
    )
    return parseOrThrow(agentSharingResponseSchema, data, "[fetchAgentSharing]")
}

/** `POST /workflows/{workflow_id}/sharing/visibility` (owner only) */
export async function setAgentVisibility(
    params: SetAgentVisibilityParams,
): Promise<AgentSharingResponse> {
    const data = await getSharingClient().setAgentVisibility(
        {workflow_id: params.workflowId, visibility: params.visibility},
        scopedRequest(params),
    )
    return parseOrThrow(agentSharingResponseSchema, data, "[setAgentVisibility]")
}

/** `POST /workflows/{workflow_id}/sharing/transfer` (owner only) */
export async function transferAgent(params: TransferAgentParams): Promise<AgentSharingResponse> {
    const data = await getSharingClient().transferAgent(
        {workflow_id: params.workflowId, user_id: params.userId},
        scopedRequest(params),
    )
    return parseOrThrow(agentSharingResponseSchema, data, "[transferAgent]")
}

/** `POST /workflows/{workflow_id}/sharing/take-ownership` (admin, when the owner left) */
export async function takeAgentOwnership(
    params: AgentSharingParams,
): Promise<AgentSharingResponse> {
    const data = await getSharingClient().takeAgentOwnership(
        {workflow_id: params.workflowId},
        scopedRequest(params),
    )
    return parseOrThrow(agentSharingResponseSchema, data, "[takeAgentOwnership]")
}

// -- sessions --------------------------------------------------------------------------------

/** `GET /sessions/{session_id}/sharing` */
export async function fetchSessionSharing(
    params: SessionSharingParams,
): Promise<SessionSharingResponse> {
    const data = await getSharingClient().fetchSessionSharing(
        {session_id: params.sessionId},
        scopedRequest(params),
    )
    return parseOrThrow(sessionSharingResponseSchema, data, "[fetchSessionSharing]")
}

/** `POST /sessions/{session_id}/sharing/grants`: add a grant or change its role. */
export async function upsertSessionGrant(
    params: UpsertSessionGrantParams,
): Promise<SessionSharingResponse> {
    const data = await getSharingClient().upsertSessionGrant(
        {session_id: params.sessionId, user_id: params.userId, role: params.role},
        scopedRequest(params),
    )
    return parseOrThrow(sessionSharingResponseSchema, data, "[upsertSessionGrant]")
}

/** `DELETE /sessions/{session_id}/sharing/grants/{user_id}` */
export async function revokeSessionGrant(
    params: RevokeSessionGrantParams,
): Promise<SessionSharingResponse> {
    const data = await getSharingClient().revokeSessionGrant(
        {session_id: params.sessionId, user_id: params.userId},
        scopedRequest(params),
    )
    return parseOrThrow(sessionSharingResponseSchema, data, "[revokeSessionGrant]")
}

/** `POST /sessions/{session_id}/sharing/visibility` */
export async function setSessionVisibility(
    params: SetSessionVisibilityParams,
): Promise<SessionSharingResponse> {
    const data = await getSharingClient().setSessionVisibility(
        {session_id: params.sessionId, visibility: params.visibility},
        scopedRequest(params),
    )
    return parseOrThrow(sessionSharingResponseSchema, data, "[setSessionVisibility]")
}

/** `POST /sessions/{session_id}/sharing/only-me`: private, and every grant removed. */
export async function restrictSessionToOwner(
    params: SessionSharingParams,
): Promise<SessionSharingResponse> {
    const data = await getSharingClient().restrictSessionToOwner(
        {session_id: params.sessionId},
        scopedRequest(params),
    )
    return parseOrThrow(sessionSharingResponseSchema, data, "[restrictSessionToOwner]")
}

// -- members ---------------------------------------------------------------------------------

/** `POST /sharing/members/query`: the people the share picker lists. */
export async function querySharingMembers(
    params: QuerySharingMembersParams,
): Promise<SharingMembersResponse> {
    const windowing: {limit?: number; next?: string} = {}
    if (params.limit !== undefined) windowing.limit = params.limit
    if (params.next !== undefined) windowing.next = params.next

    const body: {search?: string; windowing?: typeof windowing} = {}
    if (params.search) body.search = params.search
    if (Object.keys(windowing).length > 0) body.windowing = windowing

    const data = await getSharingClient().querySharingMembers({body}, scopedRequest(params))
    return parseOrThrow(sharingMembersResponseSchema, data, "[querySharingMembers]")
}

/** Members per page when a caller reads the whole roster (the server sets no maximum). */
export const MEMBER_ROSTER_PAGE_SIZE = 500
/** Bounds a roster read: 20 pages of 500 is far past any real project. */
export const MEMBER_ROSTER_MAX_PAGES = 20

/**
 * Every member of the project, following `windowing.next` page by page. Fails rather than
 * resolve short: a truncated roster would call a current member a former one.
 */
export async function fetchSharingMemberRoster(
    params: ProjectScopedParams,
): Promise<ProjectMemberProfile[]> {
    const members: ProjectMemberProfile[] = []
    let next: string | undefined
    for (let page = 0; page < MEMBER_ROSTER_MAX_PAGES; page++) {
        const response = await querySharingMembers({
            ...params,
            limit: MEMBER_ROSTER_PAGE_SIZE,
            next,
        })
        members.push(...response.members)
        next = response.windowing?.next ?? undefined
        if (!next) return members
    }
    throw new Error(`[fetchSharingMemberRoster] more than ${MEMBER_ROSTER_MAX_PAGES} pages`)
}
