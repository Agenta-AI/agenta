import {useEffect, useRef, useState} from "react"

import {Check} from "lucide-react"

import {cn} from "../components/ui/utils"

import type {FilterMenuOption} from "./types"

/**
 * The option list behind every flyout — and, on its own, the whole of {@link GroupMenu}.
 *
 * Owns its roving focus rather than leaning on Radix's typeahead: the panel above it carries a
 * search input, and a menu's typeahead steals the letters that input needs.
 */
export const FilterMenuOptionList = ({
    options,
    selected,
    emptyText = "Nothing to choose from",
    autoFocus = true,
    onSelect,
    onDismiss,
    className,
}: {
    options: FilterMenuOption[]
    /** Every currently-checked value; a single-select row passes one. */
    selected: string[]
    emptyText?: string
    autoFocus?: boolean
    onSelect: (value: string) => void
    /** Left / Escape — the flyout's caller decides what closing means. */
    onDismiss?: () => void
    className?: string
}) => {
    const refs = useRef<(HTMLButtonElement | null)[]>([])
    const firstEnabled = options.findIndex((option) => !option.disabled)
    const [active, setActive] = useState(() => (firstEnabled === -1 ? 0 : firstEnabled))

    useEffect(() => {
        if (!autoFocus) return
        // Focus follows the active index, so navigation is never yanked back to the top.
        refs.current[active]?.focus()
    }, [active, autoFocus])

    const move = (delta: number) => {
        if (!options.length) return
        let next = active
        let steps = options.length
        while (steps > 0) {
            next = (next + delta + options.length) % options.length
            if (!options[next]?.disabled) break
            steps -= 1
        }
        setActive(next)
    }

    if (!options.length) {
        return (
            <p
                className={cn(
                    "m-0 px-3 py-6 text-center text-[12px] text-muted-foreground",
                    className,
                )}
            >
                {emptyText}
            </p>
        )
    }

    return (
        <div
            role="listbox"
            aria-orientation="vertical"
            className={cn("flex flex-col", className)}
            onKeyDown={(event) => {
                if (event.key === "ArrowDown") {
                    event.preventDefault()
                    move(1)
                } else if (event.key === "ArrowUp") {
                    event.preventDefault()
                    move(-1)
                } else if (event.key === "ArrowLeft") {
                    event.preventDefault()
                    onDismiss?.()
                }
            }}
        >
            {options.map((option, index) => {
                const checked = selected.includes(option.value)
                return (
                    <button
                        key={option.value}
                        ref={(node) => {
                            refs.current[index] = node
                        }}
                        type="button"
                        role="option"
                        aria-selected={checked}
                        disabled={option.disabled}
                        tabIndex={index === active ? 0 : -1}
                        onFocus={() => setActive(index)}
                        onClick={() => onSelect(option.value)}
                        className={cn(
                            // Preflight is off app-wide (antd ships its own reset), so a bare
                            // <button> needs the resets restated.
                            "box-border cursor-pointer appearance-none border-0 bg-transparent font-[inherit]",
                            "flex w-full items-center gap-2 rounded-control-sm px-2 py-1.5 text-left",
                            "text-[13px] text-foreground outline-none transition-colors",
                            "hover:bg-accent focus-visible:bg-accent",
                            "disabled:cursor-not-allowed disabled:text-disabled disabled:hover:bg-transparent",
                        )}
                    >
                        {option.icon ? (
                            <span className="flex size-4 shrink-0 items-center justify-center text-muted-foreground">
                                {option.icon}
                            </span>
                        ) : null}
                        <span className="min-w-0 flex-1 truncate">{option.label}</span>
                        {/* The check keeps its box whether or not it is drawn, so the label
                            column never shifts as the selection moves. */}
                        <span className="flex size-4 shrink-0 items-center justify-center">
                            {checked ? <Check size={14} aria-hidden /> : null}
                        </span>
                    </button>
                )
            })}
        </div>
    )
}
