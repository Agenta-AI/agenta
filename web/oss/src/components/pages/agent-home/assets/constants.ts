import {getEnv} from "@/oss/lib/helpers/dynamicEnv"

/**
 * Dev flag gating the new agent onboarding Home. Set NEXT_PUBLIC_AGENT_ONBOARDING=true
 * to render <AgentHome/> in place of the legacy AppManagement dashboard.
 */
export const ENABLE_AGENT_ONBOARDING = getEnv("NEXT_PUBLIC_AGENT_ONBOARDING") === "true"

export const HERO = {
    eyebrowNew: "New",
    eyebrowLabel: "Agent builder",
    title: "What do you want to build?",
    subtitle:
        "Describe an agent in plain language — we'll create and name it, then open the playground.",
    placeholder:
        "e.g. Watch our #support channel, triage each thread by urgency, and route it to the right owner — ask me before closing anything.",
} as const

export const COMPOSER = {
    tabUi: "Build in the UI",
    tabIde: "Continue in IDE",
    createAgent: "Create agent",
    copyPrompt: "Copy prompt",
    installHint: "install + your prompt",
    helperUi: "Prefer your IDE? Switch to Continue in IDE to copy the install + your prompt.",
    helperIde:
        "Paste into Claude Code, Cursor or any coding agent — it installs Agenta and builds from your prompt.",
} as const

export const TEMPLATES_SECTION = {
    title: "Or start from a template",
    browseAll: "Browse all",
} as const

export const TEMPLATES_GALLERY = {
    title: "Templates",
    subtitle:
        "Start from a proven agent — review what it does, connect what it needs, and open the playground.",
    searchPlaceholder: "Search templates…",
} as const

/** First-run tutorial video config. `null` hides the column (composer returns to full width). */
export const TUTORIAL_VIDEO: {url?: string; poster?: string; durationLabel?: string} | null = {
    durationLabel: "2:04",
}

export const TUTORIAL = {
    title: "Build your first agent",
    caption: "A 2-minute tour: prompt → playground → first run.",
} as const

// TODO: confirm the exact CLI + skill slug with the SDK team.
export const IDE_INSTALL_COMMAND = "npx agenta@latest skills add"

/** Compose the clipboard payload for the IDE path: install command + the user's prompt. */
export const buildIdeCommand = (prompt: string) =>
    prompt.trim() ? `${IDE_INSTALL_COMMAND}\n\n${prompt.trim()}` : IDE_INSTALL_COMMAND
