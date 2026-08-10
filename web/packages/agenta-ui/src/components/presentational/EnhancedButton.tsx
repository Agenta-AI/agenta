import {Button, type ButtonProps} from "../ui/button"
import {LoadingButton} from "../ui/button-composed"
import {Tooltip, TooltipContent, TooltipProvider, TooltipTrigger} from "../ui/tooltip"
import {cn} from "../ui/utils"

type ButtonVariant = NonNullable<ButtonProps["variant"]>

// Local antd-compatible unions (mirror antd's literal types) so this file needs no antd import.
type AntButtonType = "default" | "primary" | "dashed" | "link" | "text"
// antd `SizeType` — `middle` is the legacy alias for `medium`; both are accepted by call-sites.
type AntButtonSize = "small" | "medium" | "middle" | "large"
type AntButtonShape = "default" | "circle" | "round" | "square"
type AntLoadingConfig = boolean | {delay?: number; icon?: React.ReactNode}
type AntTooltipPlacement = string

// Local antd-compatible tooltip surface (subset of antd `TooltipProps`) the facade reads, plus
// the passthrough props call-sites set (`mouseEnterDelay`/`arrow`) that the facade ignores.
interface LocalTooltipProps {
    title?: React.ReactNode | (() => React.ReactNode)
    placement?: AntTooltipPlacement
    open?: boolean
    defaultOpen?: boolean
    onOpenChange?: (open: boolean) => void
    mouseEnterDelay?: number
    mouseLeaveDelay?: number
    arrow?: boolean | {pointAtCenter?: boolean}
}

/**
 * EnhancedButton — antd `Button`+`Tooltip` convenience, now a FACADE over the `@agenta/ui`
 * Button + Radix Tooltip (fully off antd). Keeps a local antd-compatible props shape (no antd
 * import) so call-sites are unchanged, translating the used surface: `type`/`danger`→variant,
 * `size`→size, `icon`→leading child, `loading`→LoadingButton, `shape="circle"`→icon size + 50%
 * radius (`"round"`→pill),
 * `htmlType`→native type, `block`→full-width. `tooltipProps.title`→Radix tooltip
 * (placement→side). No title → bare Button. Deferred (rare / unused): `ghost`,
 * `iconPosition="end"`, `arrow={false}`.
 */
// Local antd-compatible props (no antd import): reproduces the antd `ButtonProps` surface the
// call-sites use, so they pass their existing antd props unchanged; the facade translates the
// ones our Button expresses differently and drops the antd-only ones.
export interface EnhancedButtonProps extends Omit<
    React.ButtonHTMLAttributes<HTMLButtonElement>,
    "type"
> {
    ref?: React.Ref<HTMLButtonElement>
    label?: React.ReactNode
    tooltipProps?: LocalTooltipProps
    // antd visual variant (shadows the native HTML `type`, which the facade maps from `htmlType`).
    type?: AntButtonType
    size?: AntButtonSize
    shape?: AntButtonShape
    danger?: boolean
    ghost?: boolean
    block?: boolean
    loading?: AntLoadingConfig
    icon?: React.ReactNode
    iconPosition?: "start" | "end"
    htmlType?: "submit" | "reset" | "button"
    href?: string
    target?: string
    // antd-only props the facade accepts and drops so call-sites passing them still compile.
    // `classNames`/`styles` are `unknown` because antd types them as function-or-record unions
    // wider than a plain map; the facade discards them, so the exact shape is irrelevant.
    rootClassName?: string
    classNames?: unknown
    styles?: unknown
    autoInsertSpace?: boolean
}

// antd `type`+`danger` → @agenta/ui variant (per Button.tsx's documented mapping).
const toVariant = (type: AntButtonType | undefined, danger?: boolean): ButtonVariant => {
    if (danger) return type === "primary" ? "destructive" : "destructive-outline"
    switch (type) {
        case "primary":
            return "default"
        case "text":
            return "ghost"
        case "link":
            return "link"
        case "dashed":
            return "dashed"
        default:
            return "outline" // antd default (bordered)
    }
}

const toSize = (size: AntButtonSize | undefined): ButtonProps["size"] =>
    size === "small" ? "sm" : size === "large" ? "lg" : "default"

const toSide = (
    p: AntTooltipPlacement | undefined,
): "top" | "right" | "bottom" | "left" | undefined =>
    !p
        ? undefined
        : p.startsWith("top")
          ? "top"
          : p.startsWith("bottom")
            ? "bottom"
            : p.startsWith("left")
              ? "left"
              : p.startsWith("right")
                ? "right"
                : undefined

function EnhancedButton({
    label,
    tooltipProps,
    ref,
    type,
    size,
    danger,
    icon,
    loading,
    shape,
    htmlType,
    className,
    children,
    // antd-only props dropped so they don't leak onto the native <button>:
    block: _block,
    ghost: _ghost,
    iconPosition: _iconPosition,
    rootClassName: _rootClassName,
    classNames: _classNames,
    styles: _styles,
    ...rest
}: EnhancedButtonProps) {
    const isIconOnly = shape === "circle" && label == null && children == null
    const uiSize = isIconOnly ? (size === "small" ? "icon-sm" : "icon") : toSize(size)
    // antd `shape="circle"|"round"` is a RADIUS change (50% / pill), not just a square box — the
    // size variants only carry `rounded-control*`, so without this a circle button rendered as a
    // rounded square. `className` still wins (tailwind-merge puts it last).
    const shapeClass = shape === "circle" || shape === "round" ? "rounded-control-round" : undefined
    const content = (
        <>
            {icon}
            {label ?? children}
        </>
    )

    // antd `title` may be a render function; call it to get a node.
    const rawTitle = tooltipProps?.title
    const titleNode =
        typeof rawTitle === "function" ? (rawTitle as () => React.ReactNode)() : rawTitle

    // An icon-only button has no text, so a tooltip is its ONLY label — and a Radix tooltip does
    // not name its trigger. Without this, axe reports critical `button-name` on every
    // `<EnhancedButton icon={…} tooltipProps={{title}} />`, which is the common shape for row
    // actions. Borrow a string title as the accessible name; an explicit aria-label still wins.
    const tooltipLabel = typeof titleNode === "string" ? titleNode : undefined
    const needsLabel = label == null && children == null && icon != null

    const shared = {
        ref,
        variant: toVariant(type, danger),
        size: uiSize,
        type: htmlType,
        className: cn(shapeClass, className),
        ...(needsLabel && tooltipLabel ? {"aria-label": tooltipLabel} : {}),
        ...rest,
    } as ButtonProps

    const button = loading ? (
        <LoadingButton loading {...shared}>
            {content}
        </LoadingButton>
    ) : (
        <Button {...shared}>{content}</Button>
    )

    if (titleNode == null || tooltipProps == null) return button

    return (
        // antd `mouseEnterDelay` is in seconds → Radix `delayDuration` in ms; default 0.1s → 100ms.
        <TooltipProvider
            delayDuration={
                tooltipProps.mouseEnterDelay != null ? tooltipProps.mouseEnterDelay * 1000 : 100
            }
        >
            <Tooltip
                open={tooltipProps.open}
                defaultOpen={tooltipProps.defaultOpen}
                onOpenChange={tooltipProps.onOpenChange}
            >
                <TooltipTrigger asChild>{button}</TooltipTrigger>
                <TooltipContent side={toSide(tooltipProps.placement)}>{titleNode}</TooltipContent>
            </Tooltip>
        </TooltipProvider>
    )
}

export {EnhancedButton}
export default EnhancedButton
