/**
 * EnhancedModal — antd `Modal`-compatible facade over the `@agenta/ui` (Radix) `Dialog`.
 *
 * Consolidation: this used to wrap antd `Modal`. It now renders the `@agenta/ui` Dialog so the
 * ~80 call-sites (which pass antd `ModalProps`) move off antd with NO call-site changes. It keeps
 * the wrapper's features — lazy mount-on-open, `maxHeight` (90vh) + internal body scroll, centered,
 * radius 16 (the Dialog default) — and translates a local, antd-compatible `ModalProps` surface
 * (declared below; 0 antd type/runtime dependency) that mirrors the antd props call-sites pass.
 *
 * Covered: open · onCancel · onOk · title · footer (custom / null / default Cancel+OK) ·
 * okText/cancelText/okButtonProps/cancelButtonProps (incl. data-* passthrough)/confirmLoading ·
 * okType="danger" · width · closable · closeIcon (null suppresses, a node overrides the
 * default X) · maskClosable · keyboard(Esc) · afterClose ·
 * styles(body/footer/header/content/container) · style · className · zIndex · getContainer ·
 * maxHeight · lazyRender · centered (always).
 * Deferred (rare / unused by call-sites): footer as a render fn, `modalRender`, `mask={false}`,
 * imperative `Modal.confirm`. Add if a call-site needs them.
 */

import {useCallback, useEffect, useMemo, useRef, useState} from "react"

import {Button} from "./ui/button"
import {LoadingButton} from "./ui/button-composed"
import {Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle} from "./ui/dialog"
import {cn} from "./ui/utils"

// Local, antd-`Modal`-compatible prop surface. This facade carries 0 antd runtime AND 0 antd
// type dependency; the shapes below reproduce the antd `ModalProps`/`ButtonProps` fields the
// ~80 call-sites pass so they move off antd with no call-site changes. Add fields here (never
// edit a call-site) if a consumer passes a prop this surface is missing.

/** antd `Modal` `getContainer` — element / factory / `false` (portal to body). */
type ModalGetContainer = string | HTMLElement | (() => HTMLElement) | false

/** antd responsive breakpoints for the `width` object form. */
type ModalBreakpoint = "xs" | "sm" | "md" | "lg" | "xl" | "xxl" | "xxxl"
/** antd `Modal.width` — fixed, or a per-breakpoint responsive map. */
type ModalWidth = string | number | Partial<Record<ModalBreakpoint, string | number>>

/** antd `closable` — a boolean or the antd v6 object form (`{closeIcon, disabled, aria-*, ...}`). */
type ModalClosable = boolean | object

/** antd `mask` — a boolean or the antd v6 `MaskConfig` object (`{enabled, blur, closable}`). */
type ModalMask = boolean | object

/** antd `Modal.styles` semantic-DOM style slots (index sig accepts any antd semantic key). */
interface ModalSemanticStyles {
    header?: React.CSSProperties
    body?: React.CSSProperties
    footer?: React.CSSProperties
    mask?: React.CSSProperties
    wrapper?: React.CSSProperties
    content?: React.CSSProperties
    [key: string]: React.CSSProperties | undefined
}

/** antd `Modal.classNames` semantic-DOM class slots (index sig accepts any antd semantic key). */
interface ModalSemanticClassNames {
    header?: string
    body?: string
    footer?: string
    mask?: string
    wrapper?: string
    content?: string
    [key: string]: string | undefined
}

// antd v6 `styles`/`classNames` are resolvable: an object or `(info) => object`. The facade
// only consumes the object form (via the overridden `EnhancedModalProps["styles"]`); the props
// param is intentionally loose so any antd `(info: {props}) => …` resolver assigns here.
type ModalStyles = ModalSemanticStyles | ((info: {props: any}) => ModalSemanticStyles) // eslint-disable-line @typescript-eslint/no-explicit-any
type ModalClassNames = ModalSemanticClassNames | ((info: {props: any}) => ModalSemanticClassNames) // eslint-disable-line @typescript-eslint/no-explicit-any

/**
 * Local stand-in for antd `ButtonProps` as accepted by `okButtonProps`/`cancelButtonProps`.
 * Only `danger`/`disabled`/`loading`/`className`/`style` are forwarded (see `mapAntButton`);
 * the rest mirror antd's `ButtonProps` surface (incl. `data-*` attrs) so both antd `ButtonProps`
 * values and antd-shaped literals assign — all extras are dropped by the facade.
 */
interface ModalButtonProps extends Omit<React.ButtonHTMLAttributes<HTMLElement>, "type"> {
    type?: string
    danger?: boolean
    loading?: boolean | {delay?: number; icon?: React.ReactNode}
    icon?: React.ReactNode
    size?: string
    shape?: string
    ghost?: boolean
    block?: boolean
    color?: string
    variant?: string
    href?: string
    htmlType?: "submit" | "button" | "reset"
    [key: `data-${string}`]: unknown
}

/** antd `Modal` `footer` — a node, `null` (no footer), or a render function. */
type ModalFooter =
    | React.ReactNode
    | ((
          originNode: React.ReactNode,
          extra: {OkBtn: React.FC; CancelBtn: React.FC},
      ) => React.ReactNode)

/**
 * Local, antd-compatible `Modal` prop surface. Reproduces the antd `ModalProps` fields the
 * call-sites use; extend it (do not edit a call-site) when a consumer needs another prop.
 */
interface ModalProps {
    open?: boolean
    confirmLoading?: boolean
    title?: React.ReactNode
    /** Accessible name when `title` is null (a dialog must be named). @default "Dialog" */
    "aria-label"?: string
    closable?: ModalClosable
    closeIcon?: React.ReactNode
    okText?: React.ReactNode
    cancelText?: React.ReactNode
    okType?: string
    okButtonProps?: ModalButtonProps
    cancelButtonProps?: ModalButtonProps
    footer?: ModalFooter
    width?: ModalWidth
    centered?: boolean
    mask?: ModalMask
    maskClosable?: boolean
    maskStyle?: React.CSSProperties
    keyboard?: boolean
    forceRender?: boolean
    destroyOnClose?: boolean
    destroyOnHidden?: boolean
    focusTriggerAfterClose?: boolean
    /** antd v6 `focusable`. Only `trap` is honoured: `false` skips the open autofocus. */
    focusable?: {trap?: boolean; focusTriggerAfterClose?: boolean}
    zIndex?: number
    className?: string
    rootClassName?: string
    wrapClassName?: string
    classNames?: ModalClassNames
    styles?: ModalStyles
    style?: React.CSSProperties
    bodyStyle?: React.CSSProperties
    icon?: React.ReactNode
    loading?: boolean
    prefixCls?: string
    getContainer?: ModalGetContainer
    modalRender?: (node: React.ReactNode) => React.ReactNode
    afterClose?: () => void
    afterOpenChange?: (open: boolean) => void
    onOk?: (e: React.MouseEvent<HTMLButtonElement>) => void
    onCancel?: (e: React.MouseEvent<HTMLButtonElement> | React.KeyboardEvent<HTMLElement>) => void
}

export interface EnhancedModalStyles {
    container?: React.CSSProperties
    body?: React.CSSProperties
    footer?: React.CSSProperties
    header?: React.CSSProperties
    mask?: React.CSSProperties
    content?: React.CSSProperties
    wrapper?: React.CSSProperties
}

export interface EnhancedModalProps extends Omit<ModalProps, "styles"> {
    children?: React.ReactNode
    // The resolver's props param is loose so antd's `(info: {props}) => styles` form assigns; the
    // facade only ever calls it with its own props.
    styles?: EnhancedModalStyles | ((context: {props: any}) => EnhancedModalStyles) // eslint-disable-line @typescript-eslint/no-explicit-any
    /** Max modal height; the body scrolls internally past it. `undefined` disables. @default "90vh" */
    maxHeight?: string | undefined
    /** Mount content only after first open. @default true */
    lazyRender?: boolean
}

// antd `okButtonProps`/`cancelButtonProps` → @agenta/ui Button props. antd-only fields
// (type/size/shape/ghost/icon/htmlType) are dropped; `danger` → destructive variant.
// `data-*` attrs pass through as-is — onboarding tours target buttons by them (e.g.
// `okButtonProps={{"data-tour": "run-eval-confirm"}}`).
const mapAntButton = (p: ModalButtonProps | undefined) => {
    const dataAttrs = Object.fromEntries(
        Object.entries(p ?? {}).filter(([key]) => key.startsWith("data-")),
    )
    return {
        danger: !!p?.danger,
        disabled: p?.disabled,
        loading: !!p?.loading,
        className: p?.className,
        style: p?.style,
        dataAttrs,
    }
}

export function EnhancedModal(props: EnhancedModalProps) {
    const {
        children,
        open,
        afterClose,
        onCancel,
        onOk,
        title,
        footer,
        width = 520,
        okText = "OK",
        cancelText = "Cancel",
        okButtonProps,
        cancelButtonProps,
        confirmLoading,
        closable = true,
        closeIcon,
        okType,
        maskClosable = true,
        keyboard = true,
        focusable,
        zIndex,
        getContainer,
        styles: customStyles,
        className,
        style,
        maxHeight = "90vh",
        lazyRender = true,
        "aria-label": ariaLabel,
    } = props

    const [shouldRender, setShouldRender] = useState(false)
    const closeTimer = useRef<ReturnType<typeof setTimeout> | null>(null)

    useEffect(() => {
        if (open) setShouldRender(true)
    }, [open])

    // Radix has no `afterClose`; approximate it after the dialog-out animation (~200ms).
    useEffect(() => {
        if (open || !shouldRender) return
        closeTimer.current = setTimeout(() => {
            afterClose?.()
            if (lazyRender) setShouldRender(false)
        }, 220)
        return () => {
            if (closeTimer.current) clearTimeout(closeTimer.current)
        }
    }, [open, shouldRender, afterClose, lazyRender])

    const resolved = typeof customStyles === "function" ? customStyles({props}) : customStyles

    // antd `getContainer` (element | () => element | false | undefined) → Radix portal target.
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

    // Any close gesture (X / Esc / outside-click) maps to antd `onCancel`.
    const handleOpenChange = useCallback(
        (next: boolean) => {
            if (!next) onCancel?.(undefined as unknown as React.MouseEvent<HTMLButtonElement>)
        },
        [onCancel],
    )

    if (lazyRender && !shouldRender) return null

    const okBtn = mapAntButton(okButtonProps)
    const cancelBtn = mapAntButton(cancelButtonProps)
    // antd `width` may be a responsive object; the facade takes a fixed number/string (antd default 520).
    const modalWidth = typeof width === "number" || typeof width === "string" ? width : 520

    // antd footer semantics: `undefined` → default Cancel/OK; `null` → no footer; else render as-is.
    // A footer render-function is deferred → falls back to the default footer.
    const footerNode =
        footer === null ? null : footer !== undefined && typeof footer !== "function" ? (
            footer
        ) : (
            <>
                <Button
                    variant="outline"
                    disabled={cancelBtn.disabled}
                    className={cancelBtn.className}
                    style={cancelBtn.style}
                    onClick={(e) => onCancel?.(e)}
                    {...cancelBtn.dataAttrs}
                >
                    {cancelText}
                </Button>
                <LoadingButton
                    variant={okBtn.danger || okType === "danger" ? "destructive" : "default"}
                    loading={confirmLoading || okBtn.loading}
                    disabled={okBtn.disabled}
                    className={okBtn.className}
                    style={okBtn.style}
                    onClick={(e) => onOk?.(e)}
                    {...okBtn.dataAttrs}
                >
                    {okText}
                </LoadingButton>
            </>
        )

    return (
        <Dialog open={open} onOpenChange={handleOpenChange}>
            <DialogContent
                container={container}
                showCloseButton={closeIcon !== null && closable !== false}
                closeIcon={closeIcon}
                // Facade scroll layout: drop the content's own padding/gap so the body scrolls
                // edge-to-edge; header/footer keep the horizontal padding + antd's 12px rhythm.
                className={cn("gap-0 p-0", className)}
                style={{
                    width: modalWidth,
                    maxWidth: modalWidth,
                    ...(maxHeight ? {maxHeight} : {}),
                    ...(zIndex != null ? {zIndex} : {}),
                    // Legacy root `style` and `styles.container` (antd's outer wrapper slot —
                    // collapsed onto this single node here) come before `styles.content`, the
                    // most specific slot, so content still wins on overlap.
                    ...resolved?.container,
                    ...style,
                    ...resolved?.content,
                }}
                onOpenAutoFocus={focusable?.trap === false ? (e) => e.preventDefault() : undefined}
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
                {/* antd modal: header marginBottom 8px (pb-2), footer marginTop 12px (pt-3). */}
                {title != null ? (
                    <DialogHeader className="shrink-0 px-6 pb-2 pt-5" style={resolved?.header}>
                        <DialogTitle>{title}</DialogTitle>
                    </DialogHeader>
                ) : (
                    // A titleless modal still needs a name (axe aria-dialog-name); sr-only is
                    // position:absolute so it takes no space.
                    <DialogTitle className="sr-only">{ariaLabel ?? "Dialog"}</DialogTitle>
                )}
                <div
                    data-slot="modal-body"
                    className={cn(
                        "min-h-0 flex-1 overflow-y-auto px-6 text-field-md text-colorText",
                        title == null && "pt-5",
                        footerNode == null && "pb-5",
                    )}
                    style={resolved?.body}
                >
                    {children}
                </div>
                {footerNode != null ? (
                    <DialogFooter className="shrink-0 px-6 pb-5 pt-3" style={resolved?.footer}>
                        {footerNode}
                    </DialogFooter>
                ) : null}
            </DialogContent>
        </Dialog>
    )
}

export default EnhancedModal
