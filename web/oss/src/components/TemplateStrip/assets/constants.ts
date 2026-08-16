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

/** Owner-specified key (matches the design prototype; intentionally not "agenta:"-prefixed). */
export const STRIP_HIDDEN_STORAGE_KEY = "agenta-tpl-strip-hidden"

export const TOAST_DISMISS_MS = 2600
