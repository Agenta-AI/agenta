/** Two or more choices side by side, each a label and a short note: a Segmented whose choices need a word of explanation. */
import {useLayoutEffect, useRef, useState, type KeyboardEvent} from "react"

import {cn} from "../../foundation/utils/cn"

export interface ChoiceSwitchOption<Value extends string> {
    value: Value
    label: string
    /** A short muted word on the label's line, after it ("Detected"). */
    tag?: string
    /** One short sentence under the label. */
    note?: string
    /** Shown but not choosable (for example, not on this plan); arrow keys skip it. */
    disabled?: boolean
}

export interface ChoiceSwitchProps<Value extends string> {
    value: Value
    choices: ChoiceSwitchOption<Value>[]
    onChange: (next: Value) => void
    /** Names the group for assistive tech. */
    "aria-label": string
    disabled?: boolean
    className?: string
}

export function ChoiceSwitch<Value extends string>({
    value,
    choices,
    onChange,
    "aria-label": ariaLabel,
    disabled,
    className,
}: ChoiceSwitchProps<Value>) {
    // Label-only choices read as a segmented control: centered, as Segmented draws them.
    const centered = !choices.some((choice) => choice.note)
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
        let tries = 0
        while (tries < choices.length) {
            next = (next + step + choices.length) % choices.length
            if (!choices[next].disabled) break
            tries++
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
                        "pointer-events-none absolute left-0 rounded-md bg-background",
                        ready &&
                            "transition-[transform,width,height] duration-[var(--duration-base)] ease-[var(--ease-in-out)]",
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
                            "flex min-w-0 flex-1 cursor-pointer flex-col gap-0.5 rounded-md border-0 px-2.5 py-2 font-[inherit] outline-none transition-colors duration-[var(--duration-fast)]",
                            centered ? "items-center text-center" : "items-start text-left",
                            "focus-ring",
                            "disabled:cursor-not-allowed disabled:opacity-60",
                            // The thumb draws the selected box by tone, as in Segmented; the choice stays clear above it.
                            "relative bg-transparent",
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
                            {choice.tag ? (
                                <span className="ml-1.5 text-meta font-normal text-muted-foreground">
                                    {choice.tag}
                                </span>
                            ) : null}
                        </span>
                        {choice.note ? (
                            <span
                                className={cn(
                                    // 12/16, two lines tall: every choice card is one height (70 px).
                                    "min-h-8 text-meta text-muted-foreground",
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
