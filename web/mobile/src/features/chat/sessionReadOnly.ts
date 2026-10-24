import {refusedSendRejections, SendRefusedError} from "@agenta/chat/model"
import type {SessionSharingState} from "@agenta/entities/sharing"

import {sharingCopy} from "@/lib/sharingCopy"

/** Why the composer gives way to a notice. Null = the reader can send. */
export type SessionReadOnlyReason =
    | "private_agent"
    | "channel"
    | "no_owner"
    | "owner_left"
    | "viewer"

/**
 * The one rule for a read-only chat. A hidden agent wins (nothing can run it); then the session
 * state the server computed: no `can_send` on an ownerless chat, on a chat whose owner left, and
 * for a Viewer. Unknown sharing (still loading, or the read failed) is not read-only: the server
 * still refuses a send it does not allow, and a notice flashing in front of the owner's own
 * composer is worse.
 *
 * Slack chats are ownerless too: the state's `not_shareable_reason` tells a channel chat
 * (`channel`) from one an API key or an automation started.
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
    if (sharing.not_shareable_reason === "channel") return "channel"
    if (!sharing.policy.owner_user_id) return "no_owner"
    if (!sharing.owner_is_active) return "owner_left"
    // The owner who cannot send has lost the agent, not the chat.
    if (sharing.my_role === "owner") return "private_agent"
    return "viewer"
}

/** The notice text for a reason. `owner` is the owner's display name. */
export const sessionReadOnlyText = (reason: SessionReadOnlyReason, owner: string): string => {
    switch (reason) {
        case "private_agent":
            return sharingCopy.composerPrivateAgent
        case "channel":
            return sharingCopy.composerChannel
        case "no_owner":
            return sharingCopy.composerNoOwner
        case "owner_left":
            return sharingCopy.composerOwnerLeft(owner)
        case "viewer":
            return sharingCopy.composerViewer(owner)
    }
}

/** What a read-only chat hands its composer slot and its approval dock. */
export interface SessionReadOnly {
    reason: SessionReadOnlyReason
    notice: string
    approvalNote: string
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
