/** A connection's model list, with one field that searches it and adds IDs it lacks. */
import {useMemo, useState} from "react"

import {
    activeModelsCount,
    modelListView,
    relativeFetchTime,
    type ModelOption,
} from "@agenta/entities/secret"
import {Tag} from "@agenta/ui"
import {Button, Checkbox, InputAffix} from "@agenta/ui/ui"
import {ArrowClockwise, MagnifyingGlass, Plus} from "@phosphor-icons/react"

import ScrollScrim from "./ScrollScrim"

export interface ActiveModelsSectionProps {
    options: ModelOption[]
    onToggle: (id: string, checked: boolean) => void
    onSelectAll: () => void
    onClear: () => void
    onAddManual: (id: string) => void
    /** What the manual row offers to add against — the API's list, or one endpoint's. */
    manualPlaceholder: string
    /** Set only when a live fetch answered — drives the timestamp line and the re-fetch action. */
    fetchedAt?: string | null
    onRefetch?: () => void
    refetching?: boolean
}

// How many rows mount before "Show all N", and whether it belongs: `modelListView`.

const ActiveModelsSection = ({
    options,
    onToggle,
    onSelectAll,
    onClear,
    onAddManual,
    manualPlaceholder,
    fetchedAt,
    onRefetch,
    refetching,
}: ActiveModelsSectionProps) => {
    const [search, setSearch] = useState("")
    const [showAll, setShowAll] = useState(false)

    const activeCount = useMemo(() => options.filter((option) => option.checked).length, [options])

    const matching = useMemo(() => {
        const term = search.trim().toLowerCase()
        if (!term) return options
        return options.filter(
            (option) =>
                option.id.toLowerCase().includes(term) || option.name?.toLowerCase().includes(term),
        )
    }, [options, search])

    const {truncated, visibleCount} = modelListView({total: matching.length, showAll})
    const visible = truncated ? matching.slice(0, visibleCount) : matching

    const term = search.trim()
    const canAdd =
        Boolean(term) &&
        !options.some(
            (option) =>
                option.id.toLowerCase() === term.toLowerCase() ||
                option.name?.toLowerCase() === term.toLowerCase(),
        )
    const addTerm = () => {
        if (!canAdd) return
        onAddManual(term)
        setSearch("")
    }

    return (
        <section className="flex shrink-0 flex-col gap-2">
            <div className="flex shrink-0 items-baseline justify-between gap-2">
                <span className="font-medium text-colorText">
                    Active models{" "}
                    <span className="font-normal text-colorTextTertiary">
                        — {activeModelsCount(activeCount, options.length)}
                    </span>
                </span>
                <div className="flex items-center gap-2 text-field-sm">
                    <Button variant="link" size="sm" className="h-auto px-0" onClick={onSelectAll}>
                        Select all
                    </Button>
                    <Button variant="link" size="sm" className="h-auto px-0" onClick={onClear}>
                        Clear
                    </Button>
                </div>
            </div>

            <InputAffix
                className="shrink-0"
                placeholder={
                    options.length
                        ? `Search ${options.length} models or add an ID`
                        : manualPlaceholder
                }
                prefix={<MagnifyingGlass size={14} className="text-colorTextTertiary" />}
                allowClear
                value={search}
                onValueChange={setSearch}
                onKeyDown={(event) => {
                    if (event.key !== "Enter") return
                    event.preventDefault()
                    addTerm()
                }}
            />

            {/* Sized to its rows, so a short list leaves no empty box; a long one scrolls. */}
            <div className="flex max-h-[min(320px,45vh)] flex-col overflow-hidden">
                {canAdd ? (
                    <button
                        type="button"
                        onClick={addTerm}
                        className="flex shrink-0 cursor-pointer items-center gap-2 rounded border-0 bg-transparent px-2 py-2 text-left text-field-sm text-colorText hover:bg-colorFillQuaternary"
                    >
                        <Plus size={14} className="shrink-0 text-colorTextTertiary" />
                        <span className="min-w-0 truncate">
                            Add <span className="font-mono">{term}</span>
                        </span>
                        <span className="ml-auto shrink-0 text-field-xs text-colorTextTertiary">
                            Enter
                        </span>
                    </button>
                ) : null}

                {visible.length === 0 ? (
                    canAdd ? null : (
                        <p className="m-0 px-2 py-3 text-colorTextSecondary">
                            No models yet. Type a model ID above to add it.
                        </p>
                    )
                ) : (
                    <ScrollScrim>
                        {visible.map((option) => (
                            <label
                                key={option.id}
                                className="flex cursor-pointer items-center gap-2.5 rounded px-2 py-2 hover:bg-colorFillQuaternary"
                            >
                                <Checkbox
                                    checked={option.checked}
                                    onCheckedChange={(next) => onToggle(option.id, next === true)}
                                />
                                <span className="min-w-0 flex-1">
                                    <span className="block truncate text-field-sm text-colorText">
                                        {option.name ?? option.id}
                                    </span>
                                    {option.name ? (
                                        <span className="block truncate font-mono text-field-xs text-colorTextTertiary">
                                            {option.id}
                                        </span>
                                    ) : null}
                                </span>
                                {option.isDefault ? (
                                    <span className="shrink-0 text-field-xs text-colorTextTertiary">
                                        Recommended
                                    </span>
                                ) : null}
                                {option.unavailable ? (
                                    <Tag size="small" tone="warning" label="unavailable" />
                                ) : null}
                            </label>
                        ))}
                    </ScrollScrim>
                )}

                <div
                    className={`shrink-0 items-center justify-between gap-2 py-1 pl-2 pr-1 text-field-sm ${truncated || fetchedAt ? "flex" : "hidden"}`}
                >
                    {truncated ? (
                        <Button
                            variant="link"
                            size="sm"
                            className="h-auto px-0"
                            onClick={() => setShowAll(true)}
                        >
                            Show all {matching.length}
                        </Button>
                    ) : (
                        <span />
                    )}
                    {fetchedAt ? (
                        <span className="flex items-center gap-1 text-colorTextTertiary">
                            <ArrowClockwise size={13} />
                            Fetched {relativeFetchTime(fetchedAt)} ·
                            {onRefetch ? (
                                <Button
                                    variant="link"
                                    size="sm"
                                    className="h-auto px-0"
                                    onClick={onRefetch}
                                    disabled={refetching}
                                >
                                    Re-fetch
                                </Button>
                            ) : null}
                        </span>
                    ) : null}
                </div>
            </div>
        </section>
    )
}

export default ActiveModelsSection
