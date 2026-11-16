/**
 * Setup-step copy (#6043), kept out of the component so the wording is reviewable and testable
 * in one place. Every state states its consequence — what happens if you press Create now.
 */
import type {AgentSetupStatus} from "@agenta/entities/workflow"
import {createT} from "@agenta/i18n"
import onboardingCatalog from "@agenta/i18n/catalogs/entityUi.onboarding"

// Read at call time, so a caller that re-renders on a language change gets the new text.
const tNow = createT(onboardingCatalog)

export const setupTitle = (status: AgentSetupStatus): string => {
    switch (status) {
        case "empty":
            return tNow("entityUi.onboarding.titleEmpty")
        case "all-set":
            return tNow("entityUi.onboarding.titleAllSet")
        default:
            return tNow("entityUi.onboarding.titleDefault")
    }
}

/**
 * Where the rows came from is stated once here, not repeated as a subtitle on every row (see
 * `NO_SCOPE_LINE` in detectAccounts).
 *
 * `fromTemplate` matters: a template DECLARES its accounts, so claiming they came "from your
 * description" is simply false — and the description in that case is the template's own builder
 * message, which the user never wrote.
 */
export const setupLead = (status: AgentSetupStatus, fromTemplate = false): string => {
    if (status === "empty") {
        return tNow("entityUi.onboarding.leadEmpty")
    }
    if (fromTemplate) {
        return tNow("entityUi.onboarding.leadTemplate")
    }
    return tNow("entityUi.onboarding.leadDescription")
}

/** The muted line beside the primary action. */
export const setupFootnote = (status: AgentSetupStatus): string => {
    // Blocked says NOTHING here: the header badge and the amber Required rows already say it
    // twice, and the disabled Create button says what it costs — a third line is nagging.
    if (status === "blocked") return ""
    if (status === "empty") return tNow("entityUi.onboarding.footnoteEmpty")
    // "ready" means optional rows are still unconnected — leaving one IS skipping it, and this
    // line says what that costs.
    if (status === "ready") return tNow("entityUi.onboarding.connectNowOrLater")
    // all-set: silent for now. The badge ("All set") and the title ("Ready to build") already
    // carry the state; a line here is pending better copy, so the branch stays.
    return ""
}

/** The header's right-hand pill. `null` when the state needs no label. */
export const setupBadge = (
    status: AgentSetupStatus,
    accountCount: number,
): {text: string; tone: "neutral" | "warning" | "success"} | null => {
    if (status === "blocked") return {text: tNow("entityUi.onboarding.required"), tone: "warning"}
    if (status === "all-set") return {text: tNow("entityUi.onboarding.allSet"), tone: "success"}
    if (accountCount > 0) return {
            text: tNow("entityUi.onboarding.foundCount", {count: accountCount}),
            tone: "neutral",
        }
    return null
}

export const SETUP_COPY = {
    get suggestionsLabel() {
        return tNow("entityUi.onboarding.alsoAdd")
    },
    get browseAll() {
        return tNow("entityUi.onboarding.searchAll")
    },
    get create() {
        return tNow("entityUi.onboarding.createAgent")
    },
    get dismiss() {
        return tNow("entityUi.onboarding.cancelSetup")
    },
}

/**
 * The chat's "Connect your accounts" card (approved board `chat-connect-card`): the title, the
 * badge, the footer line and "Continue" are approved. The row texts are drafts from spec 5.3.
 */
export const PERSONAL_SETUP_COPY = {
    get title() {
        return tNow("entityUi.onboarding.connectYourAccounts")
    },
    get badge() {
        return tNow("entityUi.onboarding.optional")
    },
    get footnote() {
        return tNow("entityUi.onboarding.connectNowOrLater")
    },
    get continue() {
        return tNow("entityUi.onboarding.continue")
    },
    get dismiss() {
        return tNow("entityUi.onboarding.close")
    },
    // Drafts.
    chooseAccount: (name: string) => tNow("entityUi.onboarding.chooseAccount", {name}),
    connectAccount: (name: string) => tNow("entityUi.onboarding.connectAccount", {name}),
    signIn: (name: string) => tNow("entityUi.onboarding.signInWithOwnAccount", {name}),
    chooseSecret: (envVar: string) => tNow("entityUi.onboarding.chooseSecret", {envVar}),
    addSecret: (envVar: string) => tNow("entityUi.onboarding.addSecret", {envVar}),
    get connect() {
        return tNow("entityUi.onboarding.connect")
    },
    get connectAnother() {
        return tNow("entityUi.onboarding.connectAnother")
    },
    get signInAction() {
        return tNow("entityUi.onboarding.signIn")
    },
    get defaultMark() {
        return tNow("entityUi.onboarding.default")
    },
    get connected() {
        return tNow("entityUi.onboarding.connected")
    },
    get signedIn() {
        return tNow("entityUi.onboarding.signedInAsYou")
    },
    get chosen() {
        return tNow("entityUi.onboarding.chosen")
    },
    get failed() {
        return tNow("entityUi.onboarding.failed")
    },
}
