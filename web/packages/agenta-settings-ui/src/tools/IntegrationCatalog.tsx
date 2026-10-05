import {useEffect, useMemo, useRef, useState} from "react"

import {
    fetchToolIntegrations,
    useToolCatalogCategories,
    useToolCatalogIntegrations,
    type ToolCatalogCategory,
} from "@agenta/entities/gatewayTool"
import {ScrollSentinel} from "@agenta/ui"
import {InitialsAvatar} from "@agenta/ui/components/presentational"
import {Button} from "@agenta/ui/ui"
import {MagnifyingGlass} from "@phosphor-icons/react"
import {useInfiniteQuery} from "@tanstack/react-query"

import {SettingsCatalogSection, type SettingsCatalogItem} from "../shared/SettingsCatalog"
import {SettingsEmpty} from "../shared/SettingsEmpty"

import type {CatalogIntegrationItem} from "./hooks/useToolsIntegrations"

const PROVIDER = "composio"
/** A collapsed category shows three rows of two. */
const PREVIEW = 6
const PAGE = 12

export const IntegrationLogo = ({src, name}: {src?: string | null; name: string}) =>
    src ? <img src={src} alt="" aria-hidden /> : <InitialsAvatar size="small" name={name} />

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

/** Composio names categories in lower case; acronyms stay upper case. */
const ACRONYMS = new Set(["ai", "crm", "hr", "sms", "seo", "api"])
const categoryLabel = (name: string) =>
    name
        .split(" ")
        .map((word) =>
            ACRONYMS.has(word) ? word.toUpperCase() : word.charAt(0).toUpperCase() + word.slice(1),
        )
        .join(" ")

/** True once the element nears the screen, and stays true: a section loads once. */
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
            {rootMargin: "400px 0px"},
        )
        observer.observe(el)
        return () => observer.disconnect()
    }, [near])
    return {ref, near}
}

/** Connected apps stay listed: one app can hold several connections, e.g. two accounts. */
interface CatalogProps {
    onConnect: (integration: CatalogIntegrationItem) => void
}

/** One category: a six-app preview that expands in place; it loads once near the screen. */
const CategorySection = ({category, onConnect}: CatalogProps & {category: ToolCatalogCategory}) => {
    const {ref, near} = useNearScreen()
    const [expanded, setExpanded] = useState(false)
    const query = useInfiniteQuery({
        queryKey: ["tools", "catalog", "integrations", PROVIDER, "category", category.id],
        queryFn: ({pageParam}) =>
            fetchToolIntegrations(PROVIDER, {
                category: category.id,
                limit: PAGE,
                cursor: pageParam || undefined,
                lowPriority: true,
            }),
        initialPageParam: "",
        getNextPageParam: (lastPage) => lastPage.cursor ?? undefined,
        enabled: near,
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

    const total = query.data?.pages[0]?.total
    const loaded = !query.isPending
    if (loaded && integrations.length === 0 && !query.hasNextPage) return null

    const shown = expanded ? integrations : integrations.slice(0, PREVIEW)
    const fetching = !loaded || query.isFetchingNextPage
    const more = (total ?? 0) > PREVIEW

    return (
        <SettingsCatalogSection
            sectionRef={ref}
            group={{
                label: categoryLabel(category.name),
                items: shown.map((integration) => toRow(integration, onConnect)),
                count: total ?? null,
                pendingRows: !loaded ? PREVIEW : expanded && fetching ? 4 : 0,
                action: more ? (
                    <Button
                        variant="ghost"
                        className="text-muted-foreground"
                        onClick={() => setExpanded((open) => !open)}
                    >
                        {expanded ? "Show less" : `Show all ${total}`}
                    </Button>
                ) : null,
                footer:
                    expanded && query.hasNextPage ? (
                        <ScrollSentinel
                            onVisible={() => void query.fetchNextPage()}
                            hasMore
                            isFetching={fetching}
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
                    />
                ) : undefined,
            }}
        />
    )
}

/** One section per category, or one flat list while searching or if categories fail. */
export const IntegrationCatalog = (
    props: CatalogProps & {
        term: string
        connectedMatches: number
        onClearSearch: () => void
        noMatch: (term: string) => string
    },
) => {
    const {categories, isLoading, error} = useToolCatalogCategories()

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
                <CategorySection
                    key={category.id}
                    category={category}
                    onConnect={props.onConnect}
                />
            ))}
        </>
    )
}
