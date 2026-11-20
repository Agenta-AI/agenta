/**
 * Texts of the "Account" block in an item's drawer and of "Attach a secret".
 *
 * APPROVED (UX-DECISIONS.md, 2026-10-29): the label "Account", "Each person's default <name>",
 * "Each person's own sign-in", "The project's sign-in", "When you run it: <account> (your
 * default)", "Change", "Make it my default for every agent", "Connect another <name> account",
 * "When you run it: signed in as you", "Sign out".
 *
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
    get label() {
        return t("entityUi.accounts.label")
    },
    get eachPersonSignIn() {
        return t("entityUi.accounts.eachPersonSignIn")
    },
    get projectSignIn() {
        return t("entityUi.accounts.projectSignIn")
    },
    whenYouRun: (account: string) => t("entityUi.accounts.whenYouRun", {account}),
    get change() {
        return t("entityUi.accounts.change")
    },
    get signedInAsYou() {
        return t("entityUi.accounts.signedInAsYou")
    },
    get signOut() {
        return t("entityUi.accounts.signOut")
    },
    // Drafts.
    get noneChosen() {
        return t("entityUi.accounts.noneChosen")
    },
    get choose() {
        return t("entityUi.accounts.choose")
    },
    get notSignedIn() {
        return t("entityUi.accounts.notSignedIn")
    },
    get signInExpired() {
        return t("entityUi.accounts.signInExpired")
    },
    get signIn() {
        return t("entityUi.accounts.signIn")
    },
    get tokenPlaceholder() {
        return t("entityUi.accounts.tokenPlaceholder")
    },
    get saveToken() {
        return t("entityUi.accounts.saveToken")
    },
    get choiceFailed() {
        return t("entityUi.accounts.choiceFailed")
    },
    // "Attach a secret" (drafts).
    get eachPersonSecret() {
        return t("entityUi.accounts.eachPersonSecret")
    },
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
    get secretValueLine() {
        return t("entityUi.accounts.secretValueLine")
    },
    get noSecretYet() {
        return t("entityUi.accounts.noSecretYet")
    },
    get userSecretRow() {
        return t("entityUi.accounts.userSecretRow")
    },
}
