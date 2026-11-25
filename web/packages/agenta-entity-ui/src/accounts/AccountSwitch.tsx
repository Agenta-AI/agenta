/** Two or more choices side by side, each a label and a short note; the caller passes all text. */
import {useLayoutEffect, useRef, useState, type KeyboardEvent} from "react"

import {cn} from "@agenta/ui"

export interface AccountSwitchChoice<Value extends string> {
    value: Value
    label: string
    /** One short sentence under the label. */
    note?: string
    /** Shown but not choosable (for example, not on this plan); arrow keys skip it. */
    disabled?: boolean
}

export interface AccountSwitchProps<Value extends string> {
    value: Value
    choices: AccountSwitchChoice<Value>[]
    onChange: (next: Value) => void
    /** Names the group for assistive tech. */
    "aria-label": string
    disabled?: boolean
    className?: string
}

export function AccountSwitch<Value extends string>({
    value,
    choices,
    onChange,
    "aria-label": ariaLabel,
    disabled,
    className,
}: AccountSwitchProps<Value>) {
    const refs = useRef<(HTMLButtonElement | null)[]>([])
    const trackRef = useRef<HTMLDivElement>(null)
    const selectedIndex = Math.max(
        0,
        choices.findIndex((choice) => choice.value === value),
    )
    // One thumb under the selected choice that slides to the next one, as in the kit Segmented.
    const [thumb, setThumb] = useState<{
        left: number
        top: number
        width: number
        height: number
    } | null>(null)
    const [ready, setReady] = useState(false)
    useLayoutEffect(() => {
        const measure = () => {
            const node = refs.current[selectedIndex]
            if (!node) return
            setThumb({
                left: node.offsetLeft,
                top: node.offsetTop,
                width: node.offsetWidth,
                height: node.offsetHeight,
            })
        }
        measure()
        const track = trackRef.current
        if (!track || typeof ResizeObserver === "undefined") return
        const observer = new ResizeObserver(measure)
        observer.observe(track)
        return () => observer.disconnect()
    }, [selectedIndex, choices.length])
    useLayoutEffect(() => {
        if (thumb && !ready) requestAnimationFrame(() => setReady(true))
    }, [thumb, ready])

    // Arrow keys move the choice and the focus together.
    const onKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
        if (disabled) return
        const step =
            event.key === "ArrowRight" || event.key === "ArrowDown"
                ? 1
                : event.key === "ArrowLeft" || event.key === "ArrowUp"
                  ? -1
                  : 0
        if (!step) return
        event.preventDefault()
        let next = selectedIndex
        for (let tries = 0; tries < choices.length; tries++) {
            next = (next + step + choices.length) % choices.length
            if (!choices[next].disabled) break
        }
        if (choices[next].disabled) return
        onChange(choices[next].value)
        refs.current[next]?.focus()
    }

    return (
        <div
            ref={trackRef}
            role="radiogroup"
            aria-label={ariaLabel}
            aria-disabled={disabled || undefined}
            onKeyDown={onKeyDown}
            // A segmented track: the secondary fill, 2px inset, concentric corners (SHAPE-02).
            className={cn("relative flex gap-0.5 rounded-lg bg-secondary p-0.5", className)}
        >
            {thumb ? (
                <div
                    aria-hidden
                    className={cn(
                        "pointer-events-none absolute left-0 rounded-md border border-solid border-border bg-background",
                        ready &&
                            "transition-[transform,width,height] duration-200 ease-[cubic-bezier(0.645,0.045,0.355,1)]",
                    )}
                    style={{
                        transform: `translateX(${thumb.left}px)`,
                        top: thumb.top,
                        width: thumb.width,
                        height: thumb.height,
                    }}
                />
            ) : null}
            {choices.map((choice, index) => {
                const selected = index === selectedIndex
                return (
                    <button
                        key={choice.value}
                        ref={(node) => {
                            refs.current[index] = node
                        }}
                        type="button"
                        role="radio"
                        aria-checked={selected}
                        tabIndex={selected ? 0 : -1}
                        disabled={disabled || choice.disabled}
                        onClick={() => {
                            if (!selected) onChange(choice.value)
                        }}
                        className={cn(
                            "flex min-w-0 flex-1 cursor-pointer flex-col items-start gap-0.5 rounded-md border border-solid px-2.5 py-2 text-left font-[inherit] outline-none transition-colors",
                            "focus-ring",
                            "disabled:cursor-not-allowed disabled:opacity-60",
                            // The thumb draws the selected box; the choice stays clear above it.
                            "relative border-transparent bg-transparent",
                            !selected && "enabled:hover:bg-accent",
                        )}
                    >
                        <span
                            className={cn(
                                // 13/20 on the desktop, 14/20 on a phone (M09).
                                "text-label font-medium leading-5",
                                selected ? "text-foreground" : "text-muted-foreground",
                            )}
                        >
                            {choice.label}
                        </span>
                        {choice.note ? (
                            <span
                                className={cn(
                                    // 12/16: `text-xs` is 13 px in /m.
                                    "text-meta",
                                    selected ? "text-muted-foreground" : "text-muted-foreground",
                                )}
                            >
                                {choice.note}
                            </span>
                        ) : null}
                    </button>
                )
            })}
        </div>
    )
}
