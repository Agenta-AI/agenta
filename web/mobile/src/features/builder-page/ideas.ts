import type {CatalogKey} from "@agenta/i18n"
import type builderPageCatalog from "@agenta/i18n/catalogs/builder.page"

export type PageKey = CatalogKey<typeof builderPageCatalog>

/** The categories of "More ideas", after "All", in the order of the ideas. */
export const IDEA_CATEGORIES = [
    "gettingStarted",
    "forClients",
    "sales",
    "operations",
    "marketing",
    "forAgency",
    "support",
] as const
export type IdeaCategory = (typeof IDEA_CATEGORIES)[number]

export const CATEGORY_LABELS: Record<IdeaCategory | "all", PageKey> = {
    all: "builder.page.catAll",
    gettingStarted: "builder.page.catGettingStarted",
    forClients: "builder.page.catForClients",
    sales: "builder.page.catSales",
    operations: "builder.page.catOperations",
    marketing: "builder.page.catMarketing",
    forAgency: "builder.page.catForAgency",
    support: "builder.page.catSupport",
}

/** One ready prompt: its title, the short line under it and the request it puts in the composer. */
export interface Idea {
    category: IdeaCategory
    title: PageKey
    line: PageKey
    prompt: PageKey
}

const idea = (category: IdeaCategory, title: PageKey, line: PageKey, prompt: PageKey): Idea => ({
    category,
    title,
    line,
    prompt,
})

/** The ready prompts, from the agency use cases. */
export const IDEAS: readonly Idea[] = [
    idea(
        "gettingStarted",
        "builder.page.ideaFirstAgent",
        "builder.page.ideaFirstAgentLine",
        "builder.page.ideaFirstAgentPrompt",
    ),
    idea(
        "gettingStarted",
        "builder.page.ideaTemplate",
        "builder.page.ideaTemplateLine",
        "builder.page.ideaTemplatePrompt",
    ),
    idea(
        "forClients",
        "builder.page.ideaQuotes",
        "builder.page.ideaQuotesLine",
        "builder.page.ideaQuotesPrompt",
    ),
    idea(
        "forClients",
        "builder.page.ideaCustomerQuestions",
        "builder.page.ideaCustomerQuestionsLine",
        "builder.page.ideaCustomerQuestionsPrompt",
    ),
    idea(
        "sales",
        "builder.page.ideaLeadReplies",
        "builder.page.ideaLeadRepliesLine",
        "builder.page.ideaLeadRepliesPrompt",
    ),
    idea(
        "operations",
        "builder.page.ideaInvoicesForms",
        "builder.page.ideaInvoicesFormsLine",
        "builder.page.ideaInvoicesFormsPrompt",
    ),
    idea(
        "marketing",
        "builder.page.ideaSocialPosts",
        "builder.page.ideaSocialPostsLine",
        "builder.page.ideaSocialPostsPrompt",
    ),
    idea(
        "forAgency",
        "builder.page.ideaClientReport",
        "builder.page.ideaClientReportLine",
        "builder.page.ideaClientReportPrompt",
    ),
    idea(
        "forAgency",
        "builder.page.ideaProposals",
        "builder.page.ideaProposalsLine",
        "builder.page.ideaProposalsPrompt",
    ),
    idea(
        "support",
        "builder.page.ideaSupportReplies",
        "builder.page.ideaSupportRepliesLine",
        "builder.page.ideaSupportRepliesPrompt",
    ),
    idea(
        "sales",
        "builder.page.ideaProspectList",
        "builder.page.ideaProspectListLine",
        "builder.page.ideaProspectListPrompt",
    ),
    idea(
        "sales",
        "builder.page.ideaFollowUp",
        "builder.page.ideaFollowUpLine",
        "builder.page.ideaFollowUpPrompt",
    ),
]

/** The ideas of `category` whose title, line or prompt holds `search`, ignoring case. */
export const filterIdeas = <
    T extends {category: IdeaCategory; title: string; line: string; prompt: string},
>(
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
                entry.line.toLowerCase().includes(query) ||
                entry.prompt.toLowerCase().includes(query)),
    )
}
