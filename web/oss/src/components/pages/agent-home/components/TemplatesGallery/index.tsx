import {useCallback, useDeferredValue, useEffect, useMemo, useState} from "react"

import {SectionRail, type SectionRailItem} from "@agenta/entity-ui"
import {PageLayout} from "@agenta/ui"
import {App, Input, Typography} from "antd"
import {useAtomValue} from "jotai"
import {Search} from "lucide-react"
import {useRouter} from "next/router"

import {useBreadcrumbsEffect} from "@/oss/lib/hooks/useBreadcrumbs"
import {urlAtom} from "@/oss/state/url"

import {TEMPLATES_GALLERY} from "../../assets/constants"
import {
    AGENT_TEMPLATES,
    ALL_TEMPLATES_CATEGORY,
    categoryFromSlug,
    categorySlug,
    templateCategories,
    type AgentTemplate,
} from "../../assets/templates"
import {useTemplateSelect} from "../../hooks/useTemplateSelect"
import TemplateSetupDrawer, {type TemplateSetupResult} from "../TemplateSetupDrawer"

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
    const {message} = App.useApp()
    const {baseAppURL} = useAtomValue(urlAtom)

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

    // Breadcrumb: relabel the /apps segment to Home, and the sub-route to Templates.
    useBreadcrumbsEffect(
        {
            breadcrumbs: {
                apps: {label: "Home", href: baseAppURL || undefined},
                app: {label: TEMPLATES_GALLERY.title},
            },
            type: "new",
        },
        [baseAppURL],
    )

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

    // Template card click: builder mode → straight to a seeded playground; else open the setup
    // drawer. Gated by NEXT_PUBLIC_AGENT_TEMPLATE_BUILDER.
    const [setupTemplate, setSetupTemplate] = useState<AgentTemplate | null>(null)
    const handleSelectTemplate = useTemplateSelect(setSetupTemplate)

    // TODO(Phase B): create the ephemeral draft from the template + open the playground.
    const handleTemplateCreate = useCallback(
        ({template, name}: TemplateSetupResult) => {
            setSetupTemplate(null)
            message.info(`Create "${name}" from ${template.name} — wiring in the next phase`)
        },
        [message],
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
        <PageLayout className="grow min-h-0">
            <div className="mx-auto flex min-h-0 w-full max-w-[1200px] flex-1 flex-col gap-5 pt-6">
                <div className="flex shrink-0 flex-col items-start justify-between gap-4 sm:flex-row sm:items-end">
                    <div className="flex min-w-0 flex-col gap-1.5">
                        <Typography.Title level={2} className="!m-0 !text-[24px] !leading-tight">
                            {TEMPLATES_GALLERY.title}
                        </Typography.Title>
                        <Typography.Text className="max-w-[560px] !text-[13px] !text-[var(--ag-colorTextSecondary)]">
                            {TEMPLATES_GALLERY.subtitle}
                        </Typography.Text>
                    </div>

                    <Input
                        value={query}
                        onChange={(e) => setQuery(e.target.value)}
                        allowClear
                        prefix={<Search size={14} className="text-[var(--ag-colorTextTertiary)]" />}
                        placeholder={TEMPLATES_GALLERY.searchPlaceholder}
                        className="w-full sm:w-[280px]"
                    />
                </div>

                <SectionRail
                    items={railItems}
                    value={active}
                    onChange={handleCategoryChange}
                    railWidth="w-[160px]"
                    fill
                >
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
                                />
                            ))}
                        </div>
                    )}
                </SectionRail>
            </div>

            <TemplateSetupDrawer
                template={setupTemplate}
                open={!!setupTemplate}
                onClose={() => setSetupTemplate(null)}
                onCreate={handleTemplateCreate}
            />
        </PageLayout>
    )
}

export default TemplatesGalleryPage
