/**
 * The provider catalog — the searchable list of everything a project can connect.
 *
 * Every provider is a row with its real logo, in catalog order, never truncated into an "N more".
 * A provider that is already connected still offers "Add", because a project may hold several
 * connections per provider (two OpenAI keys, one per environment) — which the hint beside the
 * section label says out loud, since the repeated Add buttons otherwise read as a mistake.
 *
 * This is the drawer's ONLY scrolling region: the section label and the search stay pinned above
 * it, Connected and Subscriptions stay pinned outside it, and every spare pixel of the drawer goes
 * to the rows so the footer never strands under empty space.
 *
 * Design: providers-drawer-final/README.md §4 ("Catalog").
 */
import {useMemo, useState} from "react"

import {PROVIDER_CATALOG, type ProviderCatalogEntry} from "@agenta/entities/secret"
import {Button, EmptyState, SearchInput} from "@agenta/ui/ui"

import {providerIconFor} from "./providerIcon"
import ScrollScrim from "./ScrollScrim"

export interface ProviderCatalogListProps {
    onSelect: (entry: ProviderCatalogEntry) => void
    /** Section label above the search, with its hint. Omitted where the drawer IS the catalog. */
    label?: string
    hint?: string
}

const ProviderCatalogList = ({onSelect, label, hint}: ProviderCatalogListProps) => {
    const [search, setSearch] = useState("")

    const visible = useMemo(() => {
        const term = search.trim().toLowerCase()
        if (!term) return PROVIDER_CATALOG
        return PROVIDER_CATALOG.filter(
            (entry) =>
                entry.title.toLowerCase().includes(term) || entry.kind.toLowerCase().includes(term),
        )
    }, [search])

    return (
        <div className="flex min-h-0 flex-1 flex-col">
            {label ? (
                <div className="flex shrink-0 items-baseline justify-between gap-3 px-6 pb-1 pt-4">
                    <h4 className="m-0 text-field-sm font-medium text-colorTextTertiary">
                        {label}
                    </h4>
                    {hint ? (
                        <span className="text-field-sm text-colorTextTertiary">{hint}</span>
                    ) : null}
                </div>
            ) : null}

            <div className="shrink-0 px-6 pb-2 pt-3">
                <SearchInput
                    placeholder="Search providers"
                    value={search}
                    allowClear
                    onValueChange={setSearch}
                />
            </div>

            {visible.length === 0 ? (
                <div className="px-6 py-4">
                    <EmptyState image="simple" description="No provider matches this search." />
                </div>
            ) : (
                <ScrollScrim>
                    <ul className="m-0 flex list-none flex-col p-0">
                        {visible.map((entry) => {
                            const Icon = providerIconFor(entry.kind)
                            return (
                                <li
                                    key={entry.kind}
                                    className="flex items-center gap-3 border-0 border-b border-solid border-colorSplit px-6 py-2"
                                >
                                    <Icon className="size-5 shrink-0" />
                                    <span className="flex min-w-0 flex-1 flex-col">
                                        <span className="truncate text-xs text-colorText">
                                            {entry.title}
                                        </span>
                                        {entry.subtitle ? (
                                            <span className="truncate text-[11px] text-colorTextTertiary">
                                                {entry.subtitle}
                                            </span>
                                        ) : null}
                                    </span>
                                    <Button
                                        variant="outline"
                                        size="sm"
                                        className="shrink-0"
                                        onClick={() => onSelect(entry)}
                                    >
                                        Add
                                    </Button>
                                </li>
                            )
                        })}
                    </ul>
                </ScrollScrim>
            )}
        </div>
    )
}

export default ProviderCatalogList
