import {useCallback, useDeferredValue, useEffect, useMemo, useState} from "react"

import {type SectionRailItem} from "@agenta/entity-ui"
import {PageLayout} from "@agenta/ui"
import {pageContentWidthClass} from "@agenta/ui/components/page-width"
import {Input, Typography} from "antd"
import clsx from "clsx"
import {Search} from "lucide-react"
import {useRouter} from "next/router"

import {TEMPLATES_GALLERY} from "../../assets/constants"
import {
    AGENT_TEMPLATES,
    ALL_TEMPLATES_CATEGORY,
    categoryFromSlug,
    categorySlug,
    templateCategories,
    type AgentTemplate,
} from "../../assets/templates"
import {useCreateAgentFromTemplate} from "../../hooks/useCreateAgentFromTemplate"

import TemplateSection from "./TemplateSection"

/** True when the template matches the search query across title, description and category. */
const matchesQuery = (template: AgentTemplate, query: string) => {
    if (!query) return true
    const haystack = `${template.name} ${template.description} ${template.category}`.toLowerCase()
    return haystack.includes(query)
}

/** Full templates gallery — category rail + sectioned card grid, reached from Home's "Browse all". */
const TemplatesGalleryPage = () => {
    const router = useRouter()

    const categories = useMemo(() => templateCategories(), [])
    const [active, setActive] = useState(ALL_TEMPLATES_CATEGORY)

    // Rail items: All + each present category with a count — same shape as the Home rail.
    const railItems = useMemo<SectionRailItem[]>(
        () => [
            {value: ALL_TEMPLATES_CATEGORY, label: "All", count: AGENT_TEMPLATES.length},
            ...categories.map((category) => ({
                value: category,
                label: category,
                count: AGENT_TEMPLATES.filter((t) => t.category === category).length,
            })),
        ],
        [categories],
    )
    const [query, setQuery] = useState("")
    const deferredQuery = useDeferredValue(query.trim().toLowerCase())

    // Deep link: `?category=engineering` opens with that rail item active.
    useEffect(() => {
        if (!router.isReady) return
        const slug = router.query.category
        setActive(categoryFromSlug(Array.isArray(slug) ? slug[0] : slug))
    }, [router.isReady, router.query.category])

    const handleCategoryChange = useCallback(
        (category: string) => {
            setActive(category)
            const {category: _drop, ...rest} = router.query
            router.replace(
                {
                    pathname: router.pathname,
                    query:
                        category === ALL_TEMPLATES_CATEGORY
                            ? rest
                            : {...rest, category: categorySlug(category)},
                },
                undefined,
                {shallow: true},
            )
        },
        [router],
    )

    // A card IS the create action: picking a template mints the agent and opens its playground,
    // rather than routing through a detail page and a second "Use this template" click. The detail
    // page stays reachable by URL for anyone who wants to read what a template does first.
    const {createFromTemplate, pendingKey} = useCreateAgentFromTemplate("gallery")
    const handleSelectTemplate = useCallback(
        (template: AgentTemplate) => void createFromTemplate(template),
        [createFromTemplate],
    )

    // Sections to render: All → every present category; otherwise just the active one.
    const visibleCategories = active === ALL_TEMPLATES_CATEGORY ? categories : [active]

    const sections = useMemo(
        () =>
            visibleCategories.map((category) => ({
                category,
                templates: AGENT_TEMPLATES.filter(
                    (template) =>
                        template.category === category && matchesQuery(template, deferredQuery),
                ),
            })),
        [visibleCategories, deferredQuery],
    )

    const resultCount = useMemo(
        () => sections.reduce((sum, section) => sum + section.templates.length, 0),
        [sections],
    )

    const hasQuery = deferredQuery.length > 0

    return (
        <PageLayout
            className={clsx(pageContentWidthClass, "grow min-h-0")}
            title={TEMPLATES_GALLERY.title}
            description={TEMPLATES_GALLERY.subtitle}
        >
            {/* Filters and grid share the page's own background — one surface, no rail, no
                divider — so the whole page reads as a single column of content. */}
            <div className="flex min-h-0 w-full flex-1 flex-col gap-6 lg:flex-row lg:gap-10">
                <nav className="flex shrink-0 flex-col gap-0.5 lg:w-[180px]">
                    {railItems.map((item) => (
                        <button
                            key={item.value}
                            type="button"
                            aria-current={item.value === active}
                            onClick={() => handleCategoryChange(item.value)}
                            className={`box-border flex w-full cursor-pointer items-center gap-2 rounded-lg border-0 px-3 py-2 text-left text-sm transition-colors focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-colorPrimary ${
                                item.value === active
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

                {/* One scroller: the sections wrapper below scrolls, so search stays pinned. */}
                <div className="flex min-h-0 flex-1 flex-col gap-5">
                    <Input
                        value={query}
                        onChange={(e) => setQuery(e.target.value)}
                        allowClear
                        prefix={<Search size={14} className="text-[var(--ag-colorTextTertiary)]" />}
                        placeholder={TEMPLATES_GALLERY.searchPlaceholder}
                        className="w-full sm:w-[320px]"
                    />
                    {resultCount === 0 ? (
                        <div className="flex flex-col items-center gap-3 rounded-lg border border-dashed border-[var(--ag-colorBorder)] px-6 py-12 text-center">
                            <Typography.Text className="text-xs text-[var(--ag-colorTextSecondary)]">
                                {hasQuery
                                    ? `No templates match "${query.trim()}".`
                                    : `No templates in ${active}.`}
                            </Typography.Text>
                            <button
                                type="button"
                                onClick={() => {
                                    setQuery("")
                                    handleCategoryChange(ALL_TEMPLATES_CATEGORY)
                                }}
                                className="border-0 bg-transparent p-0 text-xs font-medium text-[var(--ag-colorPrimary)]"
                            >
                                {hasQuery ? "Clear search" : "Show all templates"}
                            </button>
                        </div>
                    ) : (
                        <div className="flex min-h-0 flex-1 flex-col gap-8 overflow-y-auto pb-2 pr-1">
                            {sections.map((section) => (
                                <TemplateSection
                                    key={section.category}
                                    category={section.category}
                                    templates={section.templates}
                                    onSelectTemplate={handleSelectTemplate}
                                    pendingTemplateKey={pendingKey}
                                />
                            ))}
                        </div>
                    )}
                </div>
            </div>
        </PageLayout>
    )
}

export default TemplatesGalleryPage
