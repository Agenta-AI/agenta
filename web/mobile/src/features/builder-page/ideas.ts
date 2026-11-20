import type {ComponentType} from "react"

import type {CatalogKey} from "@agenta/i18n"
import type builderPageCatalog from "@agenta/i18n/catalogs/builder.page"

export type PageKey = CatalogKey<typeof builderPageCatalog>

/** A glyph of an idea, a category or a quick action: a Phosphor icon or the Builder mark. */
export type Glyph = ComponentType<{size?: number; className?: string}>

/** The categories of "Browse ideas" (B02), after "All". */
export const IDEA_CATEGORIES = [
    "gettingStarted",
    "support",
    "sales",
    "operations",
    "engineering",
    "improve",
    "test",
    "automations",
] as const
export type IdeaCategory = (typeof IDEA_CATEGORIES)[number]

export const CATEGORY_LABELS: Record<IdeaCategory | "all", PageKey> = {
    all: "builder.page.catAll",
    gettingStarted: "builder.page.catGettingStarted",
    support: "builder.page.catSupport",
    sales: "builder.page.catSales",
    operations: "builder.page.catOperations",
    engineering: "builder.page.catEngineering",
    improve: "builder.page.catImprove",
    test: "builder.page.catTest",
    automations: "builder.page.catAutomations",
}

/** One ready prompt: its title and the request it puts in the composer. */
export interface Idea {
    category: IdeaCategory
    title: PageKey
    prompt: PageKey
}

const idea = (category: IdeaCategory, title: PageKey, prompt: PageKey): Idea => ({
    category,
    title,
    prompt,
})

/** The ready prompts, in the order of the prototype (BEHAVIOR 6). */
export const IDEAS: readonly Idea[] = [
    idea("gettingStarted", "builder.page.ideaFirstAgent", "builder.page.ideaFirstAgentPrompt"),
    idea("gettingStarted", "builder.page.ideaWhatCan", "builder.page.ideaWhatCanPrompt"),
    idea("gettingStarted", "builder.page.ideaTemplate", "builder.page.ideaTemplatePrompt"),
    idea("support", "builder.page.ideaTriage", "builder.page.ideaTriagePrompt"),
    idea("support", "builder.page.ideaHelpCenter", "builder.page.ideaHelpCenterPrompt"),
    idea("sales", "builder.page.ideaLeads", "builder.page.ideaLeadsPrompt"),
    idea("sales", "builder.page.ideaFirstEmails", "builder.page.ideaFirstEmailsPrompt"),
    idea("operations", "builder.page.ideaWeeklyReport", "builder.page.ideaWeeklyReportPrompt"),
    idea("operations", "builder.page.ideaInvoices", "builder.page.ideaInvoicesPrompt"),
    idea("engineering", "builder.page.ideaGithub", "builder.page.ideaGithubPrompt"),
    idea("engineering", "builder.page.ideaFailedRuns", "builder.page.ideaFailedRunsPrompt"),
    idea("improve", "builder.page.ideaShorter", "builder.page.ideaShorterPrompt"),
    idea("improve", "builder.page.ideaFixSession", "builder.page.ideaFixSessionPrompt"),
    idea("test", "builder.page.ideaRealExamples", "builder.page.ideaRealExamplesPrompt"),
    idea("test", "builder.page.ideaCompare", "builder.page.ideaComparePrompt"),
    idea("automations", "builder.page.ideaSchedule", "builder.page.ideaSchedulePrompt"),
    idea("automations", "builder.page.ideaAppEvent", "builder.page.ideaAppEventPrompt"),
]

/** The ideas of `category` whose title or prompt holds `search`, ignoring case. */
export const filterIdeas = <T extends {category: IdeaCategory; title: string; prompt: string}>(
    ideas: readonly T[],
    category: IdeaCategory | "all",
    search: string,
) => {
    const query = search.trim().toLowerCase()
    return ideas.filter(
        (entry) =>
            (category === "all" || entry.category === category) &&
            (!query ||
                entry.title.toLowerCase().includes(query) ||
                entry.prompt.toLowerCase().includes(query)),
    )
}
