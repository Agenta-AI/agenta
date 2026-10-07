import type {AgentStarterTemplate, AgentTemplatesStatus} from "@agenta/entities/workflow"
import {
    Code,
    Cube,
    CurrencyCircleDollar,
    DotsThree,
    Flask,
    GearSix,
    GithubLogo,
    GoogleLogo,
    Handshake,
    Hash,
    Lifebuoy,
    LinkedinLogo,
    Megaphone,
    Microphone,
    Newspaper,
    OpenAiLogo,
    PenNib,
    RedditLogo,
    RocketLaunch,
    Scales,
    Users,
    XLogo,
    YoutubeLogo,
    type Icon,
} from "@phosphor-icons/react"

/** One key per chip, in order; a question has at most this many answers. */
export const CHOICE_KEYS = "ABCDEFGHIJKL"

export interface OnboardingChoice<Label extends string> {
    label: Label
    icon: Icon
}

export const ONBOARDING_ROLES = [
    {label: "Engineering", icon: Code},
    {label: "Product", icon: Cube},
    {label: "Design", icon: PenNib},
    {label: "Sales", icon: Handshake},
    {label: "Marketing", icon: Megaphone},
    {label: "Customer support", icon: Lifebuoy},
    {label: "Operations", icon: GearSix},
    {label: "Finance", icon: CurrencyCircleDollar},
    {label: "Legal", icon: Scales},
    {label: "Founder or exec", icon: RocketLaunch},
    {label: "Research", icon: Flask},
    {label: "Other", icon: DotsThree},
] as const satisfies readonly OnboardingChoice<string>[]

export type OnboardingRole = (typeof ONBOARDING_ROLES)[number]["label"]

export const ONBOARDING_SOURCES = [
    {label: "Google search", icon: GoogleLogo},
    {label: "ChatGPT or Claude", icon: OpenAiLogo},
    {label: "X", icon: XLogo},
    {label: "LinkedIn", icon: LinkedinLogo},
    {label: "YouTube", icon: YoutubeLogo},
    {label: "Reddit", icon: RedditLogo},
    {label: "GitHub", icon: GithubLogo},
    {label: "Hacker News", icon: Hash},
    {label: "Friend or colleague", icon: Users},
    {label: "Newsletter or blog", icon: Newspaper},
    {label: "Podcast", icon: Microphone},
    {label: "Other", icon: DotsThree},
] as const satisfies readonly OnboardingChoice<string>[]

export type OnboardingSource = (typeof ONBOARDING_SOURCES)[number]["label"]

/** The catalog category whose templates each role sees first; unlisted roles get no preference. */
const ROLE_CATEGORY: Partial<Record<OnboardingRole, string>> = {
    Engineering: "Engineering",
    Product: "Engineering",
    Design: "Engineering",
    Research: "Knowledge",
    Sales: "Sales",
    Marketing: "Sales",
    "Customer support": "Support",
    Operations: "Ops",
    Finance: "Ops",
    Legal: "Ops",
    "Founder or exec": "Ops",
}

export const RECOMMENDED = "recommended"
export const ALL = "all"
/** A gallery chip: the recommended slice, every template, or one catalog category. */
export type GalleryCategory = typeof RECOMMENDED | typeof ALL | string

const RECOMMENDED_COUNT = 6

/** The templates a chip shows; Recommended leads with the role's category. */
export const galleryTemplates = (
    templates: readonly AgentStarterTemplate[],
    category: GalleryCategory,
    role: OnboardingRole | null,
): AgentStarterTemplate[] => {
    if (category === ALL) return [...templates]
    if (category !== RECOMMENDED) return templates.filter((item) => item.category === category)
    const preferred = role ? ROLE_CATEGORY[role] : undefined
    const first = templates.filter((item) => item.category === preferred)
    const rest = templates.filter((item) => item.category !== preferred)
    return [...first, ...rest].slice(0, RECOMMENDED_COUNT)
}

/** A glyph from the agent-icon catalog for each category, so a template brings a face. */
const CATEGORY_GLYPH: Record<string, string> = {
    Engineering: "code",
    Support: "lifebuoy",
    Sales: "handshake",
    Knowledge: "books",
    Ops: "gear",
}

/** A glyph per known catalog template; a template not listed takes its category's. */
const TEMPLATE_GLYPH: Record<string, string> = {
    "pr-reviewer": "git-pull-request",
    "changelog-writer": "books",
    "issue-triage": "bug",
    "ci-failure-triage": "terminal-window",
    "code-qa": "code",
    "dependency-digest": "package",
    "support-triage": "lifebuoy",
    "support-reply-drafter": "chats-circle",
    "bug-report-router": "bug",
    "feedback-clusterer": "chart-pie-slice",
    "lead-qualifier": "funnel",
    "crm-updater": "address-book",
    "outreach-drafter": "paper-plane-tilt",
    "meeting-followup": "microphone",
    "pipeline-digest": "chart-line-up",
    "incident-responder": "bell-ringing",
    "error-triage": "warning",
    "uptime-reporter": "heartbeat",
    "oncall-briefer": "clipboard-text",
    "docs-qa": "magnifying-glass",
    "knowledge-chatbot": "chat-circle",
    "onboarding-buddy": "hand-waving",
    "content-repurposer": "megaphone",
    "newsletter-drafter": "envelope-open",
    "standup-summarizer": "list-checks",
    "repo-slack-digest": "git-commit",
    "cross-tool-sync": "share-network",
    "weekly-report": "presentation-chart",
}

export const templateGlyph = (template: AgentStarterTemplate) =>
    TEMPLATE_GLYPH[template.key] ?? CATEGORY_GLYPH[template.category] ?? "robot"

/** The catalog's category names, as the gallery chips say them. */
const CATEGORY_LABEL: Record<string, string> = {Ops: "Operations"}

export const categoryLabel = (category: string) => CATEGORY_LABEL[category] ?? category

/** The glyphs a blank agent can wear, in the design's order (catalog names). */
export const ICON_CHOICES = [
    "robot",
    "sparkle",
    "lightning",
    "brain",
    "code",
    "bug",
    "git-pull-request",
    "terminal-window",
    "lifebuoy",
    "chats-circle",
    "envelope-open",
    "calendar-blank",
    "books",
    "clipboard-text",
    "chart-line-up",
    "presentation-chart",
    "magnifying-glass",
    "globe",
    "handshake",
    "megaphone",
    "rocket",
    "shield",
    "database",
    "microphone",
]

/** Apps the creator offers when no template names any; slugs match the tool catalog. */
export const SUGGESTED_APPS = [
    "slack",
    "gmail",
    "github",
    "notion",
    "googledrive",
    "googlecalendar",
    "linear",
    "hubspot",
]

export const FIRST_MESSAGE_STARTERS = [
    "Summarize my unread email from today",
    "Draft a weekly update for my team",
    "Plan my week from my calendar",
    "Research a company and write a one-page brief",
    "Turn my meeting notes into action items",
    "Review my open pull requests",
    "Draft replies to my support inbox",
    "Find time for a 30-minute meeting next week",
    "Summarize this week's Slack threads",
    "Write release notes from merged PRs",
]

/** The template catalog as the flow reads it; `templates` is empty until it succeeds. */
export interface OnboardingCatalog {
    templates: AgentStarterTemplate[]
    status: AgentTemplatesStatus
    retry: () => void
}
