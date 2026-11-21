/**
 * Every user-facing string of the agent privacy and owner UI. Source: the approved M3 UI design
 * copy deck. Placeholders are functions. The member picker and the share disclosure live in
 * `@agenta/sessions-ui` (the chat Share dialog uses them too); their strings are re-exported here.
 *
 * The text lives in the `entityUi.sharing` catalog. Each entry is read when it is used, so it is
 * in the active language; the components here call `useT` with the catalog so they draw again
 * when the language's text loads.
 */
import {createT} from "@agenta/i18n"
import sharingCatalog from "@agenta/i18n/catalogs/entityUi.sharing"
import {joinNames} from "@agenta/sessions-ui/sharing"

export {joinNames, memberPickerCopy, shareDisclosureCopy} from "@agenta/sessions-ui/sharing"

const t = createT(sharingCatalog)

export const agentSharingCopy = {
    get menuItem() {
        return t("entityUi.sharing.menuItem")
    },
    get dialogTitle() {
        return t("entityUi.sharing.dialogTitle")
    },

    get triggerPrivate() {
        return t("entityUi.sharing.triggerPrivate")
    },
    get triggerShared() {
        return t("entityUi.sharing.triggerShared")
    },
    get triggerAriaPrivate() {
        return t("entityUi.sharing.triggerAriaPrivate")
    },

    get panelTitle() {
        return t("entityUi.sharing.panelTitle")
    },
    get linePrivate() {
        return t("entityUi.sharing.linePrivate")
    },
    /** The second sentence is a draft: sharing the agent does not share its chats. */
    lineProject: (project: string) => t("entityUi.sharing.lineProject", {project}),
    panelOwnerYou: (name: string) => t("entityUi.sharing.panelOwnerYou", {name}),
    get change() {
        return t("entityUi.sharing.change")
    },

    get whoSection() {
        return t("entityUi.sharing.whoSection")
    },
    get cardPrivate() {
        return t("entityUi.sharing.cardPrivate")
    },
    get cardProject() {
        return t("entityUi.sharing.cardProject")
    },
    get ownerSection() {
        return t("entityUi.sharing.ownerSection")
    },
    get ownerRole() {
        return t("entityUi.sharing.ownerRole")
    },
    get youSuffix() {
        return t("entityUi.sharing.youSuffix")
    },
    get transferButton() {
        return t("entityUi.sharing.transferButton")
    },
    get done() {
        return t("entityUi.sharing.done")
    },
    get cancel() {
        return t("entityUi.sharing.cancel")
    },

    makePrivateTitle: (agent: string) => t("entityUi.sharing.makePrivateTitle", {agent}),
    get makePrivateBody() {
        return t("entityUi.sharing.makePrivateBody")
    },
    get makePrivate() {
        return t("entityUi.sharing.makePrivate")
    },

    get transferTitle() {
        return t("entityUi.sharing.transferTitle")
    },
    get newOwner() {
        return t("entityUi.sharing.newOwner")
    },
    get transferHelp() {
        return t("entityUi.sharing.transferHelp")
    },
    transferPrivateWarning: (name: string) => t("entityUi.sharing.transferPrivateWarning", {name}),
    get transferPrivateChats() {
        return t("entityUi.sharing.transferPrivateChats")
    },
    transferShared: (name: string) => t("entityUi.sharing.transferShared", {name}),
    transferTo: (name: string) => t("entityUi.sharing.transferTo", {name}),
    transferInvalid: (name: string) => t("entityUi.sharing.transferInvalid", {name}),
    get back() {
        return t("entityUi.sharing.back")
    },

    notOwner: (owner: string) => t("entityUi.sharing.notOwner", {owner}),
    ownerLeft: (owner: string) => t("entityUi.sharing.ownerLeft", {owner}),
    get ownerLeftNonAdmin() {
        return t("entityUi.sharing.ownerLeftNonAdmin")
    },
    /** `ownerLeft` and `ownerLeftNonAdmin` as one text, for a viewer who cannot take ownership. */
    ownerLeftAskAdmin: (owner: string) => t("entityUi.sharing.ownerLeftAskAdmin", {owner}),
    get noOwner() {
        return t("entityUi.sharing.noOwner")
    },
    get takeOwnership() {
        return t("entityUi.sharing.takeOwnership")
    },
    get takeOwnershipHelp() {
        return t("entityUi.sharing.takeOwnershipHelp")
    },
    ownerActive: (owner: string) => t("entityUi.sharing.ownerActive", {owner}),
    get conflict() {
        return t("entityUi.sharing.conflict")
    },
    get saveFailed() {
        return t("entityUi.sharing.saveFailed")
    },
    get loadError() {
        return t("entityUi.sharing.loadError")
    },
    get retry() {
        return t("entityUi.sharing.retry")
    },
    channelsOff: (platforms: readonly string[]) =>
        t("entityUi.sharing.channelsOff", {platforms: joinNames(platforms)}),
    get openChannels() {
        return t("entityUi.sharing.openChannels")
    },

    toastPrivate: (agent: string) => t("entityUi.sharing.toastPrivate", {agent}),
    toastShared: (agent: string) => t("entityUi.sharing.toastShared", {agent}),
    toastTransferred: (name: string, agent: string) =>
        t("entityUi.sharing.toastTransferred", {name, agent}),
    toastTookOwnership: (agent: string) => t("entityUi.sharing.toastTookOwnership", {agent}),
}
