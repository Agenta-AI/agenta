/** Two or more choices side by side, each a label and a short note; the caller passes all text. */
import {useRef, type KeyboardEvent} from "react"

import {cn} from "@agenta/ui"

export interface AccountSwitchChoice<Value extends string> {
    value: Value
    label: string
    /** One short sentence under the label. */
    note?: string
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
    const selectedIndex = Math.max(
        0,
        choices.findIndex((choice) => choice.value === value),
    )

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
        const next = (selectedIndex + step + choices.length) % choices.length
        onChange(choices[next].value)
        refs.current[next]?.focus()
    }

    return (
        <div
            role="radiogroup"
            aria-label={ariaLabel}
            aria-disabled={disabled || undefined}
            onKeyDown={onKeyDown}
            // The canvas track (F02 f6, M09): the split color, a solid gray in both themes.
            className={cn(
                "flex gap-0.5 rounded-[10px] bg-[var(--ag-colorSplit)] p-[3px]",
                className,
            )}
        >
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
                        disabled={disabled}
                        onClick={() => {
                            if (!selected) onChange(choice.value)
                        }}
                        className={cn(
                            "flex min-w-0 flex-1 cursor-pointer flex-col items-start gap-0.5 rounded-[8px] border border-solid px-2.5 py-2 text-left font-[inherit] outline-none transition-colors",
                            "focus-visible:outline-2 focus-visible:outline-offset-[-2px] focus-visible:outline-solid focus-visible:outline-ring",
                            "disabled:cursor-not-allowed disabled:opacity-60",
                            selected
                                ? "border-colorBorder bg-colorBgContainer shadow-xs"
                                : "border-transparent bg-transparent enabled:hover:bg-colorFillSecondary",
                        )}
                    >
                        <span
                            className={cn(
                                // 13/20 on the desktop, 14/20 on a phone (M09).
                                "text-[13px] font-medium leading-5 max-md:text-[14px]",
                                selected ? "text-colorText" : "text-colorTextSecondary",
                            )}
                        >
                            {choice.label}
                        </span>
                        {choice.note ? (
                            <span
                                className={cn(
                                    // 12/16: `text-xs` is 13 px in /m.
                                    "text-[12px] leading-4",
                                    selected ? "text-colorTextSecondary" : "text-colorTextTertiary",
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
