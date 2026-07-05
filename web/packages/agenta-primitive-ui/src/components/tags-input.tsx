"use client"

import * as React from "react"

import {Popover as PopoverPrimitive} from "@base-ui/react/popover"
import {X} from "@phosphor-icons/react"

import {cn} from "@agenta/primitive-ui/lib/utils"

export interface TagInputProps {
    value: string[]
    onChange: (tags: string[]) => void
    placeholder?: string
    disabled?: boolean
    separator?: string | string[]
    maxTags?: number
    options?: {value: string; label: string}[]
    className?: string
    size?: "sm" | "default"
}

function getSeparatorRegex(separator: string | string[]): RegExp {
    const seps = Array.isArray(separator) ? separator : [separator]
    const escaped = seps.map((s) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"))
    return new RegExp(`[${escaped.join("")}]`)
}

export function TagInput({
    value,
    onChange,
    placeholder = "Add tags...",
    disabled = false,
    separator = ",",
    maxTags,
    options,
    className,
    size = "default",
}: TagInputProps) {
    const [inputValue, setInputValue] = React.useState("")
    const [open, setOpen] = React.useState(false)
    const inputRef = React.useRef<HTMLInputElement>(null)
    const containerRef = React.useRef<HTMLDivElement>(null)

    const separators = React.useMemo(
        () => (Array.isArray(separator) ? separator : [separator]),
        [separator],
    )

    const addTag = React.useCallback(
        (tag: string) => {
            const trimmed = tag.trim()
            if (!trimmed) return
            if (value.includes(trimmed)) return
            if (maxTags !== undefined && value.length >= maxTags) return
            onChange([...value, trimmed])
        },
        [value, onChange, maxTags],
    )

    const removeTag = React.useCallback(
        (index: number) => {
            if (disabled) return
            onChange(value.filter((_, i) => i !== index))
        },
        [value, onChange, disabled],
    )

    const handleKeyDown = React.useCallback(
        (e: React.KeyboardEvent<HTMLInputElement>) => {
            if (disabled) return

            if (e.key === "Enter") {
                e.preventDefault()
                addTag(inputValue)
                setInputValue("")
                return
            }

            if (e.key === "Backspace" && !inputValue && value.length > 0) {
                removeTag(value.length - 1)
                return
            }

            if (separators.includes(e.key)) {
                e.preventDefault()
                const beforeSep = inputValue.replace(getSeparatorRegex(separator), "")
                if (beforeSep.trim()) {
                    addTag(beforeSep)
                }
                setInputValue("")
                return
            }
        },
        [disabled, inputValue, value, addTag, removeTag, separators, separator],
    )

    const handlePaste = React.useCallback(
        (e: React.ClipboardEvent<HTMLInputElement>) => {
            if (disabled) return
            const pasted = e.clipboardData.getData("text")
            const regex = getSeparatorRegex(separator)
            const parts = pasted.split(regex).filter(Boolean)
            if (parts.length > 1) {
                e.preventDefault()
                const newTags: string[] = []
                for (const part of parts) {
                    const trimmed = part.trim()
                    if (!trimmed) continue
                    if (value.includes(trimmed)) continue
                    if (maxTags !== undefined && value.length + newTags.length >= maxTags) break
                    newTags.push(trimmed)
                }
                if (newTags.length > 0) {
                    onChange([...value, ...newTags])
                }
            }
        },
        [disabled, value, onChange, separator, maxTags],
    )

    const filteredOptions = React.useMemo(() => {
        if (!options || !inputValue) return []
        const lower = inputValue.toLowerCase()
        return options.filter(
            (opt) =>
                opt.label.toLowerCase().includes(lower) || opt.value.toLowerCase().includes(lower),
        )
    }, [options, inputValue])

    const handleSelectSuggestion = React.useCallback(
        (selectedValue: string) => {
            addTag(selectedValue)
            setInputValue("")
            inputRef.current?.focus()
        },
        [addTag],
    )

    React.useEffect(() => {
        if (options && inputValue && filteredOptions.length > 0) {
            setOpen(true)
        } else {
            setOpen(false)
        }
    }, [options, inputValue, filteredOptions.length])

    const handleContainerClick = React.useCallback(() => {
        if (!disabled) {
            inputRef.current?.focus()
        }
    }, [disabled])

    const isAtMax = maxTags !== undefined && value.length >= maxTags

    const containerClasses = cn(
        "flex w-full flex-wrap items-center gap-1.5 rounded-lg border border-input bg-transparent px-2.5 py-1.5 text-sm transition-colors outline-none focus-within:border-ring focus-within:ring-3 focus-within:ring-ring/50",
        disabled && "cursor-not-allowed opacity-50",
        size === "sm" && "min-h-7",
        size === "default" && "min-h-8",
        className,
    )

    const tagClasses =
        "inline-flex items-center gap-1 rounded-md bg-secondary px-2 py-0.5 text-sm font-medium"

    const removeButtonClasses =
        "inline-flex cursor-pointer items-center text-muted-foreground hover:text-foreground"

    const inputClasses =
        "flex-1 min-w-[80px] bg-transparent text-sm outline-none placeholder:text-muted-foreground"

    const popupClasses =
        "relative isolate z-50 max-h-(--available-height) w-(--anchor-width) min-w-36 overflow-x-hidden overflow-y-auto rounded-lg bg-popover text-popover-foreground shadow-md ring-1 ring-foreground/10"

    const suggestionItemClasses =
        "relative flex w-full cursor-default items-center gap-1.5 rounded-md py-1 pe-8 ps-1.5 text-sm outline-hidden select-none focus:bg-accent focus:text-accent-foreground data-disabled:pointer-events-none data-disabled:opacity-50"

    const tags = value.map((tag, index) => (
        <span key={`${tag}-${index}`} className={tagClasses}>
            {tag}
            <button
                type="button"
                disabled={disabled}
                className={removeButtonClasses}
                onClick={(e) => {
                    e.stopPropagation()
                    removeTag(index)
                }}
                tabIndex={-1}
            >
                <X weight="bold" className="size-3" />
            </button>
        </span>
    ))

    const input = !isAtMax ? (
        <input
            ref={inputRef}
            type="text"
            value={inputValue}
            onChange={(e) => {
                if (disabled) return
                setInputValue(e.target.value)
            }}
            onKeyDown={handleKeyDown}
            onPaste={handlePaste}
            placeholder={value.length === 0 ? placeholder : ""}
            disabled={disabled}
            className={inputClasses}
        />
    ) : null

    const containerContent = (
        <>
            {tags}
            {input}
        </>
    )

    if (!options) {
        return (
            <div ref={containerRef} className={containerClasses} onClick={handleContainerClick}>
                {containerContent}
            </div>
        )
    }

    return (
        <PopoverPrimitive.Root open={open} onOpenChange={setOpen}>
            <PopoverPrimitive.Trigger
                render={
                    <div
                        ref={containerRef}
                        className={containerClasses}
                        onClick={handleContainerClick}
                    />
                }
            >
                {containerContent}
            </PopoverPrimitive.Trigger>
            {filteredOptions.length > 0 && (
                <PopoverPrimitive.Portal>
                    <PopoverPrimitive.Positioner
                        side="bottom"
                        align="start"
                        sideOffset={4}
                        className="isolate z-50"
                    >
                        <PopoverPrimitive.Popup className={popupClasses}>
                            {filteredOptions.map((option) => (
                                <div
                                    key={option.value}
                                    className={suggestionItemClasses}
                                    onClick={() => handleSelectSuggestion(option.value)}
                                    role="option"
                                    aria-selected={value.includes(option.value)}
                                >
                                    {option.label}
                                </div>
                            ))}
                        </PopoverPrimitive.Popup>
                    </PopoverPrimitive.Positioner>
                </PopoverPrimitive.Portal>
            )}
        </PopoverPrimitive.Root>
    )
}
