/**
 * First-run copy, taken from the desktop onboarding hero so both surfaces ask the same question
 * in the same words: `ONBOARDING_COPY` in
 * `web/oss/src/components/AgentChatSlice/components/AgentChatEmptyState.tsx:14` and
 * `TEMPLATES_SECTION` in `web/oss/src/components/pages/agent-home/assets/constants.ts:67`.
 *
 * Kept as a local constant rather than imported: those live in the desktop app layer, which this
 * app may not import from at all.
 */
export const FIRST_RUN_COPY = {
    title: "What do you want to build?",
    subtitle:
        "Describe an agent in plain language — we'll create and name it, then run it right here.",
    placeholder: "Describe the agent you want…",
    tryLabel: "Try",
    templates: "Or start from a template",
} as const

/** Tap to fill the composer — see the note in [[FirstRunComposer]] on why they fill, not send. */
export const FIRST_RUN_STARTERS = [
    "Triage #support tickets",
    "Review my PRs",
    "Summarize standups",
] as const
