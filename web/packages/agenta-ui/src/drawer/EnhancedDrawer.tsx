/**
 * EnhancedDrawer — antd `Drawer`-compatible facade over the `@agenta/ui` (Radix) `Sheet`.
 *
 * Consolidation: this used to wrap antd `Drawer`. It now renders the `@agenta/ui` Sheet so the
 * call-sites (which pass antd `DrawerProps`) move off antd with NO call-site changes. It keeps the
 * wrapper's features — lazy mount-on-open, `width`/`height`, borderless panel + directional shadow,
 * internal body scroll — and translates a local, antd-compatible `DrawerProps` surface (declared
 * below; 0 antd type/runtime dependency) that mirrors the antd props call-sites pass.
 *
 * Covered: open · onClose · title · footer · extra · placement→side · width/height · closable ·
 * maskClosable · keyboard(Esc) · afterOpenChange · styles(body/header/footer) · className/rootClassName ·
 * zIndex · getContainer · destroyOnClose/Hidden (lazy) · closeOnLayoutClick (Radix outside-click).
 * Deferred (rare / unused): `mask={false}` (Radix always renders the overlay), custom `closeIcon`,
 * `push`, `loading`. Add if a call-site needs them.
 */

import {useCallback, useEffect, useMemo, useRef, useState} from "react"

import {Sheet, SheetContent, SheetFooter, SheetHeader, SheetTitle} from "../components/ui/sheet"
import {cn} from "../components/ui/utils"

// Local, antd-`Drawer`-compatible prop surface. This facade carries 0 antd runtime AND 0 antd
// type dependency; the shape below reproduces the antd `DrawerProps` fields the call-sites pass
// so they move off antd with no call-site changes. Add fields here (never edit a call-site) if a
// consumer passes a prop this surface is missing.

/** antd v6 `Drawer` `getContainer` — selector / element / fragment / factory / `false`. */
type DrawerContainer = Element | DocumentFragment
type DrawerGetContainer = string | DrawerContainer | (() => DrawerContainer) | false

/** antd `closable` — a boolean or the antd v6 object form (`{closeIcon, disabled, aria-*, ...}`). */
type DrawerClosable = boolean | object

/** antd `mask` — a boolean or the antd v6 `MaskConfig` object (`{enabled, blur, closable}`). */
type DrawerMask = boolean | object

/**
 * antd `mask` → overlay classes. Radix always renders an overlay (it owns outside-click and
 * focus trapping), so `mask={false}` cannot remove the element — it makes it transparent, which
 * is the same thing visually while keeping the behaviour Radix depends on.
 */
function maskClasses(mask: DrawerMask | undefined): string | undefined {
    if (mask === undefined || mask === true) return undefined
    if (mask === false) return "bg-transparent"
    const cfg = mask as {enabled?: boolean; blur?: boolean}
    return cn(cfg.enabled === false && "bg-transparent", cfg.blur && "backdrop-blur-sm")
}

/** antd `Drawer.styles` semantic-DOM style slots (index sig accepts any antd semantic key). */
interface DrawerSemanticStyles {
    mask?: React.CSSProperties
    wrapper?: React.CSSProperties
    header?: React.CSSProperties
    body?: React.CSSProperties
    footer?: React.CSSProperties
    content?: React.CSSProperties
    [key: string]: React.CSSProperties | undefined
}

/** antd `Drawer.classNames` semantic-DOM class slots (index sig accepts any antd semantic key). */
interface DrawerSemanticClassNames {
    mask?: string
    wrapper?: string
    header?: string
    body?: string
    footer?: string
    content?: string
    [key: string]: string | undefined
}

// antd v6 `styles`/`classNames` are resolvable: an object or `(info) => object`. The facade only
// consumes the object form; the props param is loose so any antd resolver assigns here.
type DrawerStylesProp = DrawerSemanticStyles | ((info: {props: any}) => DrawerSemanticStyles) // eslint-disable-line @typescript-eslint/no-explicit-any
type DrawerClassNamesProp =
    | DrawerSemanticClassNames
    | ((info: {props: any}) => DrawerSemanticClassNames) // eslint-disable-line @typescript-eslint/no-explicit-any

/**
 * Local, antd-compatible `Drawer` prop surface. Reproduces the antd `DrawerProps` fields the
 * call-sites use; extend it (do not edit a call-site) when a consumer needs another prop.
 */
interface DrawerProps {
    open?: boolean
    title?: React.ReactNode
    footer?: React.ReactNode
    extra?: React.ReactNode
    placement?: "top" | "right" | "bottom" | "left"
    width?: string | number
    height?: string | number
    size?: "default" | "large" | string | number
    closable?: DrawerClosable
    closeIcon?: React.ReactNode
    mask?: DrawerMask
    maskClosable?: boolean
    maskStyle?: React.CSSProperties
    keyboard?: boolean
    autoFocus?: boolean
    forceRender?: boolean
    destroyOnClose?: boolean
    destroyOnHidden?: boolean
    push?: boolean | {distance?: string | number}
    loading?: boolean
    zIndex?: number
    className?: string
    rootClassName?: string
    classNames?: DrawerClassNamesProp
    styles?: DrawerStylesProp
    style?: React.CSSProperties
    bodyStyle?: React.CSSProperties
    headerStyle?: React.CSSProperties
    drawerStyle?: React.CSSProperties
    contentWrapperStyle?: React.CSSProperties
    prefixCls?: string
    getContainer?: DrawerGetContainer
    afterOpenChange?: (open: boolean) => void
    onClose?: (e: React.MouseEvent | React.KeyboardEvent) => void
}

export interface EnhancedDrawerProps extends DrawerProps {
    children?: React.ReactNode
    /** antd `Drawer` had this; Radix already closes on outside-click, so it's effectively a no-op. */
    closeOnLayoutClick?: boolean
    /**
     * Accessible name used when the drawer renders no visible `title` (i.e. `closable={false}`
     * with no title or extra). Radix's dialog needs a name; without one axe reports
     * `aria-dialog-name`. Falls back to "Drawer" — pass something specific.
     */
    ariaLabel?: string
}

interface DrawerStyles {
    body?: React.CSSProperties
    header?: React.CSSProperties
    footer?: React.CSSProperties
    content?: React.CSSProperties
    wrapper?: React.CSSProperties
}

export function EnhancedDrawer(props: EnhancedDrawerProps) {
    const {
        children,
        open,
        onClose,
        title,
        footer,
        extra,
        placement = "right",
        width,
        height,
        size,
        closable = true,
        mask,
        maskClosable = true,
        keyboard = true,
        zIndex,
        getContainer,
        styles: customStyles,
        className,
        rootClassName,
        afterOpenChange,
        ariaLabel,
    } = props

    const [shouldRender, setShouldRender] = useState(!!open)
    const closeTimer = useRef<ReturnType<typeof setTimeout> | null>(null)

    useEffect(() => {
        if (open) setShouldRender(true)
    }, [open])

    // Radix has no `afterOpenChange`; approximate it (open immediately; close after the slide ~300ms).
    useEffect(() => {
        if (open) {
            afterOpenChange?.(true)
            return
        }
        if (!shouldRender) return
        closeTimer.current = setTimeout(() => {
            afterOpenChange?.(false)
            setShouldRender(false)
        }, 320)
        return () => {
            if (closeTimer.current) clearTimeout(closeTimer.current)
        }
    }, [open, shouldRender, afterOpenChange])

    const styles = customStyles as DrawerStyles | undefined

    // `HTMLElement` is a browser-only global: guard it so SSR doesn't throw evaluating
    // `instanceof` before this ever needs a real container.
    const container = useMemo<HTMLElement | undefined>(() => {
        if (getContainer === false) return undefined
        if (typeof getContainer === "function")
            return (getContainer as () => HTMLElement)() ?? undefined
        if (typeof HTMLElement !== "undefined" && getContainer instanceof HTMLElement)
            return getContainer
        return undefined
    }, [getContainer])

    const handleOpenChange = useCallback(
        (next: boolean) => {
            if (!next) onClose?.(undefined as unknown as React.MouseEvent | React.KeyboardEvent)
        },
        [onClose],
    )

    if (!shouldRender) return null

    const side = placement as "top" | "right" | "bottom" | "left"
    const isHorizontal = side === "left" || side === "right"
    // antd `width` sizes left/right drawers, `height` sizes top/bottom; otherwise Sheet's 378 default.
    // antd `size`: "default"=378, "large"=736; a number is treated as px (antd v6 behaviour).
    // Explicit width/height always wins; without this mapping `size` was silently ignored.
    const sizeToPx =
        typeof size === "number" ? size : size === "large" ? 736 : size === "default" ? 378 : null
    const effWidth = width ?? (isHorizontal ? sizeToPx : null)
    const effHeight = height ?? (!isHorizontal ? sizeToPx : null)
    const sizeStyle: React.CSSProperties = isHorizontal
        ? effWidth != null
            ? {width: effWidth, maxWidth: "100%"}
            : {}
        : effHeight != null
          ? {height: effHeight, maxHeight: "100%"}
          : {}

    return (
        <Sheet open={open} onOpenChange={handleOpenChange}>
            <SheetContent
                side={side}
                container={container}
                overlayClassName={maskClasses(mask)}
                className={cn(rootClassName, className)}
                style={{...sizeStyle, ...(zIndex != null ? {zIndex} : {}), ...styles?.content}}
                onEscapeKeyDown={(e) => {
                    if (!keyboard) e.preventDefault()
                }}
                onPointerDownOutside={(e) => {
                    if (!maskClosable) e.preventDefault()
                }}
                onInteractOutside={(e) => {
                    if (!maskClosable) e.preventDefault()
                }}
            >
                {title != null || extra != null || closable !== false ? (
                    <SheetHeader showCloseButton={closable !== false} style={styles?.header}>
                        {title != null ? (
                            <SheetTitle className="flex-1">{title}</SheetTitle>
                        ) : (
                            <span className="flex-1" />
                        )}
                        {extra != null ? <div data-slot="drawer-extra">{extra}</div> : null}
                    </SheetHeader>
                ) : (
                    // No header at all (`closable={false}` with no title/extra — the workflow
                    // revision drawer's shape). Radix renders role="dialog", which axe requires
                    // to have an accessible name, so emit a screen-reader-only title rather than
                    // leaving the dialog unnamed. antd's Drawer had no such requirement, which
                    // is why this only surfaced after the Sheet migration.
                    <SheetTitle className="sr-only">{ariaLabel ?? "Drawer"}</SheetTitle>
                )}
                {/* antd `.ant-drawer-body`: 24px padding, scrolls internally. */}
                <div
                    data-slot="drawer-body"
                    className="min-h-0 flex-1 overflow-y-auto px-6 py-6 text-field-md text-colorText"
                    style={styles?.body}
                >
                    {children}
                </div>
                {footer != null ? <SheetFooter style={styles?.footer}>{footer}</SheetFooter> : null}
            </SheetContent>
        </Sheet>
    )
}

export default EnhancedDrawer
