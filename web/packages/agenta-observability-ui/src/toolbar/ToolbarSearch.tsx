import {useCallback, type KeyboardEvent} from "react"

import {searchQueryAtom} from "@agenta/observability"
import {SearchInput} from "@agenta/ui/ui"
import {useAtom} from "jotai"

import {useDropFilterField, useUpdateFilter} from "./filterControls"

/**
 * The observability search box. Typing only stages the query; Enter commits it as a `content`
 * filter. Emptying the box (typing back to "" or the clear button) drops that filter
 * immediately — the antd original got the clear path via `Input.Search`'s `onSearch`
 * `{source: "clear"}`, we get it because `onValueChange` fires on clear too.
 */
export const ToolbarSearch = () => {
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
            aria-label="Search observability data"
            placeholder="Search"
            value={searchQuery}
            onValueChange={onValueChange}
            onKeyDown={onKeyDown}
            className="w-[320px] shrink-0"
        />
    )
}

export default ToolbarSearch
