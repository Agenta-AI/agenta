import {
    ALL_TEMPLATES_CATEGORY,
    PROVIDERS,
    categorySlug,
    templateCategories,
    templateProviderSlugs,
    type AgentStarterTemplate,
} from "@agenta/entities/workflow"
import {createT, formatLocale, type CatalogKey} from "@agenta/i18n"
import marketplaceCatalog from "@agenta/i18n/catalogs/marketplace.page"

const tNow = createT(marketplaceCatalog)

type MarketplaceKey = CatalogKey<typeof marketplaceCatalog>

const CATEGORY_KEYS: Record<string, MarketplaceKey> = {
    [ALL_TEMPLATES_CATEGORY]: "marketplace.page.categoryAll",
    Engineering: "marketplace.page.categoryEngineering",
    Support: "marketplace.page.categorySupport",
    Sales: "marketplace.page.categorySales",
    Knowledge: "marketplace.page.categoryKnowledge",
    Marketing: "marketplace.page.categoryMarketing",
    Ops: "marketplace.page.categoryOps",
}

/** A category as the page shows it; the value stays the catalog's English name. */
export const categoryText = (category: string): string => {
    const key = Object.hasOwn(CATEGORY_KEYS, category) ? CATEGORY_KEYS[category] : undefined
    return key ? tNow(key) : category
}

/** "GitHub, Linear and Slack" or "GitHub or GitLab"; Intl lists outside English. */
const joinList = (names: string[], type: "conjunction" | "disjunction"): string => {
    const locale = formatLocale()
    if (locale) return new Intl.ListFormat(locale, {type}).format(names)
    if (type === "disjunction") return names.join(" or ")
    return names.length > 1
        ? `${names.slice(0, -1).join(", ")} and ${names[names.length - 1]}`
        : (names[0] ?? "")
}

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
        ? tNow("marketplace.page.stepWhen")
        : [
              tNow("marketplace.page.stepNumber", {number: step.number}),
              step.app.name,
              step.optional ? tNow("marketplace.page.optional") : null,
          ]
              .filter(Boolean)
              .join(" · ")

/** A step's sentence. Catalog roles mostly omit the closing period; some already end in one. */
export const howStepText = (step: HowStep): string => {
    if (step.kind === "trigger") return step.text
    const role = step.role.trim()
    return /[.!?]$/.test(role) ? role : `${role}.`
}

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
            label: joinList(
                apps.map((app) => app.name),
                "disjunction",
            ),
            required: slot.required,
        }
    })

export interface SetupStep {
    key: "use" | "connect" | "try"
    title: string
    text: string
}

/** What using a template leads to on this app: the agent, its first session, then its accounts. */
export const setupSteps = (template: AgentStarterTemplate): SetupStep[] => {
    const names = [
        ...new Set(template.connections.map((slot) => templateApp(slot.primary.slug).name)),
    ]
    return [
        {
            key: "use" as const,
            title: tNow("marketplace.page.useTemplate"),
            text: tNow("marketplace.page.setupUseText"),
        },
        ...(names.length
            ? [
                  {
                      key: "connect" as const,
                      title: tNow("marketplace.page.setupConnectTitle", {
                          apps: joinList(names, "conjunction"),
                      }),
                      text: tNow("marketplace.page.setupConnectText"),
                  },
              ]
            : []),
        {
            key: "try" as const,
            title: tNow("marketplace.page.setupTryTitle"),
            text: tNow("marketplace.page.setupTryText"),
        },
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

export const SORT_LABELS: Record<MarketplaceSort, MarketplaceKey> = {
    recommended: "marketplace.page.sortRecommended",
    az: "marketplace.page.sortAz",
    "fewest-apps": "marketplace.page.sortFewestApps",
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
