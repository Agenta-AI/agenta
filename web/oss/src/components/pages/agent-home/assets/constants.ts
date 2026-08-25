import {STRIP_COPY} from "@/oss/components/TemplateStrip/assets/constants"
import {getEnv} from "@/oss/lib/helpers/dynamicEnv"

/**
 * Template behavior toggle (`NEXT_PUBLIC_AGENT_TEMPLATE_BUILDER`). On by default: clicking a
 * template (Home or the gallery) opens the playground seeded with the template's builder
 * instruction (the agent-builder flow; no direct config write). Set to "false" to fall back to
 * the config-definition drawer flow. Default-on requires the build kit to reach ephemeral
 * drafts, delivered via the `__ag__build_kit` static workflow
 * (docs/design/build-kit-overlay-delivery/).
 */
export const TEMPLATE_BUILDER_MODE =
    (getEnv("NEXT_PUBLIC_AGENT_TEMPLATE_BUILDER") || "").toLowerCase() !== "false"

/**
 * Playground-native onboarding toggle (`NEXT_PUBLIC_AGENT_PLAYGROUND_ONBOARDING`). On by default: the
 * project-scoped `/playground` route lands on an ephemeral agent (onboarding lives INSIDE the
 * playground) and commits it in place on send — no redirect. Set to `false` to keep onboarding on the
 * agent-home page, navigating to the app playground after create. Additive: both flows coexist so we
 * can A/B the seamless single-page experience against the redirect flow.
 */
export const PLAYGROUND_NATIVE_ONBOARDING =
    (getEnv("NEXT_PUBLIC_AGENT_PLAYGROUND_ONBOARDING") || "").toLowerCase() !== "false"

/**
 * Template-strip experience toggle (`NEXT_PUBLIC_AGENT_TEMPLATE_STRIP`). On by default: Home,
 * playground onboarding, and every agent's empty chat render the shared `<TemplateStrip />`:
 * always visible, filterable in place, card click fills the composer + shows a provenance
 * chip (no drawer, no direct create). Set to "false" to fall back to the per-surface
 * template UIs (grid, quick-pick list, gallery), kept so the experiences can still be
 * compared before the old flows are removed.
 */
export const TEMPLATE_STRIP_MODE =
    (getEnv("NEXT_PUBLIC_AGENT_TEMPLATE_STRIP") || "").toLowerCase() !== "false"

/**
 * Pre-create connect step (`NEXT_PUBLIC_AGENT_CONNECT_STEP`). On by default: describing an agent
 * or picking a template opens the setup card — the accounts it will need, connected before it is
 * created — instead of creating immediately (#6043). Set to "false" to restore instant create on
 * every path, so the step can be A/B'd against it.
 */
export const CONNECT_STEP_MODE =
    (getEnv("NEXT_PUBLIC_AGENT_CONNECT_STEP") || "").toLowerCase() !== "false"

/** Browse-surface layout (`NEXT_PUBLIC_AGENT_BROWSE_RAIL`). OFF by default: sessions, agents and
 * the templates gallery use the one-row toolbar (#5833/#5846). Set to "true" for the filter rail.
 * Mobile always renders the rail — it is the phone's whole viewport, not a second sidebar. */
export const BROWSE_RAIL_MODE =
    (getEnv("NEXT_PUBLIC_AGENT_BROWSE_RAIL") || "").toLowerCase() === "true"

/** Returning users start a task with an agent they already have; first-run users describe an
 * agent to create. Different question, different verb. */
/** No subtitle: the composer's placeholder asks the same thing one line below it. */
export const RETURNING_HERO = {
    title: "What do you want to do?",
}

export const HERO = {
    eyebrowNew: "New",
    eyebrowLabel: "Agent builder",
    title: "What do you want to build?",
    subtitle:
        "Describe an agent in plain language — we'll create and name it, then open the playground.",
    placeholder: STRIP_COPY.describeAgentPlaceholder,
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
