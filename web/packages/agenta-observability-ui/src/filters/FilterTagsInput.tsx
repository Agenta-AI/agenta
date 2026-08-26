import {useMemo, useRef, useState, type KeyboardEvent} from "react"

import {Badge, Popover, PopoverAnchor, PopoverContent, selectTriggerVariants} from "@agenta/ui/ui"
import {XIcon} from "@phosphor-icons/react"
import clsx from "clsx"

/**
 * Multi-value entry with suggestions — the one control in the filter row that `@agenta/ui`
 * has no primitive for (antd `<Select mode="tags" />`). Radix Select is single-select and
 * Combobox commits one value, so this lives here until a shared primitive earns its place.
 *
 * Parity with the call site it replaces: the same token separators, free text is committed
 * as-is (the field may be a key the options never listed), Backspace on an empty query pops
 * the last tag, and blur commits whatever is typed.
 */

export type FilterTagValue = string | number

export interface FilterTagsInputProps {
    value: FilterTagValue[]
    onChange: (next: FilterTagValue[]) => void
    options?: {label: string; value: FilterTagValue}[]
    placeholder?: string
    disabled?: boolean
    invalid?: boolean
    className?: string
    /** Portal target for the suggestion panel; keeps it inside the filter dialog. */
    container?: HTMLElement | null
    "aria-label"?: string
}

const TOKEN_SEPARATORS = [",", " ", "\n", "\t", ";"]

const splitOnSeparators = (raw: string): string[] =>
    raw
        .split(/[\s,;\n\r\t]+/g)
        .map((token) => token.trim())
        .filter(Boolean)

export function FilterTagsInput({
    value,
    onChange,
    options,
    placeholder,
    disabled = false,
    invalid = false,
    className,
    container,
    "aria-label": ariaLabel,
}: FilterTagsInputProps) {
    const [query, setQuery] = useState("")
    const [open, setOpen] = useState(false)
    const inputRef = useRef<HTMLInputElement>(null)

    const selected = useMemo(() => new Set(value.map((entry) => String(entry))), [value])

    const suggestions = useMemo(() => {
        if (!options?.length) return []
        const needle = query.trim().toLowerCase()
        return options.filter((option) => {
            if (selected.has(String(option.value))) return false
            if (!needle) return true
            return (
                option.label.toLowerCase().includes(needle) ||
                String(option.value).toLowerCase().includes(needle)
            )
        })
    }, [options, query, selected])

    const commit = (tokens: FilterTagValue[]) => {
        const next = [...value]
        for (const token of tokens) {
            if (next.some((entry) => String(entry) === String(token))) continue
            next.push(token)
        }
        if (next.length !== value.length) onChange(next)
        setQuery("")
    }

    const commitQuery = () => {
        const tokens = splitOnSeparators(query)
        if (tokens.length) commit(tokens)
        else setQuery("")
    }

    const removeAt = (index: number) => {
        const next = value.filter((_, i) => i !== index)
        onChange(next)
    }

    const onInputChange = (raw: string) => {
        if (TOKEN_SEPARATORS.some((separator) => raw.includes(separator))) {
            const tokens = splitOnSeparators(raw)
            const trailingSeparator = TOKEN_SEPARATORS.some((separator) => raw.endsWith(separator))
            const keep = trailingSeparator ? "" : (tokens.pop() ?? "")
            if (tokens.length) commit(tokens)
            setQuery(keep)
            return
        }
        setQuery(raw)
        if (!open) setOpen(true)
    }

    const onKeyDown = (event: KeyboardEvent<HTMLInputElement>) => {
        if (event.key === "Enter") {
            event.preventDefault()
            commitQuery()
            return
        }
        if (event.key === "Backspace" && !query && value.length) {
            event.preventDefault()
            removeAt(value.length - 1)
            return
        }
        if (event.key === "Escape") setOpen(false)
    }

    const showPanel = open && suggestions.length > 0 && !disabled

    return (
        <Popover open={showPanel} onOpenChange={setOpen}>
            <PopoverAnchor asChild>
                <div
                    className={clsx(
                        selectTriggerVariants({size: "default"}),
                        "h-auto min-h-control flex-wrap justify-start gap-1 py-[3px]",
                        disabled && "cursor-not-allowed bg-disabled-bg",
                        className,
                    )}
                    aria-invalid={invalid || undefined}
                    onClick={() => {
                        if (!disabled) inputRef.current?.focus()
                    }}
                >
                    {value.map((entry, index) => (
                        <Badge
                            key={`${String(entry)}-${index}`}
                            variant="outlined"
                            className="max-w-full gap-1"
                        >
                            <span className="truncate">{String(entry)}</span>
                            {!disabled && (
                                <button
                                    type="button"
                                    aria-label={`Remove ${String(entry)}`}
                                    className="flex cursor-pointer items-center border-0 bg-transparent p-0 text-placeholder hover:text-foreground"
                                    onClick={(event) => {
                                        event.stopPropagation()
                                        removeAt(index)
                                    }}
                                >
                                    <XIcon size={10} />
                                </button>
                            )}
                        </Badge>
                    ))}
                    <input
                        ref={inputRef}
                        role="combobox"
                        aria-expanded={showPanel}
                        aria-autocomplete="list"
                        aria-label={ariaLabel}
                        disabled={disabled}
                        value={query}
                        placeholder={value.length ? undefined : placeholder}
                        className="min-w-[60px] flex-1 border-0 bg-transparent p-0 text-field-md text-foreground outline-none placeholder:text-placeholder disabled:cursor-not-allowed"
                        onChange={(event) => onInputChange(event.target.value)}
                        onKeyDown={onKeyDown}
                        onFocus={() => setOpen(true)}
                        onBlur={() => {
                            commitQuery()
                            setOpen(false)
                        }}
                    />
                </div>
            </PopoverAnchor>
            <PopoverContent
                container={container}
                align="start"
                className="max-h-[60vh] w-[var(--radix-popover-trigger-width)] overflow-auto p-1"
                onOpenAutoFocus={(event) => event.preventDefault()}
            >
                <div role="listbox">
                    {suggestions.map((option) => (
                        <div
                            key={String(option.value)}
                            role="option"
                            aria-selected={false}
                            className="box-border flex min-h-control cursor-pointer items-center rounded-control-sm px-3 py-1 text-field-md hover:bg-muted"
                            onMouseDown={(event) => {
                                // Commit before the input's blur handler eats the click.
                                event.preventDefault()
                                commit([option.value])
                            }}
                        >
                            {option.label}
                        </div>
                    ))}
                </div>
            </PopoverContent>
        </Popover>
    )
}

export default FilterTagsInput
