/** Copy + behavior constants for the TemplateStrip experience (flag: TEMPLATE_STRIP_MODE). */

export const STRIP_COPY = {
    label: "Templates",
    hiddenLine: "Templates hidden",
    showAgain: "show again",
    hideMenuItem: "Don't show again",
    fromTemplate: "From template:",
    useCodingAgent: "Use my coding agent",
    createAgent: "Create agent",
    creatingAgent: "Creating agent",
    copiedToast: "Copied — paste into Claude Code, Cursor, Codex, or any coding agent",
    // Single source for every "describe an agent" composer (home hero + playground onboarding).
    describeAgentPlaceholder:
        "e.g. Watch our #support channel, triage each thread by urgency, and route it to the right owner — ask me before closing anything.",
} as const

/** Owner-specified install command (differs from the flag-off IDE_INSTALL_COMMAND on purpose). */
export const CODING_AGENT_INSTALL = "npx skills add Agenta-AI/agenta-skills"

/**
 * `agenta:`-prefixed, like every other key this app writes. The prototype's unprefixed name was
 * not a reason to opt out of the convention; the cost of the change is that anyone who had
 * hidden the strip sees it once more.
 */
export const STRIP_HIDDEN_STORAGE_KEY = "agenta:templates:strip-hidden"

export const TOAST_DISMISS_MS = 2600
