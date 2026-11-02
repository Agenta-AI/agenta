/** The add-integration drawer's category filter: a searchable dropdown beside the search field. */
import {useMemo} from "react"

import {useToolCatalogCategories} from "@agenta/entities/gatewayTool"
import {Combobox, type ComboboxOption} from "@agenta/ui/ui"

import {categoryLabel, type CategorySelection} from "./integrationCatalogFilters"

const ALL = "__all__"

export function CategorySelect({
    value,
    onChange,
    container,
}: {
    value: CategorySelection | null
    onChange: (next: CategorySelection | null) => void
    /** The drawer panel, so the list portals inside it and scrolls under the drawer's lock. */
    container: HTMLElement | null
}) {
    const {categories, isLoading, error} = useToolCatalogCategories()

    // Typing filters on the label the reader sees ("AI web scraping"), not the provider's id.
    const options = useMemo<ComboboxOption[]>(
        () => [
            {value: ALL, label: "All categories", searchValue: "All categories"},
            ...categories.map((category) => {
                const label = categoryLabel(category.name)
                return {value: category.id, label, searchValue: label}
            }),
        ],
        [categories],
    )

    // A failed read leaves All apps and search working; the filter just has nothing to offer.
    if (error && !categories.length) return null

    return (
        <Combobox
            aria-label="Category"
            // Narrower on a phone so the search keeps room for its placeholder.
            className="w-36 shrink-0 sm:w-48"
            // The list may be wider than its field, so names stay on one line on a phone.
            contentClassName="w-56"
            options={options}
            value={value?.id ?? ALL}
            placeholder="All categories"
            emptyText="No matching category"
            loading={isLoading && !categories.length}
            container={container}
            onChange={(id) => {
                if (!id || id === ALL) return onChange(null)
                const match = categories.find((category) => category.id === id)
                onChange(match ? {id: match.id, name: match.name} : null)
            }}
        />
    )
}
