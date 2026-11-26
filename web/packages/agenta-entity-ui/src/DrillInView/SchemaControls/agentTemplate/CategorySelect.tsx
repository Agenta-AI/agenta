/** The add-integration drawer's category filter: a searchable dropdown beside the search field. */
import {useMemo} from "react"

import {useToolCatalogCategories} from "@agenta/entities/gatewayTool"
import {createT, useT} from "@agenta/i18n"
import integrationDrawerCatalog from "@agenta/i18n/catalogs/entityUi.integrationDrawer"
import {Combobox, type ComboboxOption} from "@agenta/ui/ui"
import {CaretUpDown} from "@phosphor-icons/react"

import {categoryLabel, type CategorySelection} from "./integrationCatalogFilters"

const tNow = createT(integrationDrawerCatalog)

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
    const t = useT(integrationDrawerCatalog)
    const {categories, isLoading, error} = useToolCatalogCategories()

    // Typing filters on the label the reader sees ("AI web scraping"), not the provider's id.
    const options = useMemo<ComboboxOption[]>(
        () => [
            {
                value: ALL,
                label: tNow("entityUi.integrationDrawer.allCategories"),
                searchValue: tNow("entityUi.integrationDrawer.allCategories"),
            },
            ...categories.map((category) => {
                const label = categoryLabel(category.name)
                return {value: category.id, label, searchValue: label}
            }),
        ],
        [categories],
    )

    // A failed read leaves All apps and search working; the filter just has nothing to offer.
    if (error && !categories.length) return null

    const loading = isLoading && !categories.length
    return (
        <Combobox
            aria-label={t("entityUi.integrationDrawer.category")}
            // Narrower on a phone so the search keeps room for its placeholder. The canvas size
            // on the desktop (F02 f4): 120 px, 28 px high, radius 6, 12 px, an up-down icon.
            // "All categories" clears instead of a clear button.
            className="w-36 shrink-0 sm:w-48 md:h-7 md:w-[120px] md:rounded-[6px] md:pl-2 md:text-[12px]"
            icon={<CaretUpDown aria-hidden size={14} className="text-colorTextTertiary" />}
            // The list may be wider than its field, so names stay on one line on a phone.
            contentClassName="w-56"
            options={options}
            value={value?.id ?? ALL}
            placeholder={t("entityUi.integrationDrawer.allCategories")}
            emptyText={t("entityUi.integrationDrawer.noMatchingCategory")}
            loading={loading}
            container={container}
            onChange={(id) => {
                if (!id || id === ALL) return onChange(null)
                const match = categories.find((category) => category.id === id)
                onChange(match ? {id: match.id, name: match.name} : null)
            }}
        />
    )
}
