import {refusedSendRejections, SendRefusedError} from "@agenta/chat/model"
import type {SessionSharingState} from "@agenta/entities/sharing"

import {sharingCopy} from "@/lib/sharingCopy"

/** Why the composer gives way to a notice. Null = the reader can send. */
export type SessionReadOnlyReason =
    | "private_agent"
    | "role_view_only"
    | "no_owner"
    | "owner_left"
    | "viewer"
    | "access_unknown"

/**
 * The one rule for a read-only chat. A hidden agent wins (nothing can run it); then the session
 * state the server computed: no `can_send` on an ownerless chat, on a chat whose owner left, and
 * for a Viewer. Unknown sharing (still loading, or the read failed) gives no reason here: see
 * `sessionAccessKnown`, which keeps the controls off until the state is known.
 */
export const sessionReadOnlyReason = ({
    sharing,
    agentHidden,
}: {
    sharing: SessionSharingState | null | undefined
    agentHidden: boolean
}): SessionReadOnlyReason | null => {
    if (agentHidden) return "private_agent"
    if (!sharing || sharing.can_send) return null
    // A channel chat is the project's: only the reader's own role keeps them from sending.
    if (sharing.not_shareable_reason === "channel") return "role_view_only"
    if (!sharing.policy.owner_user_id) return "no_owner"
    if (!sharing.owner_is_active) return "owner_left"
    // The owner who cannot send has lost the agent, not the chat.
    if (sharing.my_role === "owner") return "private_agent"
    return "viewer"
}

/**
 * Whether the chat knows what this reader may do. A session that exists on the server needs a
 * sharing state that loaded and did not fail since: until then nothing on screen may send,
 * approve or answer (the server would refuse a Viewer, but the controls must not pretend). A
 * session minted in this browser (`fresh`) has no sharing row yet and belongs to its creator,
 * so it keeps sending as before.
 */
export const sessionAccessKnown = ({
    fresh,
    loaded,
    failed,
}: {
    fresh: boolean
    /** The sharing state is in hand. */
    loaded: boolean
    /** The last read of it failed (a 404 included). */
    failed: boolean
}): boolean => fresh || (loaded && !failed)

/** The notice text for a reason. `owner` is the owner's display name. */
export const sessionReadOnlyText = (reason: SessionReadOnlyReason, owner: string): string => {
    switch (reason) {
        case "private_agent":
            return sharingCopy.composerPrivateAgent
        case "role_view_only":
            return sharingCopy.composerRoleViewOnly
        case "no_owner":
            return sharingCopy.composerNoOwner
        case "owner_left":
            return sharingCopy.composerOwnerLeft(owner)
        case "viewer":
            return sharingCopy.composerViewer(owner)
        case "access_unknown":
            return sharingCopy.composerAccessUnknown
    }
}

/** What a read-only chat hands its composer slot and its approval dock. */
export interface SessionReadOnly {
    reason: SessionReadOnlyReason
    notice: string
    /** Under a read-only approval card; null when no one is known to be able to answer. */
    approvalNote: string | null
}

/** True for a Fern error whose HTTP status is 404 (hidden and unknown read the same). */
export const isNotFoundError = (error: unknown): boolean =>
    (error as {statusCode?: unknown} | null | undefined)?.statusCode === 404

/**
 * A send the server refused at admission: the sender may still read this chat but may no longer
 * run its agent (the agent went private, or its owner changed). The composer is only on screen
 * for someone the chat let send, so an access refusal here is about the agent.
 */
export const isAgentAccessRefusal = (error: unknown): boolean =>
    error instanceof SendRefusedError &&
    (error.refusalCode === "access_denied" || error.status === 403 || error.status === 404)

/** The composer's rejection row for a send; the sharing case has its own sentence. */
export const sendRefusalRejections = (error: unknown): ReturnType<typeof refusedSendRejections> =>
    isAgentAccessRefusal(error)
        ? [{name: sharingCopy.refusedSubject, reason: sharingCopy.refusedNoAgentAccess}]
        : refusedSendRejections(error)
