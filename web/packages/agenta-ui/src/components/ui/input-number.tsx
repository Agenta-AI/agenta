import * as React from "react"

import {CaretDown, CaretUp} from "@phosphor-icons/react"
import {cva, type VariantProps} from "class-variance-authority"

import {cn} from "./utils"

/**
 * InputNumber — a cva numeric input in @agenta/ui that reproduces the subset of antd
 * `InputNumber` the app uses (stepper column + clamp + keyboard), re-skinned to the app
 * theme. Follows shadcn's source conventions (no `forwardRef`; `data-slot`).
 *
 * Geometry/typography reuse the SAME `control-*`/`input-*`/`field-*` tokens as the text
 * `Input` primitive (input.tsx), so the field's border, height, radius and focus glow match
 * `Input` exactly — the wrapper carries the box (border + `py-input-y*` + `rounded-control*`
 * + focus-within glow) while the inner input sits borderless/transparent with the size's
 * `px-input*` + `text-field*` ramp, the same wrapper/inner split as `InputAffix`. Values are
 * theme-invariant and encode antd's measured geometry (app theme: `controlHeight`=28,
 * `controlHeightSM`=24, base `fontSize`=12) via those tokens, never raw pixels. `box-border`
 * is required (preflight is OFF app-wide).
 *
 * antd → @agenta/ui size mapping: `small`→sm tokens, `middle`(default)→default, `large`→lg.
 *
 * Behavior decisions (match antd's InputNumber, focused subset):
 *   - Steppers reveal on wrapper hover (`group-hover`) and on focus (`group-focus-within`),
 *     like antd's `.ant-input-number-handler-wrap`.
 *   - Clamp to [min,max] happens on blur and on each step; typing is NOT clamped mid-edit
 *     (antd lets you overshoot while focused, then clamps on blur).
 *   - Empty/non-numeric on blur emits `null` (antd's empty→empty). Stepping from empty
 *     bases at 0, so up/down land on `clamp(±step)`.
 *   - ArrowUp/ArrowDown step ±`step` (clamped) and preventDefault; Enter commits (clamps).
 *   - Float drift is contained by rounding step results to `step`'s decimal count.
 *
 * Deferred (not in the app's usage; add via composition when needed): `formatter`/`parser`,
 * `precision`, `controls={false}`, `addonBefore`/`addonAfter`, `prefix`, `stringMode`,
 * keyboard hold-to-repeat, and mouse-wheel stepping.
 */
const inputNumberVariants = cva(
    [
        // CONTROL_RESET — see input.tsx/button.tsx (preflight is off app-wide). `relative` +
        // `overflow-hidden` let the ABSOLUTE stepper column run the field's full inner height
        // (flush, corners clipped to the radius) like antd's handler-wrap. The wrapper's own focus
        // glow (`box-shadow`) is unaffected by `overflow-hidden` — only child content is clipped.
        "group relative box-border inline-flex w-full items-stretch border border-solid font-[inherit]",
        "overflow-hidden text-foreground transition-colors",
    ],
    {
        variants: {
            state: {
                // Matches Input's `default` variant border/hover/focus exactly.
                enabled:
                    "bg-background border-border hover:border-btn-primary-hover focus-within:border-primary focus-within:shadow-[0_0_0_2px_var(--ag-controlOutline)]",
                disabled: "cursor-not-allowed bg-disabled-bg border-disabled-border text-disabled",
            },
            size: {
                small: "rounded-control-sm",
                middle: "rounded-control",
                large: "rounded-control-lg",
            },
            // Mirrors Input's `ghost` (= antd's `variant="borderless"`): no box of its own, so
            // it melts into a container that already draws one.
            variant: {
                default: "",
                ghost: "bg-transparent border-0 hover:border-0 focus-within:border-0 focus-within:shadow-none",
            },
        },
        defaultVariants: {state: "enabled", size: "middle", variant: "default"},
    },
)

type Size = "small" | "middle" | "large"

// The borderless inner input carries the field geometry (px + py + type ramp) exactly like
// the text Input; the wrapper only adds the border, so total height matches Input.
const innerBySize: Record<Size, string> = {
    small: "px-input-sm py-input-y-sm text-field-sm",
    middle: "px-input py-input-y text-field-md",
    large: "px-input-lg py-input-y-lg text-field-lg",
}

const toText = (value: number | null | undefined): string =>
    value === null || value === undefined ? "" : String(value)

const parse = (text: string): number | null => {
    const trimmed = text.trim()
    if (trimmed === "") return null
    const parsed = Number(trimmed)
    return Number.isFinite(parsed) ? parsed : null
}

const decimalsOf = (step: number): number => {
    const str = String(step)
    const dot = str.indexOf(".")
    return dot === -1 ? 0 : str.length - dot - 1
}

// Round a step result to `step`'s decimal count so 0.1+0.2 reads 0.3, not 0.30000000004.
const roundToStep = (value: number, decimals: number): number =>
    Number(value.toFixed(Math.min(decimals, 100)))

const clamp = (value: number, min?: number, max?: number): number =>
    Math.min(max ?? Number.POSITIVE_INFINITY, Math.max(min ?? Number.NEGATIVE_INFINITY, value))

export interface InputNumberProps
    extends
        Omit<React.ComponentProps<"input">, "value" | "onChange" | "size" | "type" | "prefix">,
        VariantProps<typeof inputNumberVariants> {
    value?: number | null
    onChange?: (value: number | null) => void
    min?: number
    max?: number
    step?: number
    disabled?: boolean
    /** antd size names; mapped to the sm/default/lg control scale. */
    size?: Size
    placeholder?: string
    /** Reaches the wrapper — `[&_input]:text-center` etc. target the inner input from here. */
    className?: string
    style?: React.CSSProperties
}

export function InputNumber({
    value,
    onChange,
    min,
    max,
    step = 1,
    disabled = false,
    size = "middle",
    variant = "default",
    placeholder,
    className,
    style,
    onKeyDown,
    onBlur,
    ...rest
}: InputNumberProps) {
    const [text, setText] = React.useState<string>(() => toText(value))

    // Re-sync from a controlled `value` only when it no longer matches the typed text, so an
    // in-progress edit (e.g. "1." or "-") isn't clobbered on every render.
    React.useEffect(() => {
        setText((prev) => {
            const parsed = parse(prev)
            if (parsed === value || (parsed === null && (value === null || value === undefined))) {
                return prev
            }
            return toText(value)
        })
    }, [value])

    const decimals = decimalsOf(step)

    const commit = React.useCallback(
        (next: number | null) => {
            setText(toText(next))
            onChange?.(next)
        },
        [onChange],
    )

    const applyStep = React.useCallback(
        (direction: 1 | -1) => {
            if (disabled) return
            const base = parse(text) ?? 0
            const stepped = roundToStep(base + direction * step, decimals)
            commit(clamp(stepped, min, max))
        },
        [disabled, text, step, decimals, commit, min, max],
    )

    const handleChange = (event: React.ChangeEvent<HTMLInputElement>) => {
        const raw = event.target.value
        setText(raw)
        if (raw.trim() === "") {
            onChange?.(null)
            return
        }
        const parsed = parse(raw)
        // Emit numeric edits unclamped (antd clamps on blur/step); hold on intermediates
        // like "-" or "1." until they parse.
        if (parsed !== null) onChange?.(parsed)
    }

    const handleBlur = (event: React.FocusEvent<HTMLInputElement>) => {
        const parsed = parse(text)
        commit(parsed === null ? null : clamp(parsed, min, max))
        onBlur?.(event)
    }

    const handleKeyDown = (event: React.KeyboardEvent<HTMLInputElement>) => {
        if (event.key === "ArrowUp") {
            event.preventDefault()
            applyStep(1)
        } else if (event.key === "ArrowDown") {
            event.preventDefault()
            applyStep(-1)
        } else if (event.key === "Enter") {
            const parsed = parse(text)
            commit(parsed === null ? null : clamp(parsed, min, max))
        }
        onKeyDown?.(event)
    }

    const stepperButton =
        "flex flex-1 items-center justify-center border-0 border-solid bg-transparent p-0 text-colorTextDescription transition-colors"

    return (
        <span
            data-slot="input-number"
            style={style}
            className={cn(
                inputNumberVariants({state: disabled ? "disabled" : "enabled", size, variant}),
                className,
            )}
        >
            <input
                type="text"
                inputMode="decimal"
                role="spinbutton"
                aria-valuenow={value ?? undefined}
                aria-valuemin={min}
                aria-valuemax={max}
                disabled={disabled}
                placeholder={placeholder}
                value={text}
                onChange={handleChange}
                onBlur={handleBlur}
                onKeyDown={handleKeyDown}
                className={cn(
                    "min-w-0 flex-1 border-0 bg-transparent font-[inherit] text-inherit outline-none placeholder:text-placeholder disabled:cursor-not-allowed",
                    innerBySize[size],
                )}
                {...rest}
            />
            <span
                data-slot="input-number-steppers"
                aria-hidden
                className={cn(
                    // ABSOLUTE like antd's `.ant-input-number-handler-wrap` — in flow it would
                    // permanently steal 22px of the field's inner width, pushing a centred value
                    // (`[&_input]:text-center`) 11px off-centre and shrinking the typing room.
                    "absolute inset-y-0 right-0 flex w-[22px] flex-col border-0 border-l border-solid border-colorBorderSecondary bg-background opacity-0 transition-opacity",
                    !disabled && "group-hover:opacity-100 group-focus-within:opacity-100",
                )}
            >
                <button
                    type="button"
                    tabIndex={-1}
                    aria-label="Increase value"
                    disabled={disabled}
                    onClick={() => applyStep(1)}
                    className={cn(
                        stepperButton,
                        "border-b border-colorBorderSecondary",
                        !disabled && "cursor-pointer hover:text-colorText",
                        disabled && "cursor-not-allowed",
                    )}
                >
                    <CaretUp size={8} weight="bold" />
                </button>
                <button
                    type="button"
                    tabIndex={-1}
                    aria-label="Decrease value"
                    disabled={disabled}
                    onClick={() => applyStep(-1)}
                    className={cn(
                        stepperButton,
                        !disabled && "cursor-pointer hover:text-colorText",
                        disabled && "cursor-not-allowed",
                    )}
                >
                    <CaretDown size={8} weight="bold" />
                </button>
            </span>
        </span>
    )
}

export {inputNumberVariants}
