/**
 * FiltersPopoverTrigger — filter button + popover, on the `@agenta/ui` (Radix) `Popover`.
 *
 * 0 antd runtime and 0 antd type dependency: the local prop surface below reproduces the antd
 * `PopoverProps` fields the call-sites pass. Extend it here rather than editing a call-site.
 *
 * DOM parity: `PopoverContent` plays antd's `.ant-popover` root (positioned, no chrome), the inner
 * div plays `.ant-popover-container` (bg / radius / shadow / 12px pad) — so `overlayStyle` and
 * `styles.root` land on the same node antd puts them on.
 */

import {useCallback, useMemo, useState, type CSSProperties, type ReactNode} from "react"

import {Funnel} from "@phosphor-icons/react"

import {Button, type ButtonProps} from "../../../components/ui/button"
import {Popover, PopoverContent, PopoverTrigger} from "../../../components/ui/popover"
import {cn} from "../../../components/ui/utils"

/** antd `Popover.placement` — the 12-way antd placement vocabulary. */
type PopoverPlacement =
    | "top"
    | "left"
    | "right"
    | "bottom"
    | "topLeft"
    | "topRight"
    | "bottomLeft"
    | "bottomRight"
    | "leftTop"
    | "leftBottom"
    | "rightTop"
    | "rightBottom"

/** antd `Popover.styles` semantic-DOM style slots (index sig accepts any antd semantic key). */
interface PopoverSemanticStyles {
    root?: CSSProperties
    container?: CSSProperties
    /** Inert: antd v6 dropped `body`; kept for source compatibility. */
    body?: CSSProperties
    /** Inert: this popover renders no title/content sub-node. */
    content?: CSSProperties
    title?: CSSProperties
    /** Inert: the Radix popover has no arrow part. */
    arrow?: CSSProperties
    [key: string]: CSSProperties | undefined
}

/** antd `Popover.classNames` semantic-DOM class slots (index sig accepts any antd semantic key). */
interface PopoverSemanticClassNames {
    root?: string
    container?: string
    body?: string
    content?: string
    title?: string
    arrow?: string
    [key: string]: string | undefined
}

// antd v6 `styles`/`classNames` are resolvable: an object or `(info) => object`. Only the object
// form is consumed; the props param is intentionally loose so any antd resolver assigns here.
type PopoverStyles = PopoverSemanticStyles | ((info: {props: any}) => PopoverSemanticStyles) // eslint-disable-line @typescript-eslint/no-explicit-any
type PopoverClassNames =
    | PopoverSemanticClassNames
    | ((info: {props: any}) => PopoverSemanticClassNames) // eslint-disable-line @typescript-eslint/no-explicit-any

/**
 * Local, antd-compatible overlay prop surface (antd's `open`/`onOpenChange`/`content`/`children`/
 * `trigger` stay owned by this component, as before).
 */
interface FiltersPopoverOverlayProps {
    /** Inert: the Radix popover has no arrow part (every call-site already passes `false`). */
    arrow?: boolean | {pointAtCenter?: boolean}
    /** antd `overlayStyle` → `styles.root`: the positioned wrapper, not the card. */
    overlayStyle?: CSSProperties
    /** antd `overlayInnerStyle` → `styles.container`: the card. */
    overlayInnerStyle?: CSSProperties
    overlayClassName?: string
    className?: string
    style?: CSSProperties
    styles?: PopoverStyles
    classNames?: PopoverClassNames
    placement?: PopoverPlacement
    zIndex?: number
    destroyOnHidden?: boolean
    autoAdjustOverflow?: boolean
    mouseEnterDelay?: number
    mouseLeaveDelay?: number
    [key: `data-${string}`]: unknown
}

interface FiltersPopoverTriggerProps {
    label?: ReactNode
    filterCount?: number
    buttonVariant?: ButtonProps["variant"]
    /** Deprecated antd `Button.type` alias. Accepted for source compatibility; inert (the trigger
     * has always rendered the default/outline button regardless of this prop). */
    buttonType?: string
    icon?: ReactNode
    renderContent: (close: () => void, context: {isOpen: boolean}) => ReactNode
    placement?: PopoverPlacement
    initialOpen?: boolean
    buttonProps?: Omit<ButtonProps, "variant" | "icon">
    popoverProps?: FiltersPopoverOverlayProps
    onOpenChange?: (open: boolean) => void
}

// antd placement (12-way) → Radix side/align.
const toSide = (p?: string): "top" | "right" | "bottom" | "left" =>
    !p
        ? "top"
        : p.startsWith("bottom")
          ? "bottom"
          : p.startsWith("left")
            ? "left"
            : p.startsWith("right")
              ? "right"
              : "top"

const toAlign = (p?: string): "start" | "center" | "end" =>
    p?.endsWith("Left") || p?.endsWith("Top")
        ? "start"
        : p?.endsWith("Right") || p?.endsWith("Bottom")
          ? "end"
          : "center"

const resolveStyles = (styles?: PopoverStyles): PopoverSemanticStyles =>
    (typeof styles === "function" ? styles({props: {}}) : styles) ?? {}

const resolveClassNames = (classNames?: PopoverClassNames): PopoverSemanticClassNames =>
    (typeof classNames === "function" ? classNames({props: {}}) : classNames) ?? {}

// antd popups nested in the content (Popover/DatePicker/Select) portal to <body>, so Radix reads a
// click inside one as "outside" and would close us. antd's own trigger chain keeps it open.
const ANTD_POPUP_SELECTOR =
    ".ant-popover, .ant-picker-dropdown, .ant-select-dropdown, .ant-cascader-dropdown, .ant-dropdown, .ant-tooltip, .ant-modal-root"

const isInsideAntdPopup = (target: EventTarget | null) =>
    target instanceof Element && !!target.closest(ANTD_POPUP_SELECTOR)

const FilterCountBadge = ({count}: {count: number}) => (
    <span className="inline-flex items-center justify-center min-w-[20px] h-[20px] !px-1 rounded-md bg-chip text-foreground text-xs font-medium">
        {count}
    </span>
)

const FiltersPopoverTrigger = ({
    label,
    filterCount = 0,
    buttonVariant = "outline",
    icon,
    renderContent,
    placement = "bottomRight",
    initialOpen = false,
    buttonProps,
    popoverProps,
    onOpenChange,
}: FiltersPopoverTriggerProps) => {
    const [isOpen, setIsOpen] = useState(initialOpen)

    const handleOpenChange = useCallback(
        (open: boolean) => {
            setIsOpen(open)
            onOpenChange?.(open)
        },
        [onOpenChange],
    )

    const content = useMemo(
        () => renderContent(() => setIsOpen(false), {isOpen}),
        [renderContent, isOpen],
    )

    const overlayStyles = resolveStyles(popoverProps?.styles)
    const overlayClassNames = resolveClassNames(popoverProps?.classNames)

    return (
        <Popover open={isOpen} onOpenChange={handleOpenChange}>
            <PopoverTrigger asChild>
                <Button
                    variant={buttonVariant}
                    {...buttonProps}
                    onClick={(event) => {
                        event.stopPropagation()
                        buttonProps?.onClick?.(event)
                    }}
                    className="flex items-center gap-2 !px-1.5"
                >
                    {icon ?? <Funnel size={16} />}
                    {label}
                    <FilterCountBadge count={filterCount} />
                </Button>
            </PopoverTrigger>
            <PopoverContent
                side={toSide(popoverProps?.placement ?? placement)}
                align={toAlign(popoverProps?.placement ?? placement)}
                // antd does not move focus into the popover on open.
                onOpenAutoFocus={(event) => event.preventDefault()}
                onInteractOutside={(event) => {
                    if (isInsideAntdPopup(event.detail.originalEvent.target)) event.preventDefault()
                }}
                className={cn(
                    popoverProps?.overlayClassName,
                    overlayClassNames.root,
                    popoverProps?.className,
                )}
                style={{
                    // Plays antd's `.ant-popover` root: chrome lives on the container below.
                    // Inline (not utility classes) so it beats `PopoverContent`'s own defaults.
                    background: "transparent",
                    boxShadow: "none",
                    borderRadius: 0,
                    padding: 0,
                    ...overlayStyles.root,
                    ...popoverProps?.overlayStyle,
                    ...popoverProps?.style,
                    ...(popoverProps?.zIndex !== undefined
                        ? {zIndex: popoverProps.zIndex}
                        : undefined),
                }}
            >
                {/* Plays antd's `.ant-popover-container`: bg / radius / shadow / 12px padding. */}
                <div
                    className={cn(
                        "box-border rounded-control-lg bg-popover text-popover-foreground shadow-overlay p-3",
                        overlayClassNames.container,
                    )}
                    style={{...overlayStyles.container, ...popoverProps?.overlayInnerStyle}}
                >
                    {content}
                </div>
            </PopoverContent>
        </Popover>
    )
}

export default FiltersPopoverTrigger
