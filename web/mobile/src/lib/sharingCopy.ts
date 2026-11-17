/**
 * The app-level strings of chat and agent sharing on /m. Source: the approved M3 UI design copy
 * deck. The sharing components in `@agenta/sessions-ui/sharing` and `@agenta/entity-ui/sharing`
 * carry their own strings; this module holds only what the app screens say around them.
 * Getters and functions read the text at render, in the current language.
 */
import {createT} from "@agenta/i18n"
import sharingAccessCatalog from "@agenta/i18n/catalogs/chat.sharingAccess"
import {sessionSharingCopy} from "@agenta/sessions-ui/sharing"

const t = createT(sharingAccessCatalog)

export const sharingCopy = {
    // The notice that takes the composer's place.
    composerViewer: (owner: string) => t("chat.sharingAccess.composerViewer", {owner}),
    get composerPrivateAgent() {
        return t("chat.sharingAccess.composerPrivateAgent")
    },
    // A channel chat the reader's project role cannot send to (the Share panel's sentence).
    get composerRoleViewOnly() {
        return sessionSharingCopy.panelYouViewOnly
    },
    get composerNoOwner() {
        return t("chat.sharingAccess.composerNoOwner")
    },
    composerOwnerLeft: (owner: string) => t("chat.sharingAccess.composerOwnerLeft", {owner}),
    // The sharing state failed to load: the Share dialog's own load-error sentence.
    get composerAccessUnknown() {
        return sessionSharingCopy.loadError
    },

    // Stands in for the owner's name while the member list has not named them.
    get ownerFallback() {
        return t("chat.sharingAccess.ownerFallback")
    },

    // The top bar of a chat whose agent the reader cannot see.
    get privateAgent() {
        return t("chat.sharingAccess.privateAgent")
    },

    // A send refused because the sender lost access to the agent. The rejection row prints the
    // subject and the reason as one sentence.
    get refusedSubject() {
        return t("chat.sharingAccess.refusedSubject")
    },
    get refusedNoAgentAccess() {
        return t("chat.sharingAccess.refusedNoAgentAccess")
    },

    // The chat was readable and is not any more.
    get accessRemovedTitle() {
        return t("chat.sharingAccess.accessRemovedTitle")
    },
    get accessRemovedBody() {
        return t("chat.sharingAccess.accessRemovedBody")
    },
    get backToSessions() {
        return t("chat.sharingAccess.backToSessions")
    },
    // The agent overview's not-found screen (added in the M3 gate, QA D6).
    get backToAgents() {
        return t("chat.sharingAccess.backToAgents")
    },

    // Hidden and unknown read the same.
    get chatNotFound() {
        return t("chat.sharingAccess.chatNotFound")
    },
    // Draft: a chat link someone sent gives no access until its owner adds the reader.
    get chatNotFoundAskOwner() {
        return t("chat.sharingAccess.chatNotFoundAskOwner")
    },
    get agentNotFound() {
        return t("chat.sharingAccess.agentNotFound")
    },

    // A read-only approval card.
    approvalWaiting: (owner: string) => t("chat.sharingAccess.approvalWaiting", {owner}),

    // The session row menu on a phone, for someone who is not the owner.
    rowMenuNotOwner: (owner: string) => t("chat.sharingAccess.rowMenuNotOwner", {owner}),

    // The lock on the reader's own private agent (the privacy panel's line for a private agent).
    get agentPrivateMarker() {
        return t("chat.sharingAccess.agentPrivateMarker")
    },
}

/** The display name of a channel platform, as the agent privacy dialog names it. */
export const channelPlatformLabel: Record<"slack" | "telegram" | "whatsapp", string> = {
    slack: "Slack",
    telegram: "Telegram",
    whatsapp: "WhatsApp",
}
