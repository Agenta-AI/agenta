/**
 * The connection card's "Active models" section.
 *
 * The list is what this connection will offer: the models the provider just named, plus anything
 * saved or hand-entered that it did not. Checking a model is a policy choice, so the card always
 * saves the explicit list — including an empty one, which means "offer none".
 *
 * Manual entry is available in every state (with discovery, without it, before any test), because
 * a provider's list is never a promise that nothing else works.
 */
import {useMemo, useState} from "react"

import type {ModelOption} from "@agenta/entities/secret"
import {Tag} from "@agenta/ui"
import {Button, Checkbox, InputAffix, SearchInput} from "@agenta/ui/ui"
import {ArrowClockwise, Plus} from "@phosphor-icons/react"

export interface ActiveModelsSectionProps {
    options: ModelOption[]
    onToggle: (id: string, checked: boolean) => void
    onSelectAll: () => void
    onClear: () => void
    onAddManual: (id: string) => void
    /** No list has been chosen yet, so the connection tracks Agenta's defaults rather than pinning them. */
    followingDefaults?: boolean
    /** Set only when a live fetch answered — drives the timestamp line and the re-fetch action. */
    fetchedAt?: string | null
    onRefetch?: () => void
    refetching?: boolean
}

/** "just now" / "3 min ago" / "2 h ago" — enough to judge whether the list is stale. */
const relativeTime = (iso: string): string => {
    const elapsed = Date.now() - new Date(iso).getTime()
    if (!Number.isFinite(elapsed) || elapsed < 0) return "just now"

    const minutes = Math.floor(elapsed / 60_000)
    if (minutes < 1) return "just now"
    if (minutes < 60) return `${minutes} min ago`

    const hours = Math.floor(minutes / 60)
    if (hours < 24) return `${hours} h ago`
    return `${Math.floor(hours / 24)} d ago`
}

const ActiveModelsSection = ({
    options,
    onToggle,
    onSelectAll,
    onClear,
    onAddManual,
    followingDefaults = false,
    fetchedAt,
    onRefetch,
    refetching,
}: ActiveModelsSectionProps) => {
    const [search, setSearch] = useState("")
    const [manualId, setManualId] = useState("")

    const activeCount = useMemo(() => options.filter((option) => option.checked).length, [options])

    const visible = useMemo(() => {
        const term = search.trim().toLowerCase()
        if (!term) return options
        return options.filter((option) => option.id.toLowerCase().includes(term))
    }, [options, search])

    const addManual = () => {
        const id = manualId.trim()
        if (!id) return
        onAddManual(id)
        setManualId("")
    }

    return (
        <section className="flex flex-col gap-3">
            <div className="flex items-center justify-between gap-2">
                <span className="font-medium text-colorText">
                    {followingDefaults
                        ? "Active models: following Agenta defaults"
                        : `Active models: ${activeCount} of ${options.length}`}
                </span>
                <div className="flex items-center gap-1">
                    <Button variant="ghost" size="sm" onClick={onSelectAll}>
                        Select all
                    </Button>
                    <Button variant="ghost" size="sm" onClick={onClear}>
                        Clear
                    </Button>
                </div>
            </div>

            <SearchInput
                placeholder="Search models"
                value={search}
                allowClear
                onValueChange={setSearch}
            />

            <div className="flex max-h-64 flex-col gap-1 overflow-y-auto">
                {visible.length === 0 ? (
                    <span className="py-2 text-colorTextSecondary">
                        {options.length === 0
                            ? "No models yet. Add a model ID below."
                            : "No model matches this search."}
                    </span>
                ) : (
                    visible.map((option) => (
                        <label
                            key={option.id}
                            className="flex cursor-pointer items-center gap-2 rounded py-1 hover:bg-[var(--ag-colorFillQuaternary)]"
                        >
                            <Checkbox
                                checked={option.checked}
                                onCheckedChange={(next) => onToggle(option.id, next === true)}
                            />
                            <span className="min-w-0 flex-1 truncate font-mono text-xs text-colorText">
                                {option.id}
                            </span>
                            {option.isDefault ? (
                                <Tag size="small" tone="default" label="default" />
                            ) : null}
                            {option.unavailable ? (
                                <Tag size="small" tone="warning" label="unavailable" />
                            ) : null}
                        </label>
                    ))
                )}
            </div>

            <div className="flex items-center gap-2">
                <InputAffix
                    placeholder="Add model ID"
                    value={manualId}
                    onValueChange={setManualId}
                    onKeyDown={(event) => {
                        if (event.key !== "Enter") return
                        event.preventDefault()
                        addManual()
                    }}
                />
                <Button variant="outline" onClick={addManual} disabled={!manualId.trim()}>
                    <Plus size={14} />
                    Add
                </Button>
            </div>

            {fetchedAt ? (
                <div className="flex items-center gap-2 text-colorTextSecondary">
                    <span>Fetched {relativeTime(fetchedAt)}</span>
                    {onRefetch ? (
                        <Button variant="ghost" size="sm" onClick={onRefetch} disabled={refetching}>
                            <ArrowClockwise size={14} />
                            Re-fetch
                        </Button>
                    ) : null}
                </div>
            ) : null}
        </section>
    )
}

export default ActiveModelsSection
