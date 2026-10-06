import {
    templateBuilderMessage,
    type AgentStarterTemplate,
    type AgentTemplatesStatus,
} from "@agenta/entities/workflow"
import {
    Briefcase,
    ChartBar,
    Code,
    DotsThree,
    GearSix,
    GithubLogo,
    Headset,
    Lightbulb,
    MagnifyingGlass,
    Megaphone,
    Newspaper,
    RedditLogo,
    Sparkle,
    Target,
    Users,
    XLogo,
    type Icon,
} from "@phosphor-icons/react"

/** PostHog flag key; see `web/experiments/onboarding-first-agent-v1.json`. */
export const ONBOARDING_EXPERIMENT_FLAG = "onboarding-first-agent-v1"

/** `?onboarding-variant=` shows a variant without enrolling the visitor. */
export const ONBOARDING_PREVIEW_PARAM = "onboarding-variant"

export const ONBOARDING_VARIANTS = ["control", "task-first"] as const
/** `control` asks for a name first; `task-first` asks for the first task. */
export type OnboardingVariant = (typeof ONBOARDING_VARIANTS)[number]

export const parseOnboardingVariant = (value: unknown): OnboardingVariant | null =>
    ONBOARDING_VARIANTS.find((variant) => variant === value) ?? null

/** Tile tones, cycled by position so neighbouring cards never share one. */
export const ONBOARDING_TONES = [
    "bg-[var(--ag-preset-purple-bg)] text-[var(--ag-preset-purple-text)]",
    "bg-[var(--ag-preset-cyan-bg)] text-[var(--ag-preset-cyan-text)]",
    "bg-[var(--ag-preset-orange-bg)] text-[var(--ag-preset-orange-text)]",
    "bg-[var(--ag-preset-green-bg)] text-[var(--ag-preset-green-text)]",
    "bg-[var(--ag-preset-red-bg)] text-[var(--ag-preset-red-text)]",
    "bg-muted text-foreground",
] as const

export const toneAt = (index: number) => ONBOARDING_TONES[index % ONBOARDING_TONES.length]

export interface OnboardingChoice<Label extends string> {
    label: Label
    icon: Icon
}

export const ONBOARDING_ROLES = [
    {label: "Engineering", icon: Code},
    {label: "Product", icon: Lightbulb},
    {label: "Sales", icon: Target},
    {label: "Marketing", icon: Megaphone},
    {label: "Customer support", icon: Headset},
    {label: "Operations", icon: GearSix},
    {label: "Data & analytics", icon: ChartBar},
    {label: "Founder / Executive", icon: Briefcase},
    {label: "Something else", icon: DotsThree},
] as const satisfies readonly OnboardingChoice<string>[]

export type OnboardingRole = (typeof ONBOARDING_ROLES)[number]["label"]

export const ONBOARDING_SOURCES = [
    {label: "GitHub", icon: GithubLogo},
    {label: "Online search", icon: MagnifyingGlass},
    {label: "AI assistant", icon: Sparkle},
    {label: "Social media", icon: XLogo},
    {label: "Friend or colleague", icon: Users},
    {label: "Blog or publication", icon: Newspaper},
    {label: "Reddit", icon: RedditLogo},
    {label: "Other", icon: DotsThree},
] as const satisfies readonly OnboardingChoice<string>[]

export type OnboardingSource = (typeof ONBOARDING_SOURCES)[number]["label"]

/** Roles whose templates live under another catalog category; the rest match by name. */
const ROLE_CATEGORY: Partial<Record<OnboardingRole, string>> = {
    "Customer support": "Support",
    Operations: "Ops",
    Marketing: "Knowledge",
    Product: "Knowledge",
    "Founder / Executive": "Ops",
    "Data & analytics": "Ops",
}

export const suggestionsForRole = (
    templates: readonly AgentStarterTemplate[],
    role: OnboardingRole | null,
): AgentStarterTemplate[] =>
    role
        ? templates
              .filter((template) => template.category === (ROLE_CATEGORY[role] ?? role))
              .slice(0, 5)
        : []

/** Task-first phrasing for the templates whose names do not already read as a task. */
const TASK_TITLES: Record<string, string> = {
    "PR reviewer": "Review my open pull requests",
    "Issue triage": "Triage new issues",
    "CI failure triage": "Explain CI failures",
    "Changelog writer": "Write this week's changelog",
}

export const taskTitle = (template: AgentStarterTemplate): string =>
    TASK_TITLES[template.name] ?? template.example?.prompt ?? template.name

export const FIRST_AGENT_FALLBACK_NAME = "My first agent"

export interface FirstAgentInput {
    name: string
    seedMessage: string
}

/** What Create commits; name-first needs only a name, task-first needs a task. */
export const firstAgentInput = (
    variant: OnboardingVariant,
    {name, task}: {name: string; task: string},
    template: AgentStarterTemplate | null | undefined,
): FirstAgentInput | null => {
    const typedName = name.trim()
    const seedMessage =
        task.trim() ||
        (template
            ? templateBuilderMessage(template)
            : variant === "control" && typedName
              ? `Set up ${typedName}: help me define what this agent should do.`
              : "")
    const agentName =
        variant === "control" ? typedName : (template?.name ?? FIRST_AGENT_FALLBACK_NAME)
    return agentName && seedMessage ? {name: agentName, seedMessage} : null
}

/** The selectable card every onboarding step uses. */
export const choiceCardClass = (active: boolean) =>
    `box-border cursor-pointer rounded-xl border border-solid p-4 text-left text-foreground transition-colors ${
        active ? "border-foreground bg-accent" : "border-border bg-background hover:bg-accent"
    }`

/** The template catalog as the flow reads it; `templates` is empty until it succeeds. */
export interface OnboardingCatalog {
    templates: AgentStarterTemplate[]
    status: AgentTemplatesStatus
    retry: () => void
}
