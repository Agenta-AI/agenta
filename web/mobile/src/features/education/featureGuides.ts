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
        /** The lightbox footer's name for the clip. */
        title: string
        /** Where the still is taken and playback starts. */
        startSeconds: number
    }
    /** Agent-template catalog keys, in display order. */
    templateKeys: readonly string[]
}

export const FEATURE_GUIDES: Record<FeatureGuideKey, FeatureGuide> = {
    agents: {
        title: "Agents",
        headline: "Build an agent by chatting with it",
        body: "You describe the work, connect the apps it needs, and improve it through feedback. Share it with your team when it works.",
        docsUrl: "https://agenta.ai/docs/concepts/agents",
        templateKeys: ["code-qa", "knowledge-chatbot", "outreach-drafter"],
    },
    automations: {
        title: "Automations",
        headline: "Put your agents to work in the background",
        body: "An automation runs one of your agents without you asking — on a schedule, or when something happens in an app you have connected.",
        docsUrl: "https://agenta.ai/docs/concepts/automations",
        video: {
            id: "f32acd7ba24a22793626d625f83498fb",
            title: "Automations in Agenta",
            startSeconds: 4,
        },
        templateKeys: ["pr-reviewer", "changelog-writer", "issue-triage"],
    },
    skills: {
        title: "Skills",
        headline: "Teach your agents how your team works",
        body: "Define your agent with AGENTS.md, skills, and MCP servers. You can bring skills and MCP servers from the agent ecosystem into Agenta.",
        docsUrl: "https://agenta.ai/docs/concepts/skills",
        templateKeys: [],
    },
    sessions: {
        title: "Sessions",
        headline: "Every conversation with an agent, in one place",
        body: "Each chat with an agent is a session. Pick one up where you left off, search across them, and inspect every model and tool call.",
        docsUrl: "https://agenta.ai/docs/reference/agents/sessions-and-turns",
        templateKeys: ["standup-summarizer", "meeting-followup", "weekly-report"],
    },
}
