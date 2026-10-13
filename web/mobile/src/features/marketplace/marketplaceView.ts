import {
    ALL_TEMPLATES_CATEGORY,
    PROVIDERS,
    categorySlug,
    templateCategories,
    templateProviderSlugs,
    type AgentStarterTemplate,
} from "@agenta/entities/workflow"

/** An app a template connects, as a tile draws it. */
export interface TemplateApp {
    slug: string
    name: string
    logo?: string
}

export const templateApp = (slug: string): TemplateApp => ({
    slug,
    name: PROVIDERS[slug]?.label ?? slug,
    logo: PROVIDERS[slug]?.logo,
})

/** THE app set of a template: every provider, in slot order, primary then alternatives, once. */
export const templateProviders = (template: AgentStarterTemplate): TemplateApp[] =>
    templateProviderSlugs(template).map(templateApp)

/** The canonical categories first, then any the catalog adds, in first-seen order. */
export const catalogCategories = (all: readonly AgentStarterTemplate[]): string[] => {
    const canonical = templateCategories(all)
    const extra = [...new Set(all.map((t) => t.category))].filter((c) => !canonical.includes(c))
    return [...canonical, ...extra]
}

/** A `?category=` slug back to its category, else All. */
export const categoryFromParam = (
    slug: string | undefined,
    all: readonly AgentStarterTemplate[],
): string =>
    catalogCategories(all).find((category) => categorySlug(category) === slug?.toLowerCase()) ??
    ALL_TEMPLATES_CATEGORY

/** When a template runs, in words; empty for a manual-only template. */
export const triggerText = (template: AgentStarterTemplate): string =>
    template.triggerDescription || template.trigger

/** One row of "How it works": when it runs, then one step per connection slot. */
export type HowStep =
    | {kind: "trigger"; text: string}
    | {
          kind: "connection"
          number: number
          role: string
          app: TemplateApp
          scope?: string
          optional: boolean
      }

export const howItWorks = (template: AgentStarterTemplate): HowStep[] => [
    ...(triggerText(template) ? [{kind: "trigger" as const, text: triggerText(template)}] : []),
    ...template.connections.map((slot, index) => ({
        kind: "connection" as const,
        number: index + 1,
        role: slot.role,
        app: templateApp(slot.primary.slug),
        scope: slot.primary.scope,
        optional: !slot.required,
    })),
]

export const howStepKicker = (step: HowStep): string =>
    step.kind === "trigger"
        ? "When"
        : [`Step ${step.number}`, step.app.name, step.optional ? "Optional" : null]
              .filter(Boolean)
              .join(" · ")

export interface TemplateToolRow {
    name: string
    description: string
    app: TemplateApp
}

/** Every tool the primary providers grant; an alternative's tools are the same job elsewhere. */
export const templateTools = (template: AgentStarterTemplate): TemplateToolRow[] =>
    template.connections.flatMap((slot) =>
        (slot.primary.tools ?? []).map((tool) => ({
            name: tool.name,
            description: tool.description,
            app: templateApp(slot.primary.slug),
        })),
    )

/** A connection slot as the page lists it: "GitHub or GitLab", required or not. */
export interface TemplateConnect {
    key: string
    /** Every option that fills the slot, primary first. */
    apps: TemplateApp[]
    label: string
    required: boolean
}

export const templateConnects = (template: AgentStarterTemplate): TemplateConnect[] =>
    template.connections.map((slot) => {
        const apps = [slot.primary.slug, ...(slot.alternatives ?? [])].map(templateApp)
        return {
            key: slot.key,
            apps,
            label: apps.map((app) => app.name).join(" or "),
            required: slot.required,
        }
    })

/** "GitHub", "GitHub and Slack", "GitHub, Linear and Slack". */
const joinNames = (names: string[]) =>
    names.length > 1
        ? `${names.slice(0, -1).join(", ")} and ${names[names.length - 1]}`
        : (names[0] ?? "")

export interface SetupStep {
    title: string
    text: string
}

/** What using a template leads to on this app: the setup screen, then the first session. */
export const setupSteps = (template: AgentStarterTemplate): SetupStep[] => {
    const names = [
        ...new Set(template.connections.map((slot) => templateApp(slot.primary.slug).name)),
    ]
    return [
        {title: "Use this template", text: "Opens setup for a new agent in this workspace."},
        ...(names.length
            ? [
                  {
                      title: `Connect ${joinNames(names)}`,
                      text: "Each account connects from the setup screen.",
                  },
              ]
            : []),
        {title: "Try it", text: "Run it once in its first session to check the result."},
    ]
}

/** Up to three other templates from the same category, in catalog order. */
export const relatedTemplates = (
    template: AgentStarterTemplate,
    all: readonly AgentStarterTemplate[],
): AgentStarterTemplate[] =>
    all
        .filter((other) => other.key !== template.key && other.category === template.category)
        .slice(0, 3)

/** Templates with an authored example take turns in the featured card. */
export const featuredTemplates = (all: readonly AgentStarterTemplate[]): AgentStarterTemplate[] =>
    all.filter((template) => template.example).slice(0, 5)

export type MarketplaceSort = "recommended" | "az" | "fewest-apps"

export const SORT_LABELS: Record<MarketplaceSort, string> = {
    recommended: "Recommended",
    az: "A–Z",
    "fewest-apps": "Fewest apps",
}

export interface MarketplaceFilter {
    query: string
    category: string
    apps: string[]
    sort: MarketplaceSort
}

export const DEFAULT_MARKETPLACE_FILTER: MarketplaceFilter = {
    query: "",
    category: ALL_TEMPLATES_CATEGORY,
    apps: [],
    sort: "recommended",
}

export const isNarrowed = (filter: MarketplaceFilter) =>
    filter.query.trim() !== "" ||
    filter.category !== ALL_TEMPLATES_CATEGORY ||
    filter.apps.length > 0

export interface FacetCount {
    value: string
    label: string
    count: number
}

export interface AppFacet {
    app: TemplateApp
    count: number
}

export interface MarketplaceView {
    templates: AgentStarterTemplate[]
    categories: FacetCount[]
    apps: AppFacet[]
}

const searchText = (template: AgentStarterTemplate) =>
    [
        template.name,
        template.description,
        template.overview,
        template.category,
        ...templateProviders(template).map((app) => app.name),
    ]
        .join(" ")
        .toLowerCase()

const sorters: Record<
    MarketplaceSort,
    ((a: AgentStarterTemplate, b: AgentStarterTemplate) => number) | null
> = {
    recommended: null,
    az: (a, b) => a.name.localeCompare(b.name),
    "fewest-apps": (a, b) => a.connections.length - b.connections.length,
}

/** The catalog under a filter; each facet's counts ignore that facet's own selection. */
export const deriveMarketplace = (
    all: readonly AgentStarterTemplate[],
    filter: MarketplaceFilter,
): MarketplaceView => {
    const query = filter.query.trim().toLowerCase()
    const matchesQuery = (t: AgentStarterTemplate) => !query || searchText(t).includes(query)
    const matchesApps = (t: AgentStarterTemplate) =>
        filter.apps.length === 0 ||
        templateProviders(t).some((app) => filter.apps.includes(app.slug))
    const inCategory = (t: AgentStarterTemplate) =>
        filter.category === ALL_TEMPLATES_CATEGORY || t.category === filter.category

    const base = all.filter((t) => matchesQuery(t) && matchesApps(t))
    const categories: FacetCount[] = [
        {value: ALL_TEMPLATES_CATEGORY, label: "All", count: base.length},
        ...catalogCategories(all).map((category) => ({
            value: category,
            label: category,
            count: base.filter((t) => t.category === category).length,
        })),
    ]

    // Ordered by catalog-wide use, so rows stay put while the live counts change.
    const usesApp = (slug: string) => (t: AgentStarterTemplate) =>
        templateProviders(t).some((app) => app.slug === slug)
    const appBase = all.filter((t) => matchesQuery(t) && inCategory(t))
    const slugs = [...new Set(all.flatMap((t) => templateProviders(t).map((app) => app.slug)))]
    const apps = slugs
        .map((slug) => ({slug, uses: all.filter(usesApp(slug)).length}))
        .sort((a, b) => b.uses - a.uses || a.slug.localeCompare(b.slug))
        .map(({slug}) => ({app: templateApp(slug), count: appBase.filter(usesApp(slug)).length}))

    const listed = base.filter(inCategory)
    const sorter = sorters[filter.sort]
    return {templates: sorter ? listed.slice().sort(sorter) : listed, categories, apps}
}
