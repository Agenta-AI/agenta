import {useEffect, useRef, useState} from "react"

import {Search} from "lucide-react"

import {cn} from "../components/ui/utils"

import {FilterMenuOptionList} from "./FilterMenuOptionList"
import type {FilterMenuOption, FilterMenuSection} from "./types"

/** A row's options (flyout or drill-in), under a search field when the section is `searchable`. */
export const FilterMenuFlyoutBody = ({
    section,
    options,
    selected,
    autoFocus,
    onSelect,
    onDismiss,
}: {
    section: FilterMenuSection
    /** The options to show — already narrowed by the panel's search. */
    options: FilterMenuOption[]
    selected: string[]
    autoFocus: boolean
    onSelect: (value: string) => void
    onDismiss?: () => void
}) => {
    const [term, setTerm] = useState("")
    const inputRef = useRef<HTMLInputElement | null>(null)
    const listRef = useRef<HTMLDivElement | null>(null)
    const query = term.trim().toLowerCase()
    const shown = query
        ? options.filter((option) =>
              `${option.label} ${option.group ?? ""}`.toLowerCase().includes(query),
          )
        : options

    // Keyboard readers land in the field rather than on the first option.
    useEffect(() => {
        if (!autoFocus || !section.searchable) return
        const frame = requestAnimationFrame(() => inputRef.current?.focus())
        return () => cancelAnimationFrame(frame)
    }, [autoFocus, section.searchable])

    return (
        <>
            {section.searchable ? (
                <label className="flex shrink-0 items-center gap-2 border-0 border-b border-solid border-border px-3 py-2">
                    <Search size={14} className="shrink-0 text-muted-foreground" aria-hidden />
                    <input
                        ref={inputRef}
                        value={term}
                        onChange={(event) => setTerm(event.target.value)}
                        placeholder={section.searchPlaceholder ?? "Search…"}
                        aria-label={section.searchPlaceholder ?? `Search ${section.label}`}
                        onKeyDown={(event) => {
                            if (event.key !== "ArrowDown") return
                            event.preventDefault()
                            listRef.current
                                ?.querySelector<HTMLButtonElement>("[role=option]:not(:disabled)")
                                ?.focus()
                        }}
                        className={cn(
                            "box-border w-full appearance-none border-0 bg-transparent p-0 font-[inherit]",
                            "text-[13px] text-foreground outline-none placeholder:text-placeholder",
                        )}
                    />
                </label>
            ) : null}
            <div ref={listRef} className="flex min-h-0 flex-1 flex-col overflow-y-auto p-1">
                <FilterMenuOptionList
                    options={shown}
                    selected={selected}
                    autoFocus={autoFocus && !section.searchable}
                    emptyText={
                        query
                            ? `Nothing matches “${term.trim()}”.`
                            : (section.emptyText ?? `No ${section.label.toLowerCase()} options`)
                    }
                    onDismiss={onDismiss}
                    onSelect={onSelect}
                />
            </div>
        </>
    )
}
