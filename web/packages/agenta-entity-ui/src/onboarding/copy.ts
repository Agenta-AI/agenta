/**
 * Setup-step copy (#6043), kept out of the component so the wording is reviewable and testable
 * in one place. Every state states its consequence — what happens if you press Create now.
 */
import type {AgentSetupStatus, DetectedAccount} from "@agenta/entities/workflow"

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

export const setupLead = (status: AgentSetupStatus): string =>
    status === "empty"
        ? "We didn't spot a specific service in your description. Add one now, or let the agent ask when it needs one."
        : "Connect now so the agent can run the moment it's built — or skip, and it'll ask when it gets there."

/** The muted line beside the primary action. Names what is left, or what skipping costs. */
export const setupFootnote = (
    status: AgentSetupStatus,
    outstanding: DetectedAccount[],
    skippedCount: number,
): string => {
    if (status === "blocked") {
        const names = outstanding.map((account) => account.label)
        if (names.length === 1) return `Connect ${names[0]} to create.`
        if (names.length === 2) return `Connect ${names[0]} and ${names[1]} to create.`
        return `Connect ${names.length} accounts to create.`
    }
    if (skippedCount > 0) return "Skipped accounts are asked for later."
    if (status === "empty") return "Nothing required."
    return "Nothing to do here."
}

/** The header's right-hand pill. `null` when the state needs no label. */
export const setupBadge = (
    status: AgentSetupStatus,
    accountCount: number,
    skippedCount: number,
): {text: string; tone: "neutral" | "warning" | "success"} | null => {
    if (status === "blocked") return {text: "Required", tone: "warning"}
    if (status === "all-set") return {text: "All set", tone: "success"}
    if (skippedCount > 0) return {text: `${skippedCount} skipped`, tone: "neutral"}
    if (accountCount > 0) return {text: `${accountCount} found`, tone: "neutral"}
    return null
}

export const SETUP_COPY = {
    permissionLabel: "Acts",
    suggestionsLabel: "Also add",
    browseAll: "Search all",
    create: "Create agent",
} as const
