/**
 * The connection card's "Active models" section.
 *
 * The list is what this connection will offer: the models the provider just named, plus anything
 * saved or hand-entered that it did not. Checking a model is a policy choice, so the card always
 * saves the explicit list — including an empty one, which means "offer none".
 *
 * One field above the list both searches it and adds a model ID it does not hold, in every state,
 * because a provider's list is never a promise that nothing else works. The bordered list below is
 * the card's only flexible region, so its rows scroll inside it.
 */
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

/**
 * The floor the list never shrinks below — three rows.
 *
 * On a viewport too short for the card's fixed sections, this is what forces the DRAWER BODY to
 * scroll instead of squeezing the list to nothing.
 */
const MIN_LIST_HEIGHT = 96

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
    const canAdd = Boolean(term) && !options.some((option) => option.id === term)
    const addTerm = () => {
        if (!canAdd) return
        onAddManual(term)
        setSearch("")
    }

    return (
        <section className="flex min-h-0 flex-1 flex-col gap-2">
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

            <div
                className="flex min-h-0 flex-1 flex-col overflow-hidden rounded-md border border-solid border-colorBorderSecondary"
                style={{minHeight: MIN_LIST_HEIGHT}}
            >
                {canAdd ? (
                    <button
                        type="button"
                        onClick={addTerm}
                        className="flex w-full shrink-0 cursor-pointer items-center gap-2 border-0 border-b border-solid border-colorSplit bg-transparent px-3 py-2 text-left text-field-sm text-colorText hover:bg-colorFillQuaternary"
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
                        <p className="m-0 px-3 py-3 text-colorTextSecondary">
                            No models yet. Type a model ID above to add it.
                        </p>
                    )
                ) : (
                    <ScrollScrim>
                        {visible.map((option) => (
                            <label
                                key={option.id}
                                className="flex cursor-pointer items-center gap-2 border-0 border-b border-solid border-colorSplit px-3 py-1.5 last:border-b-0 hover:bg-colorFillQuaternary"
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
                                    <Tag size="small" tone="default" label="recommended" />
                                ) : null}
                                {option.unavailable ? (
                                    <Tag size="small" tone="warning" label="unavailable" />
                                ) : null}
                            </label>
                        ))}
                    </ScrollScrim>
                )}

                <div
                    className={`shrink-0 items-center justify-between gap-2 border-0 border-t border-solid border-colorSplit py-1 pl-3 pr-2 text-field-sm ${truncated || fetchedAt ? "flex" : "hidden"}`}
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
