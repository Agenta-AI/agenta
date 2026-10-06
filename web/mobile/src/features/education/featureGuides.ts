import {
    ChatCircle,
    Chats,
    Clock,
    GraduationCap,
    Lightning,
    MagnifyingGlass,
    NotePencil,
    Plug,
    Robot,
    TerminalWindow,
    type Icon,
} from "@phosphor-icons/react"

/** What each empty page's onboarding says; templates are agent-template catalog keys. */

export type FeatureGuideKey = "agents" | "automations" | "skills" | "sessions"

export interface FeatureGuide {
    /** The page's own name; the banner's pill reads "{title} walkthrough". */
    title: string
    headline: string
    body: string
    docsUrl: string
    /** Absent until the page has its own walkthrough clip. */
    video?: {
        /** Cloudflare Stream id of the walkthrough. */
        id: string
        /** The player's accessible name. */
        title: string
        /** Where the banner still is taken; playback always starts at 0. */
        stillSeconds: number
    }
    /** The banner's illustration when there is no video: the feature flanked by two related ones. */
    icons: {main: Icon; left: Icon; right: Icon}
    /** Agent-template catalog keys, in display order. */
    templateKeys: readonly string[]
}

export const FEATURE_GUIDES: Record<FeatureGuideKey, FeatureGuide> = {
    agents: {
        title: "Agents",
        headline: "Build an agent by chatting with it",
        body: "You describe the work, connect the apps it needs, and improve it through feedback. Share it with your team when it works.",
        docsUrl: "https://agenta.ai/docs/concepts/agents",
        icons: {main: Robot, left: ChatCircle, right: Plug},
        templateKeys: ["code-qa", "knowledge-chatbot", "outreach-drafter"],
    },
    automations: {
        title: "Automations",
        headline: "Put your agents to work in the background",
        body: "An automation runs one of your agents without you asking — on a schedule, or when something happens in an app you have connected.",
        docsUrl: "https://agenta.ai/docs/concepts/automations",
        icons: {main: Lightning, left: Clock, right: Robot},
        templateKeys: ["pr-reviewer", "changelog-writer", "issue-triage"],
    },
    skills: {
        title: "Skills",
        headline: "Teach your agents how your team works",
        body: "Define your agent with AGENTS.md, skills, and MCP servers. You can bring skills and MCP servers from the agent ecosystem into Agenta.",
        docsUrl: "https://agenta.ai/docs/concepts/skills",
        icons: {main: GraduationCap, left: NotePencil, right: TerminalWindow},
        templateKeys: [],
    },
    sessions: {
        title: "Sessions",
        headline: "Every conversation with an agent, in one place",
        body: "Each chat with an agent is a session. Pick one up where you left off, search across them, and inspect every model and tool call.",
        docsUrl: "https://agenta.ai/docs/reference/agents/sessions-and-turns",
        icons: {main: Chats, left: Robot, right: MagnifyingGlass},
        templateKeys: ["standup-summarizer", "meeting-followup", "weekly-report"],
    },
}
