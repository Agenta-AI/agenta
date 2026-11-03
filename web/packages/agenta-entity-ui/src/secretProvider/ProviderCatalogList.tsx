/** The searchable provider catalog; the drawer's only scrolling region, under a pinned search. */
import {useMemo, useState} from "react"

import {PROVIDER_CATALOG, type ProviderCatalogEntry} from "@agenta/entities/secret"
import {Button, EmptyState, SearchInput} from "@agenta/ui/ui"

import {providerIconFor} from "./providerIcon"
import ScrollScrim from "./ScrollScrim"

export interface ProviderCatalogListProps {
    onSelect: (entry: ProviderCatalogEntry) => void
}

const ProviderCatalogList = ({onSelect}: ProviderCatalogListProps) => {
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
