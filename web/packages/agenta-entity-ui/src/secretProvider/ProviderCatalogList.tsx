/**
 * The provider catalog — the searchable list of everything a project can connect.
 *
 * Every provider is a row with its real logo, in catalog order, never truncated into an "N more".
 * A provider that is already connected still offers "Add", because a project may hold several
 * connections per provider (two OpenAI keys, one per environment).
 */
import {useMemo, useState} from "react"

import {PROVIDER_CATALOG, type ProviderCatalogEntry} from "@agenta/entities/secret"
import {EmptyState, SearchInput} from "@agenta/ui/ui"
import {Plus} from "@phosphor-icons/react"

import {providerIconFor} from "./providerIcon"

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
        <div className="flex flex-col gap-3">
            <SearchInput
                placeholder="Search providers"
                value={search}
                allowClear
                onValueChange={setSearch}
            />

            {visible.length === 0 ? (
                <EmptyState image="simple" description="No provider matches this search." />
            ) : (
                <ul className="m-0 flex list-none flex-col gap-1 p-0">
                    {visible.map((entry) => {
                        const Icon = providerIconFor(entry.kind)
                        return (
                            <li key={entry.kind}>
                                <button
                                    type="button"
                                    onClick={() => onSelect(entry)}
                                    className="flex w-full cursor-pointer items-center gap-3 rounded border-0 bg-transparent px-2 py-2 text-left hover:bg-[var(--ag-colorFillQuaternary)]"
                                >
                                    <span className="flex size-5 shrink-0 items-center justify-center">
                                        <Icon className="h-5 w-5" />
                                    </span>
                                    <span className="min-w-0 flex-1 text-colorText">
                                        {entry.title}
                                    </span>
                                    <span className="flex items-center gap-1 text-colorTextSecondary">
                                        <Plus size={13} />
                                        Add
                                    </span>
                                </button>
                            </li>
                        )
                    })}
                </ul>
            )}
        </div>
    )
}

export default ProviderCatalogList
