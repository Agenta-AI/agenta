import {useEffect, useMemo, useRef, useState} from "react"

import {
    fetchToolIntegrations,
    useToolCatalogCategories,
    useToolCatalogIntegrations,
    type ToolCatalogCategory,
} from "@agenta/entities/gatewayTool"
import {ScrollSentinel} from "@agenta/ui/components"
import {Button} from "@agenta/ui/ui"
import {MagnifyingGlass} from "@phosphor-icons/react"
import {useInfiniteQuery} from "@tanstack/react-query"

import {NameAvatar} from "../shared/NameAvatar"
import {findScrollRoot, useScrollRoot} from "../shared/scrollRoot"
import {SettingsCatalogSection, type SettingsCatalogItem} from "../shared/SettingsCatalog"
import {SettingsEmpty} from "../shared/SettingsEmpty"

import {categoryLabel} from "./categoryLabel"
import type {CatalogIntegrationItem} from "./hooks/useToolsIntegrations"

const PROVIDER = "composio"
/** A category preview shows three rows of two. */
const PREVIEW = 6
const PAGE = 12
/** Load a page this far before it scrolls into view. */
const PREFETCH = "0px 0px 600px 0px"

export const IntegrationLogo = ({src, name}: {src?: string | null; name: string}) =>
    src ? (
        <img src={src} alt="" aria-hidden />
    ) : (
        <NameAvatar name={name} className="size-[18px] rounded-[4px] text-[11px]" />
    )

const toRow = (
    integration: CatalogIntegrationItem,
    onConnect: (integration: CatalogIntegrationItem) => void,
): SettingsCatalogItem => ({
    key: integration.key,
    logo: <IntegrationLogo src={integration.logo} name={integration.name} />,
    name: integration.name,
    description: integration.description ?? undefined,
    status: "available",
    statusLabel: `Connect ${integration.name}`,
    onOpen: () => onConnect(integration),
})

/** True once the element nears the page's scroll area, and stays true: a section loads once. */
const useNearScreen = () => {
    const ref = useRef<HTMLElement>(null)
    const [near, setNear] = useState(false)
    useEffect(() => {
        const el = ref.current
        if (!el || near) return
        const observer = new IntersectionObserver(
            ([entry]) => {
                if (entry.isIntersecting) setNear(true)
            },
            {root: findScrollRoot(el), rootMargin: PREFETCH},
        )
        observer.observe(el)
        return () => observer.disconnect()
    }, [near])
    return {ref, near}
}

/** One category's pages; the preview and the full list share them, so opening one is instant. */
const useCategoryIntegrations = (category: string, search: string, enabled: boolean) => {
    const query = useInfiniteQuery({
        queryKey: ["tools", "catalog", "integrations", PROVIDER, "category", category, search],
        queryFn: ({pageParam}) =>
            fetchToolIntegrations(PROVIDER, {
                category,
                search: search || undefined,
                limit: PAGE,
                cursor: pageParam || undefined,
                lowPriority: true,
            }),
        initialPageParam: "",
        getNextPageParam: (lastPage) => lastPage.cursor ?? undefined,
        enabled,
        staleTime: 5 * 60_000,
        refetchOnWindowFocus: false,
    })
    const integrations = useMemo(() => {
        const seen = new Set<string>()
        return (query.data?.pages ?? [])
            .flatMap((page) => page.integrations ?? [])
            .filter((integration) => {
                if (seen.has(integration.key)) return false
                seen.add(integration.key)
                return true
            })
    }, [query.data?.pages])
    return {query, integrations, total: query.data?.pages[0]?.total}
}

/** Connected apps stay listed: one app can hold several connections, e.g. two accounts. */
interface CatalogProps {
    onConnect: (integration: CatalogIntegrationItem) => void
}

/** One category's six-app preview; it loads as it nears the screen. */
const CategoryPreview = ({
    category,
    onConnect,
    onShowAll,
}: CatalogProps & {category: ToolCatalogCategory; onShowAll: () => void}) => {
    const {ref, near} = useNearScreen()
    const {query, integrations, total} = useCategoryIntegrations(category.id, "", near)

    const loaded = !query.isPending
    if (loaded && integrations.length === 0 && !query.hasNextPage) return null

    return (
        <SettingsCatalogSection
            sectionRef={ref}
            group={{
                label: categoryLabel(category.name),
                items: integrations.slice(0, PREVIEW).map((item) => toRow(item, onConnect)),
                count: total ?? null,
                pendingRows: loaded ? 0 : PREVIEW,
                action:
                    (total ?? 0) > PREVIEW ? (
                        <Button
                            variant="ghost"
                            className="text-muted-foreground"
                            onClick={onShowAll}
                        >
                            Show all {total}
                        </Button>
                    ) : null,
            }}
        />
    )
}

/** A selected category's whole list, a page at a time, searched on the server from three characters. */
const CategoryList = ({
    category,
    term,
    onConnect,
    onClearSearch,
    noMatch,
}: CatalogProps & {
    category: ToolCatalogCategory
    term: string
    onClearSearch: () => void
    noMatch: (term: string) => string
}) => {
    const ref = useRef<HTMLElement>(null)
    const root = useScrollRoot(ref)
    const serverSearched = term.length >= 3
    const {query, integrations, total} = useCategoryIntegrations(
        category.id,
        serverSearched ? term : "",
        true,
    )
    const items = integrations
        .filter(
            (integration) =>
                serverSearched ||
                !term ||
                [integration.name, integration.description].some((text) =>
                    text?.toLowerCase().includes(term),
                ),
        )
        .map((integration) => toRow(integration, onConnect))
    const fetching = query.isPending || query.isFetchingNextPage

    if (!fetching && items.length === 0 && !query.hasNextPage) {
        return (
            <SettingsEmpty
                plain
                icon={<MagnifyingGlass size={18} />}
                title={term ? noMatch(term) : "No integrations in this category"}
                action={
                    term ? (
                        <Button variant="outline" onClick={onClearSearch}>
                            Clear search
                        </Button>
                    ) : undefined
                }
            />
        )
    }

    return (
        <SettingsCatalogSection
            sectionRef={ref}
            group={{
                label: term ? "Results" : categoryLabel(category.name),
                items,
                // A local narrowing shows fewer rows than the server total.
                count: serverSearched || !term ? (total ?? null) : null,
                pendingRows: fetching ? 4 : 0,
                footer: query.hasNextPage ? (
                    <ScrollSentinel
                        onVisible={() => void query.fetchNextPage()}
                        hasMore
                        isFetching={fetching}
                        root={root}
                        rootMargin={PREFETCH}
                    />
                ) : undefined,
            }}
        />
    )
}

/** The whole catalog as one list, for a search or when categories fail to load. */
const FlatCatalog = ({
    label,
    term,
    connectedMatches,
    onConnect,
    onClearSearch,
    noMatch,
}: CatalogProps & {
    label: string
    term: string
    /** Connected rows the search kept; with none and no results, the page says so. */
    connectedMatches: number
    onClearSearch: () => void
    noMatch: (term: string) => string
}) => {
    const ref = useRef<HTMLElement>(null)
    const root = useScrollRoot(ref)
    const available = useToolCatalogIntegrations()
    // The server searches from three characters; below that, narrow what has loaded.
    const serverSearched = term.length >= 3
    const items = available.integrations
        .filter(
            (integration) =>
                serverSearched ||
                !term ||
                [integration.name, integration.description].some((text) =>
                    text?.toLowerCase().includes(term),
                ),
        )
        .map((integration) => toRow(integration, onConnect))
    const fetching = available.isLoading || available.isFetchingNextPage

    if (!fetching && items.length === 0 && !available.hasNextPage) {
        return connectedMatches > 0 || !term ? null : (
            <SettingsEmpty
                plain
                icon={<MagnifyingGlass size={18} />}
                title={noMatch(term)}
                action={
                    <Button variant="outline" onClick={onClearSearch}>
                        Clear search
                    </Button>
                }
            />
        )
    }

    return (
        <SettingsCatalogSection
            sectionRef={ref}
            group={{
                label,
                items,
                // Rows load a page at a time, so a count of what has loaded would mislead.
                count: null,
                pendingRows: fetching ? 4 : 0,
                footer: available.hasNextPage ? (
                    <ScrollSentinel
                        onVisible={available.requestMore}
                        hasMore
                        isFetching={fetching}
                        root={root}
                        rootMargin={PREFETCH}
                    />
                ) : undefined,
            }}
        />
    )
}

/** All: one preview per category. A category: its whole list. A search: one flat list. */
export const IntegrationCatalog = (
    props: CatalogProps & {
        term: string
        /** The selected category's id; `null` is All. */
        category: string | null
        onSelectCategory: (category: string | null) => void
        connectedMatches: number
        onClearSearch: () => void
        noMatch: (term: string) => string
    },
) => {
    const {categories, isLoading, error} = useToolCatalogCategories()
    const selected = categories.find((category) => category.id === props.category)

    if (selected) return <CategoryList {...props} category={selected} />
    if (props.term || error || (!isLoading && categories.length === 0)) {
        return <FlatCatalog {...props} label={props.term ? "Results" : "Available"} />
    }
    if (isLoading)
        return (
            <SettingsCatalogSection
                group={{label: "Available", items: [], count: null, pendingRows: PREVIEW}}
            />
        )

    return (
        <>
            {categories.map((category) => (
                <CategoryPreview
                    key={category.id}
                    category={category}
                    onConnect={props.onConnect}
                    onShowAll={() => props.onSelectCategory(category.id)}
                />
            ))}
        </>
    )
}
