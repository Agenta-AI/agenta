import {useCallback, useEffect, useMemo, useRef, useState} from "react"

import {
    ALL_TEMPLATES_CATEGORY,
    agentTemplateProvenanceAtom,
    agentTemplatesAtom,
    agentTemplatesStatusAtom,
    categorySlug,
    refetchAgentTemplatesAtom,
    type AgentStarterTemplate,
} from "@agenta/entities/workflow"
import {pageContentWidthClass} from "@agenta/ui/components/page-width"
import {LoadError} from "@agenta/ui/components/presentational"
import {ListTable} from "@agenta/ui/list-table"
import {Kbd, SearchInput} from "@agenta/ui/ui"
import {useAtomValue, useSetAtom} from "jotai"
import {useRouter} from "next/router"

import {PageTitle} from "@/components/PageTitle"
import {ScreenScaffold} from "@/components/ScreenScaffold"
import {useScrollFade} from "@/lib/useScrollFade"

import {useNewAgentAction} from "../agents/useNewAgentAction"
import {useBindProjectContext} from "../context/useBindProjectContext"
import {AppShell} from "../nav/AppShell"
import {NavDrawer} from "../nav/NavDrawer"

import {FeaturedTemplate} from "./FeaturedTemplate"
import {
    DEFAULT_MARKETPLACE_FILTER,
    categoryFromParam,
    deriveMarketplace,
    featuredTemplates,
    type MarketplaceFilter,
} from "./marketplaceView"
import {FeaturedTemplateSkeleton} from "./states/FeaturedTemplateSkeleton"
import {TemplateFilterRailSkeleton} from "./states/TemplateFilterRailSkeleton"
import {TemplatesEmpty} from "./states/TemplatesEmpty"
import {TemplatesNoMatch} from "./states/TemplatesNoMatch"
import {TemplateCardBody} from "./TemplateCardBody"
import {TemplateFilterMenu} from "./TemplateFilterMenu"
import {TemplateFilterRail} from "./TemplateFilterRail"
import {TemplatePreviewSheet} from "./TemplatePreviewSheet"
import {TemplateSortMenu} from "./TemplateSortMenu"

const PAGE_FRAME = `${pageContentWidthClass} lg:px-16`
const COLUMNS = [{key: "name", label: "Template", width: "1fr"}]
const templateKey = (template: AgentStarterTemplate) => template.key

/** The Agent Marketplace: a featured template, then the catalog with its filters. */
export const MarketplaceScreen = ({
    workspaceId,
    projectId,
}: {
    workspaceId: string
    projectId: string
}) => {
    useBindProjectContext(projectId)
    const router = useRouter()
    const base = `/w/${workspaceId}/p/${projectId}`
    const newAgent = useNewAgentAction(base)
    const templates = useAtomValue(agentTemplatesAtom)
    const status = useAtomValue(agentTemplatesStatusAtom)
    const provenance = useAtomValue(agentTemplateProvenanceAtom)
    const refetchTemplates = useSetAtom(refetchAgentTemplatesAtom)
    const searchRef = useRef<HTMLInputElement>(null)
    const fade = useScrollFade<HTMLDivElement>()
    const phoneSearchRef = useRef<HTMLInputElement>(null)
    const [filter, setFilter] = useState<MarketplaceFilter>(DEFAULT_MARKETPLACE_FILTER)
    const [previewKey, setPreviewKey] = useState<string | null>(null)
    const [previewOpen, setPreviewOpen] = useState(false)

    // `?category=<slug>` and the category filter stay in step, both ways.
    const categoryParam =
        typeof router.query.category === "string" ? router.query.category : undefined
    const syncedParam = useRef<string | undefined | null>(null)
    useEffect(() => {
        if (status !== "success" || syncedParam.current === categoryParam) return
        syncedParam.current = categoryParam
        setFilter((current) => ({
            ...current,
            category: categoryFromParam(categoryParam, templates),
        }))
    }, [categoryParam, status, templates])

    const changeFilter = (next: MarketplaceFilter) => {
        if (next.category !== filter.category) {
            const slug =
                next.category === ALL_TEMPLATES_CATEGORY ? undefined : categorySlug(next.category)
            syncedParam.current = slug
            const {category: _previous, ...rest} = router.query
            void router.replace(
                {pathname: router.pathname, query: slug ? {...rest, category: slug} : rest},
                undefined,
                {shallow: true},
            )
        }
        setFilter(next)
    }

    useEffect(() => {
        const onKey = (event: KeyboardEvent) => {
            const target = event.target
            const typing =
                target instanceof Element && target.closest("input, textarea, [contenteditable]")
            if (event.key !== "/" || typing || event.metaKey || event.ctrlKey) return
            // Two inputs, one per layout: focus whichever is on screen.
            const search = [searchRef.current, phoneSearchRef.current].find(
                (input) => input?.offsetParent,
            )
            if (!search) return
            event.preventDefault()
            search.focus()
        }
        window.addEventListener("keydown", onKey)
        return () => window.removeEventListener("keydown", onKey)
    }, [])

    const view = useMemo(() => deriveMarketplace(templates, filter), [filter, templates])
    const featured = useMemo(() => featuredTemplates(templates), [templates])
    const preview = previewKey ? templates.find((item) => item.key === previewKey) : undefined
    const openTemplate = useCallback((template: AgentStarterTemplate) => {
        setPreviewKey(template.key)
        setPreviewOpen(true)
    }, [])
    const startFromTemplate = useCallback(
        (template: AgentStarterTemplate) => newAgent.createFromTemplate(template.key),
        [newAgent],
    )
    const step = (direction: -1 | 1) => {
        const list = view.templates
        if (!list.length) return
        setPreviewKey((current) => {
            const index = list.findIndex((item) => item.key === current)
            if (index < 0) return list[direction > 0 ? 0 : list.length - 1].key
            return list[(index + direction + list.length) % list.length].key
        })
    }
    const clearFilters = () => changeFilter({...DEFAULT_MARKETPLACE_FILTER, sort: filter.sort})

    const loaded = status === "success"
    const term = filter.query.trim()
    const categoryLabel =
        filter.category === ALL_TEMPLATES_CATEGORY ? "All templates" : filter.category
    const searchProps = {
        value: filter.query,
        onValueChange: (query: string) => changeFilter({...filter, query}),
        placeholder: "Search templates…",
        "aria-label": "Search templates",
        className: "w-full",
    }

    return (
        <>
            <PageTitle title="Agent Marketplace" />
            <AppShell workspaceId={workspaceId} projectId={projectId}>
                <ScreenScaffold
                    scrollRef={fade.ref}
                    onScroll={fade.onScroll}
                    scrollStyle={fade.style}
                    header={
                        <div
                            className={`box-border shrink-0 px-4 pb-3 pt-3 lg:pt-14 ${PAGE_FRAME}`}
                        >
                            <div className="flex min-w-0 items-center gap-2">
                                <NavDrawer workspaceId={workspaceId} projectId={projectId} />
                                <h1 className="m-0 min-w-0 flex-1 truncate text-[16px] font-semibold leading-[1.5] text-foreground sm:text-[24px] sm:leading-[1.3333333333333333]">
                                    Agent Marketplace
                                </h1>
                            </div>
                            <p className="text-muted-foreground m-0 mt-1 text-[13px]">
                                Start from a working agent. Connect your apps, adjust the skills,
                                and let it run.
                            </p>
                        </div>
                    }
                >
                    <div className={`flex min-w-0 flex-col gap-8 px-4 pb-12 pt-3 ${PAGE_FRAME}`}>
                        {status === "pending" ? (
                            <FeaturedTemplateSkeleton />
                        ) : featured.length ? (
                            <FeaturedTemplate
                                templates={featured}
                                busy={newAgent.creating}
                                paused={previewOpen}
                                onUse={startFromTemplate}
                                onPreview={openTemplate}
                            />
                        ) : null}

                        <div className="grid min-w-0 grid-cols-1 items-start gap-3 lg:grid-cols-[208px_minmax(0,1fr)] lg:gap-9">
                            <aside className="sticky top-4 hidden flex-col gap-6 lg:flex">
                                <SearchInput
                                    ref={searchRef}
                                    suffix={<Kbd>/</Kbd>}
                                    {...searchProps}
                                />
                                {loaded ? (
                                    <TemplateFilterRail
                                        filter={filter}
                                        onChange={changeFilter}
                                        categories={view.categories}
                                        apps={view.apps}
                                    />
                                ) : (
                                    <TemplateFilterRailSkeleton />
                                )}
                            </aside>
                            <div className="flex min-w-0 flex-col gap-3">
                                <div className="flex items-center gap-2 lg:hidden">
                                    <SearchInput ref={phoneSearchRef} {...searchProps} />
                                    <TemplateFilterMenu
                                        filter={filter}
                                        onChange={changeFilter}
                                        categories={view.categories}
                                        apps={view.apps}
                                    />
                                </div>
                                <div className="flex min-h-8 items-center justify-between gap-3">
                                    <h2 className="m-0 text-sm font-semibold text-foreground">
                                        {categoryLabel}
                                        {loaded ? ` · ${view.templates.length}` : null}
                                    </h2>
                                    <div className="hidden lg:block">
                                        <TemplateSortMenu
                                            value={filter.sort}
                                            onChange={(sort) => changeFilter({...filter, sort})}
                                        />
                                    </div>
                                </div>
                                {status === "error" ? (
                                    <LoadError
                                        framed
                                        title="Could not load templates"
                                        onRetry={refetchTemplates}
                                    />
                                ) : (
                                    <ListTable
                                        view="grid"
                                        columns={COLUMNS}
                                        groups={[{key: "all", label: null, rows: view.templates}]}
                                        rowKey={templateKey}
                                        renderRow={(template) => (
                                            <span className="truncate">{template.name}</span>
                                        )}
                                        renderCard={(template) => (
                                            <TemplateCardBody template={template} />
                                        )}
                                        cardMinWidth={250}
                                        onOpenRow={openTemplate}
                                        loading={status === "pending"}
                                        skeletonRows={6}
                                        empty={
                                            templates.length === 0 ? (
                                                <TemplatesEmpty />
                                            ) : (
                                                <TemplatesNoMatch
                                                    term={term || undefined}
                                                    onClear={clearFilters}
                                                />
                                            )
                                        }
                                    />
                                )}
                            </div>
                        </div>
                    </div>
                </ScreenScaffold>
            </AppShell>
            <TemplatePreviewSheet
                open={previewOpen}
                template={preview}
                version={preview ? provenance[preview.key]?.version : undefined}
                fullPageHref={preview ? `${base}/templates/${preview.key}` : base}
                busy={newAgent.creating}
                onUse={startFromTemplate}
                onStep={step}
                onClose={() => setPreviewOpen(false)}
            />
        </>
    )
}
