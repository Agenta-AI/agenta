import type {CatalogKey} from "@agenta/i18n"
import type educationGuidesCatalog from "@agenta/i18n/catalogs/education.guides"
import type navigationCatalog from "@agenta/i18n/catalogs/navigation"
import {
    ChatCircle,
    Chats,
    Clock,
    Compass,
    Lightning,
    MagnifyingGlass,
    NotePencil,
    Plug,
    Robot,
    TerminalWindow,
    type Icon,
} from "@phosphor-icons/react"

type GuideKey = CatalogKey<typeof educationGuidesCatalog>

/** What each empty page's onboarding says; templates are agent-template catalog keys. */

export type FeatureGuideKey = "agents" | "automations" | "skills" | "sessions"

export interface GuideVideo {
    /** The clip's id on its host: a Cloudflare Stream id, or a YouTube video id. */
    id: string
    /** Where the clip lives; Cloudflare Stream when absent. */
    source?: "stream" | "youtube"
    /** The player's accessible name. */
    title: string
    /** Where the banner still is taken (Stream only); playback always starts at 0. */
    stillSeconds: number
}

/** What the walkthrough lightbox shows: a page's clip, its headline and its docs. */
export interface Walkthrough {
    title: string
    headline: string
    docsUrl: string
    video: GuideVideo
}

export interface FeatureGuide {
    /** The page's own name; the banner's pill reads "{title} walkthrough". */
    title: CatalogKey<typeof navigationCatalog>
    headline: GuideKey
    body: GuideKey
    /** The populated page's button back to the walkthrough. */
    howItWorks: GuideKey
    docsUrl: string
    /** Absent until the page has its own walkthrough clip. */
    video?: GuideVideo
    /** The banner's illustration when there is no video: the feature flanked by two related ones. */
    icons: {main: Icon; left: Icon; right: Icon}
    /** Agent-template catalog keys, in display order. */
    templateKeys: readonly string[]
}

export const FEATURE_GUIDES: Record<FeatureGuideKey, FeatureGuide> = {
    agents: {
        title: "navigation.items.agents",
        headline: "education.guides.agentsHeadline",
        body: "education.guides.agentsBody",
        howItWorks: "education.guides.agentsHowItWorks",
        docsUrl: "https://agenta.ai/docs/concepts/agents",
        icons: {main: Robot, left: ChatCircle, right: Plug},
        templateKeys: ["code-qa", "knowledge-chatbot", "outreach-drafter"],
    },
    automations: {
        title: "navigation.items.automations",
        headline: "education.guides.automationsHeadline",
        body: "education.guides.automationsBody",
        howItWorks: "education.guides.automationsHowItWorks",
        docsUrl: "https://agenta.ai/docs/concepts/automations",
        icons: {main: Lightning, left: Clock, right: Robot},
        templateKeys: ["pr-reviewer", "changelog-writer", "issue-triage"],
    },
    skills: {
        title: "navigation.items.skills",
        headline: "education.guides.skillsHeadline",
        body: "education.guides.skillsBody",
        howItWorks: "education.guides.skillsHowItWorks",
        docsUrl: "https://agenta.ai/docs/concepts/skills",
        icons: {main: Compass, left: NotePencil, right: TerminalWindow},
        templateKeys: [],
    },
    sessions: {
        title: "navigation.items.sessions",
        headline: "education.guides.sessionsHeadline",
        body: "education.guides.sessionsBody",
        howItWorks: "education.guides.sessionsHowItWorks",
        docsUrl: "https://agenta.ai/docs/reference/agents/sessions-and-turns",
        icons: {main: Chats, left: Robot, right: MagnifyingGlass},
        templateKeys: ["standup-summarizer", "meeting-followup", "weekly-report"],
    },
}
