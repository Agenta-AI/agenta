/** First-run copy for the onboarding hero and its templates strip. */
export const FIRST_RUN_COPY = {
    title: "What do you want to build?",
    subtitle:
        "Describe an agent in plain language — we'll create and name it, then run it right here.",
    /** One question, one example. */
    placeholder:
        "e.g. Watch our #support channel, triage each thread by urgency, and route it to the right owner — ask me before closing anything.",
    tryLabel: "Try",
    templates: "Templates",
    browseAll: (total: number) => `Browse all ${total}`,
    /** En dash, not a hyphen. */
    templateCounter: (from: number, to: number, total: number) => `${from}–${to} of ${total}`,
    prevTemplates: "Previous templates",
    nextTemplates: "Next templates",
    hideTemplates: "Don't show again",
    templatesHidden: "Templates hidden",
    showAgain: "show again",
    /** A template already says what is being built, so the hero names it; the subtitle is the
     * template's own `description` one-liner. */
    templateTitle: (name: string) => `Set up ${name}`,
    create: "Create agent",
    creating: "Creating agent",
    /** Shown only once a template's prompt has been edited — one tap restores the original. */
    resetPrompt: "Reset prompt",
} as const
