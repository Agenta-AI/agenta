/**
 * Texts of the account options and of "Attach a secret".
 *
 * APPROVED (UX-DECISIONS.md, 2026-10-29): "Each person's own sign-in", "The project's sign-in".
 * Every other text here is a DRAFT for the owner's text pass.
 *
 * The text lives in the `entityUi.accounts` catalog. Each entry is read when it is used, so it is
 * in the active language; a component that shows these texts can call `useT` with the catalog so it
 * draws again when the language's text loads.
 */
import {createT} from "@agenta/i18n"
import accountsCatalog from "@agenta/i18n/catalogs/entityUi.accounts"

const t = createT(accountsCatalog)

export const ACCOUNT_COPY = {
    get eachPersonSignIn() {
        return t("entityUi.accounts.eachPersonSignIn")
    },
    get projectSignIn() {
        return t("entityUi.accounts.projectSignIn")
    },
    // Drafts.
    get choiceFailed() {
        return t("entityUi.accounts.choiceFailed")
    },
    // "Attach a secret" (drafts).
    get createNewSecret() {
        return t("entityUi.accounts.createNewSecret")
    },
    get addOne() {
        return t("entityUi.accounts.addOne")
    },
    get addAnotherSecret() {
        return t("entityUi.accounts.addAnotherSecret")
    },
    get addYourSecret() {
        return t("entityUi.accounts.addYourSecret")
    },
    get whoCanUseIt() {
        return t("entityUi.accounts.whoCanUseIt")
    },
    get onlyMe() {
        return t("entityUi.accounts.onlyMe")
    },
    get onlyMeSecretNote() {
        return t("entityUi.accounts.onlyMeSecretNote")
    },
    everyoneIn: (project?: string) =>
        project === undefined
            ? t("entityUi.accounts.everyoneInThisProject")
            : t("entityUi.accounts.everyoneInProject", {project}),
    get everyoneSecretNote() {
        return t("entityUi.accounts.everyoneSecretNote")
    },
    get userSecretRow() {
        return t("entityUi.accounts.userSecretRow")
    },
}
