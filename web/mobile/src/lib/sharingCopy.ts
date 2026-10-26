/**
 * The app-level strings of chat and agent sharing on /m. Source: the approved M3 UI design copy
 * deck. The sharing components in `@agenta/sessions-ui/sharing` and `@agenta/entity-ui/sharing`
 * carry their own strings; this module holds only what the app screens say around them.
 * Placeholders are functions.
 */
import {sessionSharingCopy} from "@agenta/sessions-ui/sharing"

export const sharingCopy = {
    // The notice that takes the composer's place.
    composerViewer: (owner: string) =>
        `You can view this chat, but you cannot send to it. Ask ${owner} for "Can send" access.`,
    composerPrivateAgent:
        "The agent of this chat is private. You can read the history, but you cannot send.",
    composerNoOwner:
        "An API key or an automation started this chat. You can read it, but you cannot send to it here.",
    composerOwnerLeft: (owner: string) =>
        `${owner} left this project, so no one can send to this chat.`,
    // The sharing state failed to load: the Share dialog's own load-error sentence.
    composerAccessUnknown: sessionSharingCopy.loadError,

    // Stands in for the owner's name while the member list has not named them.
    ownerFallback: "the owner",

    // The top bar of a chat whose agent the reader cannot see.
    privateAgent: "Private agent",

    // A send refused because the sender lost access to the agent. The rejection row prints the
    // subject and the reason as one sentence.
    refusedSubject: "This message",
    refusedNoAgentAccess: "did not run. You no longer have access to the agent of this chat.",

    // The chat was readable and is not any more.
    accessRemovedTitle: "You no longer have access to this chat",
    accessRemovedBody: "The owner changed who can see it.",
    backToSessions: "Back to sessions",
    // The agent overview's not-found screen (added in the M3 gate, QA D6).
    backToAgents: "Back to agents",

    // Hidden and unknown read the same.
    chatNotFound: "This chat does not exist, or you do not have access to it.",
    agentNotFound: "This agent does not exist, or you do not have access to it.",

    // A read-only approval card.
    approvalWaiting: (owner: string) =>
        `Waiting for ${owner} or someone who can send in this chat.`,

    // The session row menu on a phone, for someone who is not the owner.
    rowMenuNotOwner: (owner: string) =>
        `Only ${owner} can rename, share, archive or delete this chat.`,

    // The agent list.
    ownerColumn: "Owner",
    ownerYou: "You",
    ownerNone: "No owner",
    ownerFormer: "Former member",
    // The lock on the reader's own private agent (the privacy panel's line for a private agent).
    agentPrivateMarker: "Only you can see and use it in Agenta.",
} as const

/** The display name of a channel platform, as the agent privacy dialog names it. */
export const channelPlatformLabel: Record<"slack" | "telegram" | "whatsapp", string> = {
    slack: "Slack",
    telegram: "Telegram",
    whatsapp: "WhatsApp",
}
