/** Copy + behavior constants for the TemplateStrip experience (flag: TEMPLATE_STRIP_MODE). */

export const STRIP_COPY = {
    label: "Templates",
    hiddenLine: "Templates hidden",
    showAgain: "show again",
    hideMenuItem: "Don't show again",
    fromTemplate: "From template:",
    createAgent: "Create agent",
    creatingAgent: "Creating agent",
    // Single source for every "describe an agent" composer (home hero + playground onboarding).
    describeAgentPlaceholder:
        "e.g. Watch our #support channel, triage each thread by urgency, and route it to the right owner — ask me before closing anything.",
} as const

/** Owner-specified key (matches the design prototype; intentionally not "agenta:"-prefixed). */
export const STRIP_HIDDEN_STORAGE_KEY = "agenta-tpl-strip-hidden"
