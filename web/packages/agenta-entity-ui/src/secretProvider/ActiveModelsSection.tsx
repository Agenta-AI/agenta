/**
 * The connection card's "Active models" section.
 *
 * The list is what this connection will offer: the models the provider just named, plus anything
 * saved or hand-entered that it did not. Checking a model is a policy choice, so the card always
 * saves the explicit list — including an empty one, which means "offer none".
 *
 * One bordered container holds the whole block: search pinned at the top, the rows, then manual
 * entry and the fetch line pinned at the bottom. This is the CARD's only flexible region — every
 * pixel the fixed sections do not need goes to the rows, which is what keeps the footer off the
 * bottom of an empty column — and the rows scroll inside it.
 *
 * Manual entry is available in every state (with discovery, without it, before any test), because
 * a provider's list is never a promise that nothing else works.
 */
import {useMemo, useState} from "react"

import {
    activeModelsCount,
    type DiscoveryStatus,
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
    /** Used in the fallback note when discovery did not return the provider's own list. */
    title: string
    /** Set only when a live fetch answered — drives the timestamp line and the re-fetch action. */
    fetchedAt?: string | null
    /** Shows whether the list came from discovery or a bundled fallback. */
    discoveryStatus?: DiscoveryStatus | null
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
    title,
    fetchedAt,
    discoveryStatus,
    onRefetch,
    refetching,
}: ActiveModelsSectionProps) => {
    const [search, setSearch] = useState("")
    const [manualId, setManualId] = useState("")
    const [showAll, setShowAll] = useState(false)

    const activeCount = useMemo(() => options.filter((option) => option.checked).length, [options])

    const matching = useMemo(() => {
        const term = search.trim().toLowerCase()
        if (!term) return options
        return options.filter((option) => option.id.toLowerCase().includes(term))
    }, [options, search])

    const {truncated, visibleCount} = modelListView({total: matching.length, showAll})
    const visible = truncated ? matching.slice(0, visibleCount) : matching

    const addManual = () => {
        const id = manualId.trim()
        if (!id) return
        onAddManual(id)
        setManualId("")
    }

    const catalogNote =
        discoveryStatus === "fetched"
            ? null
            : discoveryStatus == null
              ? `Showing Agenta's shipped catalog. ${title}'s own list has not been fetched yet.`
              : `Showing Agenta's shipped catalog. ${title}'s own list was not fetched.`

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

            <div
                className="flex min-h-0 flex-1 flex-col overflow-hidden rounded-md border border-solid border-colorBorderSecondary"
                style={{minHeight: MIN_LIST_HEIGHT}}
            >
                <div className="shrink-0 border-0 border-b border-solid border-colorSplit">
                    <InputAffix
                        variant="ghost"
                        placeholder={`Search ${options.length} models`}
                        prefix={<MagnifyingGlass size={14} className="text-colorTextTertiary" />}
                        allowClear
                        // InputAffix sizes its inner <input> from the size variant, so the row's
                        // type scale has to be set through it rather than on the wrapper.
                        className="[&_input]:!text-xs"
                        value={search}
                        onValueChange={setSearch}
                    />
                </div>

                {catalogNote ? (
                    <p className="m-0 border-0 border-b border-solid border-colorSplit px-3 py-2 text-colorTextTertiary">
                        {catalogNote}
                    </p>
                ) : null}

                {visible.length === 0 ? (
                    <p className="m-0 border-0 border-b border-solid border-colorSplit px-3 py-3 text-colorTextSecondary">
                        {options.length === 0
                            ? "No models yet. Add a model ID below."
                            : "No model matches this search."}
                    </p>
                ) : (
                    <ScrollScrim>
                        {visible.map((option) => (
                            <label
                                key={option.id}
                                className="flex cursor-pointer items-center gap-2 border-0 border-b border-solid border-colorSplit px-3 py-1.5 hover:bg-colorFillQuaternary"
                            >
                                <Checkbox
                                    checked={option.checked}
                                    onCheckedChange={(next) => onToggle(option.id, next === true)}
                                />
                                <span className="min-w-0 flex-1 truncate font-mono text-field-sm text-colorText">
                                    {option.id}
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

                <div className="flex shrink-0 items-center gap-1 pl-3 pr-2">
                    <Plus size={14} className="shrink-0 text-colorTextTertiary" />
                    <InputAffix
                        variant="ghost"
                        className="min-w-0 flex-1 font-mono [&_input]:!text-field-sm"
                        placeholder={manualPlaceholder}
                        value={manualId}
                        onValueChange={setManualId}
                        onKeyDown={(event) => {
                            if (event.key !== "Enter") return
                            event.preventDefault()
                            addManual()
                        }}
                    />
                    <Button
                        variant="link"
                        size="sm"
                        className="h-auto shrink-0 px-1"
                        onClick={addManual}
                        disabled={!manualId.trim()}
                    >
                        Add
                    </Button>
                </div>

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
