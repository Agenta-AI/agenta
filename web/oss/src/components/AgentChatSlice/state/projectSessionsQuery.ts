import {
    querySessionsPage,
    type QuerySessionsPageParams,
    type SessionStream,
} from "@agenta/entities/session"
import {sessionListRequestFilters} from "@agenta/sessions/state"

import {sessionListPolicies} from "@/oss/lib/sessionListPolicies"

import type {ServerSessionSummary} from "./sessions"

export interface ProjectSessionsQueryArgs {
    projectId: string
    appId: string
    abortSignal?: AbortSignal
}

export const projectSessionsRequest = ({
    projectId,
    appId,
    abortSignal,
}: ProjectSessionsQueryArgs): QuerySessionsPageParams => {
    const {origins, excludeOrigins, expand} = sessionListRequestFilters(
        sessionListPolicies.internal,
    )
    return {
        projectId,
        session: origins?.length ? {origins} : undefined,
        exclude: excludeOrigins?.length ? {origins: excludeOrigins} : undefined,
        turnReferences: [{id: appId}],
        includeEnded: true,
        includeArchived: true,
        includeTotal: false,
        expand,
        abortSignal,
        lowPriority: true,
    }
}

export const queryProjectSessions = async (
    args: ProjectSessionsQueryArgs,
): Promise<SessionStream[] | null> => {
    const page = await querySessionsPage(projectSessionsRequest(args))
    return page?.sessions ?? null
}

const activity = (session: SessionStream): number => {
    const timestamp = session.updated_at ?? session.created_at
    const milliseconds = timestamp ? Date.parse(timestamp) : NaN
    return Number.isNaN(milliseconds) ? 0 : milliseconds
}

export const projectSessionSummary = (session: SessionStream): ServerSessionSummary => ({
    id: session.session_id,
    title: session.name?.trim() || undefined,
    createdAt: session.created_at ? Date.parse(session.created_at) || undefined : undefined,
    lastMessageAt: activity(session) || undefined,
    ended: Boolean(session.deleted_at),
    archived: Boolean(session.archived_at),
})
