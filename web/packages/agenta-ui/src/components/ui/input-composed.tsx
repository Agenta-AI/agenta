import * as React from "react"

import {Eye, EyeSlash, MagnifyingGlass, XCircle} from "@phosphor-icons/react"

import {type InputProps, Textarea, type TextareaProps, inputVariants} from "./input"
import {cn} from "./utils"

/**
 * Compositions over the Input primitive, covering the antd features shadcn's Input
 * deliberately doesn't have. Current shadcn source style throughout: no `forwardRef`
 * (React 19 passes `ref` as a prop) and a `data-slot` on each root.
 */

type SizeVariant = NonNullable<InputProps["size"]>

/** The inner borderless input needs the size's type ramp; the wrapper carries the box. */
const fontBySize: Record<SizeVariant, string> = {
    sm: "text-field-sm",
    default: "text-field-md",
    lg: "text-field-lg",
}

/**
 * InputAffix — input with prefix/suffix and/or a clear button (replaces antd's
 * prefix/suffix + allowClear). The wrapper carries the border/bg and the input sits
 * borderless inside it, which is the same structure antd uses, so affixed and unaffixed
 * inputs line up.
 */
export interface InputAffixProps extends Omit<InputProps, "prefix"> {
    prefix?: React.ReactNode
    suffix?: React.ReactNode
    allowClear?: boolean
    /**
     * Value-first change callback (the Radix/shadcn idiom). Fires on typing AND on clear,
     * so a controlled caller needs only this one prop — nothing has to fabricate a
     * synthetic `change` event to report a clear through `onChange`.
     */
    onValueChange?: (value: string) => void
    /** Fired in addition to `onValueChange("")` when the clear button is pressed. */
    onClear?: () => void
}

export function InputAffix({
    className,
    variant,
    size: sizeProp,
    prefix,
    suffix,
    allowClear,
    onClear,
    onChange,
    onValueChange,
    disabled,
    value,
    defaultValue,
    ref,
    ...rest
}: InputAffixProps) {
    const size = sizeProp ?? "default"
    const innerRef = React.useRef<HTMLInputElement | null>(null)

    // Mirror an uncontrolled value in state so `hasValue` comes from React data rather
    // than a DOM read during render.
    const isControlled = value !== undefined
    const [innerValue, setInnerValue] = React.useState(defaultValue ?? "")
    const currentValue = isControlled ? value : innerValue
    const hasValue = String(currentValue ?? "").length > 0
    const showClear = Boolean(allowClear) && hasValue && !disabled

    const handleChange = (event: React.ChangeEvent<HTMLInputElement>) => {
        if (!isControlled) setInnerValue(event.target.value)
        onChange?.(event)
        onValueChange?.(event.target.value)
    }

    const handleClear = () => {
        const el = innerRef.current
        if (!isControlled) {
            setInnerValue("")
            if (el) el.value = ""
        }
        // A clear is just "the value is now empty" — no event forgery required.
        onValueChange?.("")
        onClear?.()
        el?.focus()
    }

    return (
        <span
            data-slot="input-affix"
            className={cn(
                inputVariants({variant, size}),
                "inline-flex items-center gap-1",
                className,
            )}
        >
            {prefix ? (
                <span className="flex shrink-0 items-center text-placeholder">{prefix}</span>
            ) : null}
            <input
                ref={(node) => {
                    innerRef.current = node
                    if (typeof ref === "function") ref(node)
                    else if (ref) ref.current = node
                }}
                disabled={disabled}
                {...(isControlled ? {value} : {defaultValue})}
                onChange={handleChange}
                className={cn(
                    "min-w-0 flex-1 border-0 bg-transparent p-0 font-[inherit] text-foreground outline-none placeholder:text-placeholder",
                    fontBySize[size],
                )}
                {...rest}
            />
            {suffix ? (
                <span className="flex shrink-0 items-center text-placeholder">{suffix}</span>
            ) : null}
            {showClear ? (
                <button
                    type="button"
                    tabIndex={-1}
                    onClick={handleClear}
                    aria-label="clear"
                    // antd's clear icon is colorTextQuaternary, NOT colorTextPlaceholder — the two
                    // share a value in light but not in dark (input/style/index.js L356).
                    className="flex shrink-0 items-center border-0 bg-transparent p-0 text-colorTextQuaternary hover:text-foreground"
                >
                    <XCircle size={14} weight="fill" />
                </button>
            ) : null}
        </span>
    )
}

/**
 * SearchInput — a prefixed, clearable input.
 *
 * NOT a reproduction of antd's `Input.Search`, which also renders a trailing search
 * button; that button was deliberately dropped. See antd-inventory/migrations/Input.md.
 */
export function SearchInput({prefix, ...props}: InputAffixProps) {
    return (
        <InputAffix
            data-slot="search-input"
            prefix={prefix ?? <MagnifyingGlass size={14} />}
            allowClear
            {...props}
        />
    )
}

/** PasswordInput — input with a show/hide toggle (replaces antd Input.Password). */
export function PasswordInput(props: InputAffixProps) {
    const [show, setShow] = React.useState(false)
    return (
        <InputAffix
            data-slot="password-input"
            type={show ? "text" : "password"}
            suffix={
                <button
                    type="button"
                    tabIndex={-1}
                    onClick={() => setShow((s) => !s)}
                    aria-label={show ? "hide" : "show"}
                    className="flex items-center border-0 bg-transparent p-0 text-placeholder hover:text-foreground"
                >
                    {show ? <EyeSlash size={14} /> : <Eye size={14} />}
                </button>
            }
            {...props}
        />
    )
}

/** AutosizeTextarea — textarea that grows with content (replaces antd TextArea autoSize). */
export interface AutosizeTextareaProps extends TextareaProps {
    autoSize?: boolean | {minRows?: number; maxRows?: number}
    onPressEnter?: (event: React.KeyboardEvent<HTMLTextAreaElement>) => void
}

export function AutosizeTextarea({
    autoSize = true,
    onPressEnter,
    onKeyDown,
    onChange,
    rows,
    ref,
    className,
    ...props
}: AutosizeTextareaProps) {
    const innerRef = React.useRef<HTMLTextAreaElement | null>(null)

    const resize = React.useCallback(() => {
        const el = innerRef.current
        if (!el || !autoSize) return
        const cs = getComputedStyle(el)
        // border-box: scrollHeight covers content+padding but not borders, so add those
        // back, and express row clamps as rows*line-height + padding + borders (antd's
        // arithmetic — a naive rows*line-height comes out 18px short).
        const borders = parseFloat(cs.borderTopWidth) + parseFloat(cs.borderBottomWidth)
        const chrome = parseFloat(cs.paddingTop) + parseFloat(cs.paddingBottom) + borders
        const lineHeight = parseFloat(cs.lineHeight) || 20
        el.style.height = "auto"
        let height = el.scrollHeight + borders
        if (typeof autoSize === "object") {
            if (autoSize.minRows) height = Math.max(height, autoSize.minRows * lineHeight + chrome)
            if (autoSize.maxRows) height = Math.min(height, autoSize.maxRows * lineHeight + chrome)
        }
        el.style.height = `${height}px`
        el.style.overflowY = typeof autoSize === "object" && autoSize.maxRows ? "auto" : "hidden"
    }, [autoSize])

    React.useLayoutEffect(resize, [resize, props.value])

    return (
        <Textarea
            data-slot="autosize-textarea"
            ref={(node) => {
                innerRef.current = node
                if (typeof ref === "function") ref(node)
                else if (ref) ref.current = node
            }}
            // rows=1 while autosizing: the effect sets the real height, and Textarea's
            // rows=3 default would otherwise flash a 3-row box on first paint.
            rows={autoSize ? 1 : rows}
            // antd's autoSize TextArea is NOT user-resizable (the effect owns the height); without
            // this the native corner grabber shows and dragging it fights the autosize.
            className={cn(autoSize && "resize-none", className)}
            onKeyDown={(event) => {
                if (event.key === "Enter") onPressEnter?.(event)
                onKeyDown?.(event)
            }}
            onChange={(event) => {
                onChange?.(event)
                resize()
            }}
            {...props}
        />
    )
}
