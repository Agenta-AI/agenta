/**
 * Every user-facing string of the chat sharing UI, the member picker and the share disclosure.
 * Source: the approved M3 UI design copy deck. Getters and functions read the text at render,
 * in the current language.
 */
import type {SessionRole} from "@agenta/entities/sharing"
import {createT, formatLocale} from "@agenta/i18n"
import sessionsMemberPickerCatalog from "@agenta/i18n/catalogs/sessions.memberPicker"
import sessionsShareDisclosureCatalog from "@agenta/i18n/catalogs/sessions.shareDisclosure"
import sessionsSharingCatalog from "@agenta/i18n/catalogs/sessions.sharing"

const t = createT(
    sessionsSharingCatalog,
    sessionsMemberPickerCatalog,
    sessionsShareDisclosureCatalog,
)

/** "A", "A and B", "A, B and C" (English); the list joiner follows the active language. */
export const joinNames = (names: readonly string[]): string => {
    if (names.length <= 1) return names[0] ?? ""
    return new Intl.ListFormat(formatLocale() ?? "en-GB", {
        style: "long",
        type: "conjunction",
    }).format(names)
}

export const sessionRoleCopy: Record<SessionRole, {label: string; description: string}> = {
    viewer: {
        get label() {
            return t("sessions.sharing.roleViewerLabel")
        },
        get description() {
            return t("sessions.sharing.roleViewerDescription")
        },
    },
    participant: {
        get label() {
            return t("sessions.sharing.roleParticipantLabel")
        },
        get description() {
            return t("sessions.sharing.roleParticipantDescription")
        },
    },
}

export const sessionSharingCopy = {
    /** Draft (accounts package, contract section 13 item 16): the agent has "user" items. */
    get personalAccountsNote() {
        return t("sessions.sharing.personalAccountsNote")
    },
    get shareButton() {
        return t("sessions.sharing.shareButton")
    },
    get tooltipPrivate() {
        return t("sessions.sharing.tooltipPrivate")
    },
    tooltipPeople: (count: number) => t("sessions.sharing.tooltipPeople", {count}),
    get tooltipProject() {
        return t("sessions.sharing.tooltipProject")
    },
    get tooltipNotShareable() {
        return t("sessions.sharing.tooltipNotShareable")
    },
    get chipViewOnly() {
        return t("sessions.sharing.chipViewOnly")
    },
    get chipCanSend() {
        return t("sessions.sharing.chipCanSend")
    },
    // A "Can send" grant works only for a role that may send (added in the M3 gate, QA D3).
    get roleCannotSend() {
        return t("sessions.sharing.roleCannotSend")
    },
    get grantViewOnlyByRole() {
        return t("sessions.sharing.grantViewOnlyByRole")
    },
    inviteViewOnly: (names: string) => t("sessions.sharing.inviteViewOnly", {names}),

    get panelTitle() {
        return t("sessions.sharing.panelTitle")
    },
    get panelOwner() {
        return t("sessions.sharing.panelOwner")
    },
    panelViewer: (owner: string) => t("sessions.sharing.panelViewer", {owner}),
    get panelCanSend() {
        return t("sessions.sharing.panelCanSend")
    },
    panelPrivate: (owner: string) => t("sessions.sharing.panelPrivate", {owner}),
    get panelChannel() {
        return t("sessions.sharing.panelChannel")
    },
    get panelNoOwnerCanSend() {
        return t("sessions.sharing.panelNoOwnerCanSend")
    },
    panelOwnerLeftCanSend: (owner: string) => t("sessions.sharing.panelOwnerLeftCanSend", {owner}),
    /** The reader's own project role cannot send (the approved refused-send sentence). */
    get panelYouViewOnly() {
        return t("sessions.sharing.panelYouViewOnly")
    },

    get dialogTitle() {
        return t("sessions.sharing.dialogTitle")
    },
    get inviteButton() {
        return t("sessions.sharing.inviteButton")
    },
    get peopleSection() {
        return t("sessions.sharing.peopleSection")
    },
    get ownerSuffix() {
        return t("sessions.sharing.ownerSuffix")
    },
    get ownerRole() {
        return t("sessions.sharing.ownerRole")
    },
    get emptyGrants() {
        return t("sessions.sharing.emptyGrants")
    },
    get removeAccess() {
        return t("sessions.sharing.removeAccess")
    },
    get generalSection() {
        return t("sessions.sharing.generalSection")
    },
    get generalPrivate() {
        return t("sessions.sharing.generalPrivate")
    },
    get generalPrivateDescription() {
        return t("sessions.sharing.generalPrivateDescription")
    },
    get generalProject() {
        return t("sessions.sharing.generalProject")
    },
    generalProjectDescription: (project: string) =>
        t("sessions.sharing.generalProjectDescription", {project}),
    get stopSharing() {
        return t("sessions.sharing.stopSharing")
    },
    get copyLink() {
        return t("sessions.sharing.copyLink")
    },
    get linkCopied() {
        return t("sessions.sharing.linkCopied")
    },
    /** Draft: the chat is private with nobody added, so the copied link opens for nobody else. */
    get linkNobodyYet() {
        return t("sessions.sharing.linkNobodyYet")
    },
    /** Draft: the toast after a copy while nobody else has access. */
    get linkCopiedNobodyYet() {
        return t("sessions.sharing.linkCopiedNobodyYet")
    },
    get done() {
        return t("sessions.sharing.done")
    },

    get stopTitle() {
        return t("sessions.sharing.stopTitle")
    },
    stopBodyPeople: (names: readonly string[]) =>
        t("sessions.sharing.stopBodyPeople", {names: joinNames(names)}),
    stopBodyProject: (project: string) => t("sessions.sharing.stopBodyProject", {project}),
    get cancel() {
        return t("sessions.sharing.cancel")
    },

    get loadError() {
        return t("sessions.sharing.loadError")
    },
    get retry() {
        return t("sessions.sharing.retry")
    },
    get conflict() {
        return t("sessions.sharing.conflict")
    },
    invalidGrantee: (name: string) => t("sessions.sharing.invalidGrantee", {name}),
    get saveFailed() {
        return t("sessions.sharing.saveFailed")
    },
}

export const memberPickerCopy = {
    get placeholder() {
        return t("sessions.memberPicker.placeholder")
    },
    heading: (project: string) => t("sessions.memberPicker.heading", {project}),
    get hasAccess() {
        return t("sessions.memberPicker.hasAccess")
    },
    get footer() {
        return t("sessions.memberPicker.footer")
    },
    noMatch: (text: string) => t("sessions.memberPicker.noMatch", {text}),
    get error() {
        return t("sessions.memberPicker.error")
    },
    remove: (name: string) => t("sessions.memberPicker.remove", {name}),
}

/** One component builds the chat and the agent disclosure, so both live here. */
export const shareDisclosureCopy = {
    titlePeople: (names: readonly string[]) =>
        t("sessions.shareDisclosure.titlePeople", {names: joinNames(names)}),
    titleProject: (project: string) => t("sessions.shareDisclosure.titleProject", {project}),
    bodySession: (accounts: readonly string[]) =>
        t("sessions.shareDisclosure.bodySession", {accounts: joinNames(accounts)}),
    get bodySessionNoAccounts() {
        return t("sessions.shareDisclosure.bodySessionNoAccounts")
    },
    /** Draft (accounts package): an item that uses each person's own account, not the owner's. */
    personalAccount: (account: string) => t("sessions.shareDisclosure.personalAccount", {account}),
    get back() {
        return t("sessions.shareDisclosure.back")
    },
    get share() {
        return t("sessions.shareDisclosure.share")
    },

    titleAgent: (agent: string) => t("sessions.shareDisclosure.titleAgent", {agent}),
    bodyAgent: (project: string, accounts: readonly string[]) =>
        t("sessions.shareDisclosure.bodyAgent", {project, accounts: joinNames(accounts)}),
    bodyAgentNoAccounts: (project: string) =>
        t("sessions.shareDisclosure.bodyAgentNoAccounts", {project}),
    get cancel() {
        return t("sessions.shareDisclosure.cancel")
    },
    get shareWithProject() {
        return t("sessions.shareDisclosure.shareWithProject")
    },
}
