/**
 * Setup-step copy (#6043), kept out of the component so the wording is reviewable and testable
 * in one place. Every state states its consequence — what happens if you press Create now.
 */
import type {AgentSetupStatus} from "@agenta/entities/workflow"

export const setupTitle = (status: AgentSetupStatus): string => {
    switch (status) {
        case "empty":
            return "Any accounts to connect?"
        case "all-set":
            return "Ready to build"
        default:
            return "Connect what it needs"
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
        return "We didn't spot a specific service in your description. Add one now, or let the agent ask when it needs one."
    }
    if (fromTemplate) {
        return "This template needs these accounts. Connect them now so the agent can run the moment it's built."
    }
    return "From your description. Connect now so the agent can run the moment it's built — or skip, and it'll ask when it gets there."
}

/** The muted line beside the primary action. */
export const setupFootnote = (status: AgentSetupStatus): string => {
    // Blocked says NOTHING here: the header badge and the amber Required rows already say it
    // twice, and the disabled Create button says what it costs — a third line is nagging.
    if (status === "blocked") return ""
    if (status === "empty") return "Nothing required."
    // "ready" means optional rows are still unconnected — leaving one IS skipping it, and this
    // line says what that costs.
    if (status === "ready") return "Connect these now, or the agent will ask later."
    // all-set: silent for now. The badge ("All set") and the title ("Ready to build") already
    // carry the state; a line here is pending better copy, so the branch stays.
    return ""
}

/** The header's right-hand pill. `null` when the state needs no label. */
export const setupBadge = (
    status: AgentSetupStatus,
    accountCount: number,
): {text: string; tone: "neutral" | "warning" | "success"} | null => {
    if (status === "blocked") return {text: "Required", tone: "warning"}
    if (status === "all-set") return {text: "All set", tone: "success"}
    if (accountCount > 0) return {text: `${accountCount} found`, tone: "neutral"}
    return null
}

export const SETUP_COPY = {
    suggestionsLabel: "Also add",
    browseAll: "Search all",
    create: "Create agent",
    dismiss: "Cancel setup",
} as const
