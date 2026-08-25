/**
 * THE templates gallery — the category rail, the search box and the sectioned card grid over the
 * shared starter catalogue. Extracted from the desktop's gallery page (which now renders this), so
 * every app browses templates with the same filtering, the same sections and the same cards.
 *
 * The host keeps what only it can decide: its page chrome (breadcrumbs, layout), whether the active
 * category lives in the URL, and what selecting a template DOES — the desktop opens a detail page,
 * a surface without one creates from it directly.
 *
 * Two frames, chosen by `layout`. The default `"toolbar"` is one surface: the host's page chrome
 * names the page, and categories are a narrow column beside the search box and the grid, with no
 * rail and no divider. `"rail"` is the browse-rail variant — the shared `FilterRailLayout`, where
 * the title, search and facets live in the RAIL and cannot scroll away from the results, and below
 * `lg` the rail stacks above the grid with its categories as a horizontal chip row.
 */
import {useDeferredValue, useMemo, useState, type ReactNode} from "react"

import {
    AGENT_TEMPLATES,
    ALL_TEMPLATES_CATEGORY,
    templateCategories,
    type AgentStarterTemplate,
} from "@agenta/entities/workflow"
import {FilterRailLayout} from "@agenta/ui/components/presentational"
import {SearchInput} from "@agenta/ui/ui"

import {TemplateCard} from "./TemplateCard"
import {TEMPLATE_GALLERY_COPY} from "./templateGalleryCopy"

export interface TemplateGalleryProps {
    /** Controlled so a host can keep it in the URL (the desktop does). */
    category: string
    onCategoryChange: (category: string) => void
    onSelectTemplate: (template: AgentStarterTemplate) => void
    /**
     * Before the title — a surface with no page chrome of its own puts its nav entry here (mobile's
     * drawer trigger), instead of a second bar that repeats this title. `"rail"` only: the toolbar
     * frame has no title row of its own to put it in, because the host's page header owns it.
     */
    leading?: ReactNode
    /** `"rail"` only — the toolbar frame leaves the title and subtitle to the host's page header. */
    title?: string
    subtitle?: string
    searchPlaceholder?: string
    className?: string
    /**
     * The frame. `"toolbar"` (the default) renders no rail and no title block — the host's page
     * chrome names the page — and puts the categories in a narrow column beside search and grid.
     * `"rail"` is the `FilterRailLayout` variant, which names the page itself (`leading`, `title`,
     * `subtitle`); mobile uses it unconditionally, having no page header of its own.
     */
    layout?: "toolbar" | "rail"
}

/** True when the template matches the search query across title, description and category. */
const matchesQuery = (template: AgentStarterTemplate, query: string) => {
    if (!query) return true
    const haystack = `${template.name} ${template.description} ${template.category}`.toLowerCase()
    return haystack.includes(query)
}

/** One category block: uppercase header + per-section count, then the card grid. */
const TemplateSection = ({
    category,
    templates,
    onSelectTemplate,
}: {
    category: string
    templates: AgentStarterTemplate[]
    onSelectTemplate: (template: AgentStarterTemplate) => void
}) => {
    if (templates.length === 0) return null

    return (
        <section className="flex flex-col gap-3">
            {/* Pinned while its own cards scroll past, so a long catalogue never leaves you
                without the category you are looking at. `pt-6` is the section's top inset,
                carried HERE rather than on the scroller: a scroll container's padding-top
                offsets its sticky children and cards then bleed through the band above. */}
            <div className="sticky top-0 z-10 flex items-center justify-between gap-3 border-x-0 border-t-0 border-b border-solid border-colorBorderSecondary bg-colorBgContainer pb-2 pt-6">
                <span className="text-xs font-bold uppercase tracking-[0.06em] text-colorTextSecondary">
                    {category}
                </span>
                <span className="shrink-0 text-xs text-colorTextTertiary">
                    {templates.length} {templates.length === 1 ? "template" : "templates"}
                </span>
            </div>

            {/* `pt-5` is the room the card's overhanging monogram needs — it belongs to the grid,
                not to each card, so every cell in a row still starts at the same y. */}
            <div className="grid grid-cols-1 gap-x-4 gap-y-10 pt-5 sm:grid-cols-2 xl:grid-cols-3">
                {templates.map((template) => (
                    <TemplateCard
                        key={template.key}
                        template={template}
                        onSelect={onSelectTemplate}
                    />
                ))}
            </div>
        </section>
    )
}

export const TemplateGallery = ({
    category,
    onCategoryChange,
    onSelectTemplate,
    leading,
    title = TEMPLATE_GALLERY_COPY.title,
    subtitle = TEMPLATE_GALLERY_COPY.subtitle,
    searchPlaceholder = TEMPLATE_GALLERY_COPY.searchPlaceholder,
    className,
    layout = "toolbar",
}: TemplateGalleryProps) => {
    const categories = useMemo(() => templateCategories(), [])
    const [query, setQuery] = useState("")
    const deferredQuery = useDeferredValue(query.trim().toLowerCase())

    // Rail items: All + each present category with a count.
    const railItems = useMemo(
        () => [
            {value: ALL_TEMPLATES_CATEGORY, label: "All", count: AGENT_TEMPLATES.length},
            ...categories.map((item) => ({
                value: item,
                label: item,
                count: AGENT_TEMPLATES.filter((template) => template.category === item).length,
            })),
        ],
        [categories],
    )

    // All → every present category; otherwise just the active one.
    const sections = useMemo(() => {
        const visible = category === ALL_TEMPLATES_CATEGORY ? categories : [category]
        return visible.map((item) => ({
            category: item,
            templates: AGENT_TEMPLATES.filter(
                (template) => template.category === item && matchesQuery(template, deferredQuery),
            ),
        }))
    }, [categories, category, deferredQuery])

    const resultCount = sections.reduce((sum, section) => sum + section.templates.length, 0)
    const hasQuery = deferredQuery.length > 0

    /** The grid, or why it is empty. The same in both frames — only the empty card's top inset
     * differs, since the rail frame has no search box above it to space against. */
    const renderResults = (emptyInset = false) =>
        resultCount === 0 ? (
            <div
                className={`flex flex-col items-center gap-3 rounded-lg border border-dashed border-colorBorder px-6 py-12 text-center${
                    emptyInset ? " mt-6" : ""
                }`}
            >
                <span className="text-xs text-colorTextSecondary">
                    {hasQuery
                        ? `No templates match "${query.trim()}".`
                        : `No templates in ${category}.`}
                </span>
                <button
                    type="button"
                    onClick={() => {
                        setQuery("")
                        onCategoryChange(ALL_TEMPLATES_CATEGORY)
                    }}
                    className="cursor-pointer border-0 bg-transparent p-0 text-xs font-medium text-colorPrimary"
                >
                    {hasQuery ? "Clear search" : "Show all templates"}
                </button>
            </div>
        ) : (
            sections.map((section) => (
                <TemplateSection
                    key={section.category}
                    category={section.category}
                    templates={section.templates}
                    onSelectTemplate={onSelectTemplate}
                />
            ))
        )

    if (layout === "toolbar") {
        // Filters and grid share the page's own background — one surface, no rail, no divider —
        // so the whole page reads as a single column of content.
        return (
            <div
                className={`flex min-h-0 w-full flex-1 flex-col gap-6 lg:flex-row lg:gap-10${
                    className ? ` ${className}` : ""
                }`}
            >
                <nav className="flex shrink-0 flex-col gap-0.5 lg:w-[180px]">
                    {railItems.map((item) => (
                        <button
                            key={item.value}
                            type="button"
                            aria-current={item.value === category}
                            onClick={() => onCategoryChange(item.value)}
                            className={`box-border flex w-full cursor-pointer items-center gap-2 rounded-lg border-0 px-3 py-2 text-left text-sm transition-colors focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-colorPrimary ${
                                item.value === category
                                    ? "bg-colorFillSecondary text-colorText"
                                    : "bg-transparent text-colorTextSecondary hover:bg-colorFillQuaternary"
                            }`}
                        >
                            <span className="min-w-0 flex-1 truncate">{item.label}</span>
                            <span className="shrink-0 text-xs text-colorTextTertiary">
                                {item.count}
                            </span>
                        </button>
                    ))}
                </nav>

                {/* One scroller: the sections wrapper below scrolls, so search stays pinned.
                    `min-w-0`: a flex child defaults to min-width:auto, so at `lg` the grid's
                    min-content width would push this column past the row and clip the cards. */}
                <div className="flex min-h-0 w-full min-w-0 flex-1 flex-col gap-5">
                    <SearchInput
                        value={query}
                        onValueChange={setQuery}
                        placeholder={searchPlaceholder}
                        className="w-full sm:w-[320px]"
                    />
                    {resultCount === 0 ? (
                        renderResults()
                    ) : (
                        <div className="flex min-h-0 flex-1 flex-col gap-2 overflow-y-auto pb-2 pr-1">
                            {renderResults()}
                        </div>
                    )}
                </div>
            </div>
        )
    }

    return (
        <FilterRailLayout
            className={className}
            // No `pt` here — the section headers pin at the scrollport top and carry it themselves.
            contentClassName="gap-2 overflow-y-auto px-6 pb-6 lg:px-10"
            rail={
                <>
                    <div className="flex min-w-0 flex-col gap-1.5">
                        <div className="flex min-w-0 items-center gap-2">
                            {leading}
                            <h1 className="m-0 min-w-0 flex-1 truncate text-[24px] font-semibold leading-tight text-colorText">
                                {title}
                            </h1>
                        </div>
                        <p className="m-0 text-[13px] text-colorTextSecondary">{subtitle}</p>
                    </div>

                    {/* SearchInput IS the kit's prefixed+clearable input — `onValueChange` also
                        fires on clear, so nothing has to fake a change event. */}
                    <SearchInput
                        value={query}
                        onValueChange={setQuery}
                        placeholder={searchPlaceholder}
                    />

                    {/* Horizontal chips until lg, where the rail becomes a sidebar column. */}
                    <nav className="flex flex-row gap-1.5 overflow-x-auto lg:flex-col lg:gap-0.5 lg:overflow-visible">
                        {railItems.map((item) => (
                            <button
                                key={item.value}
                                type="button"
                                onClick={() => onCategoryChange(item.value)}
                                className={`box-border flex shrink-0 cursor-pointer items-center gap-2 rounded-lg border-0 px-3 py-2 text-left text-sm transition-colors lg:w-full ${
                                    item.value === category
                                        ? "bg-colorFillSecondary text-colorText"
                                        : "bg-transparent text-colorTextSecondary hover:bg-colorFillQuaternary"
                                }`}
                            >
                                <span className="min-w-0 flex-1 truncate">{item.label}</span>
                                <span className="shrink-0 text-xs text-colorTextTertiary">
                                    {item.count}
                                </span>
                            </button>
                        ))}
                    </nav>
                </>
            }
        >
            {renderResults(true)}
        </FilterRailLayout>
    )
}
