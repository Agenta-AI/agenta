import {useCallback, type KeyboardEvent} from "react"

import {useT} from "@agenta/i18n"
import toolbarCatalog from "@agenta/i18n/catalogs/observabilityUi.toolbar"
import {searchQueryAtom} from "@agenta/observability"
import {SearchInput} from "@agenta/ui/ui"
import {useAtom} from "jotai"

import {useDropFilterField, useUpdateFilter} from "./filterControls"

/**
 * The observability search box. Typing only stages the query; Enter commits it as a `content`
 * filter. Emptying the box (typing back to "" or the clear button) drops that filter
 * immediately, because `onValueChange` fires on clear too.
 */
export const ToolbarSearch = () => {
    const t = useT(toolbarCatalog)
    const [searchQuery, setSearchQuery] = useAtom(searchQueryAtom)
    const dropFilterField = useDropFilterField()
    const updateFilter = useUpdateFilter()

    const onValueChange = useCallback(
        (value: string) => {
            setSearchQuery(value)
            if (!value) dropFilterField("content")
        },
        [setSearchQuery, dropFilterField],
    )

    const onKeyDown = useCallback(
        (event: KeyboardEvent<HTMLInputElement>) => {
            if (event.key !== "Enter" || !searchQuery) return
            updateFilter({field: "content", operator: "contains", value: searchQuery})
        },
        [searchQuery, updateFilter],
    )

    return (
        <SearchInput
            aria-label={t("observabilityUi.toolbar.searchData")}
            placeholder={t("observabilityUi.toolbar.search")}
            value={searchQuery}
            onValueChange={onValueChange}
            onKeyDown={onKeyDown}
            className="w-[320px] shrink-0"
        />
    )
}

export default ToolbarSearch
