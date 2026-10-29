/**
 * Every user-facing string of the chat sharing UI, the member picker and the share disclosure.
 * Source: the approved M3 UI design copy deck. Placeholders are functions.
 */
import type {SessionRole} from "@agenta/entities/sharing"

/** "A", "A and B", "A, B and C". */
export const joinNames = (names: readonly string[]): string => {
    if (names.length <= 1) return names[0] ?? ""
    return `${names.slice(0, -1).join(", ")} and ${names[names.length - 1]}`
}

export const sessionRoleCopy: Record<SessionRole, {label: string; description: string}> = {
    viewer: {
        label: "Can view",
        description: "Can read the chat. Cannot send or answer approvals.",
    },
    participant: {
        label: "Can send",
        description: "Can read, send messages and answer approvals.",
    },
}

export const sessionSharingCopy = {
    /** Draft (accounts package, contract section 13 item 16): the agent has "user" items. */
    personalAccountsNote:
        "This agent uses each person's own accounts for some items. People you share this chat with can see what it did with yours.",
    shareButton: "Share",
    tooltipPrivate: "Private",
    tooltipPeople: (count: number) => `Shared with ${count} ${count === 1 ? "person" : "people"}`,
    tooltipProject: "Everyone in the project can view and send",
    tooltipNotShareable: "You can share this chat after its first message.",
    chipViewOnly: "View only",
    chipCanSend: "Can send",
    // A "Can send" grant works only for a role that may send (added in the M3 gate, QA D3).
    roleCannotSend: "Their role in this project cannot send.",
    grantViewOnlyByRole: "Can only view: their role in this project cannot send.",
    inviteViewOnly: (names: string) =>
        `${names} can only view: their role in this project cannot send.`,

    panelTitle: "Who can see this chat",
    panelOwner: "Owner",
    panelViewer: (owner: string) =>
        `You can view this chat. Only ${owner} can change who has access.`,
    panelCanSend: "You can read and send in this chat.",
    panelPrivate: (owner: string) => `Private: only people ${owner} added can open it.`,
    panelChannel:
        "This chat comes from a channel. Everyone in the project can read it and send to it.",
    panelNoOwnerCanSend:
        "This chat was started by an API key or an automation, so it has no owner. Everyone in the project can read it and send to it.",
    panelOwnerLeftCanSend: (owner: string) =>
        `${owner} left this project. Everyone in the project can still read this chat and send to it.`,
    /** The reader's own project role cannot send (the approved refused-send sentence). */
    panelYouViewOnly: "You can view this chat, but you cannot send to it.",

    dialogTitle: "Share this chat",
    inviteButton: "Invite",
    peopleSection: "People with access",
    ownerSuffix: "(you)",
    ownerRole: "Owner",
    emptyGrants: "No one else has access yet.",
    removeAccess: "Remove access",
    generalSection: "General access",
    generalPrivate: "Private",
    generalPrivateDescription: "Only you and the people you add can open this chat.",
    generalProject: "Shared with project",
    generalProjectDescription: (project: string) =>
        `Everyone in ${project} can view this chat and send to it.`,
    stopSharing: "Stop sharing",
    copyLink: "Copy share link",
    linkCopied: "Link copied. Only people with access can open it.",
    done: "Done",

    stopTitle: "Stop sharing?",
    stopBodyPeople: (names: readonly string[]) => `${joinNames(names)} will lose access.`,
    stopBodyProject: (project: string) => `Everyone in ${project} will lose access.`,
    cancel: "Cancel",

    loadError: "Couldn't load who has access to this chat.",
    retry: "Try again",
    conflict:
        "The sharing of this chat changed while you had it open. We loaded the latest settings. Check them and make your change again.",
    invalidGrantee: (name: string) =>
        `${name} is no longer a member of this project. Remove this person to share with the others.`,
    saveFailed: "Couldn't save the change. Try again.",
} as const

export const memberPickerCopy = {
    placeholder: "Add people by name or email",
    heading: (project: string) => `Members of ${project}`,
    hasAccess: "Has access",
    footer: "You can only add members of this project.",
    noMatch: (text: string) => `No members of this project match "${text}".`,
    error: "Couldn't load project members.",
    remove: (name: string) => `Remove ${name}`,
} as const

/** One component builds the chat and the agent disclosure, so both live here. */
export const shareDisclosureCopy = {
    titlePeople: (names: readonly string[]) => `Share with ${joinNames(names)}?`,
    titleProject: (project: string) => `Share with everyone in ${project}?`,
    bodySession: (accounts: readonly string[]) =>
        `They will see everything in this chat, and anyone who can send can make the agent use its connected accounts: ${joinNames(accounts)}.`,
    bodySessionNoAccounts: "They will see everything in this chat.",
    back: "Back",
    share: "Share",

    titleAgent: (agent: string) => `Share ${agent} with the project?`,
    bodyAgent: (project: string, accounts: readonly string[]) =>
        `Everyone in ${project} will be able to run this agent and make it use its connected accounts: ${joinNames(accounts)}.`,
    bodyAgentNoAccounts: (project: string) =>
        `Everyone in ${project} will be able to see and run this agent.`,
    cancel: "Cancel",
    shareWithProject: "Share with project",
} as const
