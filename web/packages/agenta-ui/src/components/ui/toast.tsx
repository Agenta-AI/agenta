import * as React from "react"

import {CheckCircle, Info, WarningCircle, XCircle} from "@phosphor-icons/react"

import {Spinner} from "./spinner"
import {cn} from "./utils"

/**
 * Toast — an @agenta/ui re-skin of one antd `message` notice (the top-centred pill), plus
 * `ToastViewport`, the fixed stack it lives in. Presentational only (plain divs, no Radix,
 * no antd): the imperative `message.*` service that drives it lives in
 * `utils/appMessage/*` and renders these two.
 *
 * Geometry mirrors antd's `Message` tokens MEASURED against the app theme
 * (`controlHeightLG`=34, base `fontSize`=12, `lineHeight`=1.667 → 20px):
 *   viewport  `position:fixed; top:marginXS(8); width:100%` + `pointer-events:none`
 *   wrapper   `padding: paddingXS(8); text-align:center`
 *   content   `padding: (controlHeightLG - fontSize*lineHeight)/2 = 7px` vertical /
 *             `paddingSM(12)` horizontal, `borderRadius: borderRadiusLG(10)`
 *             (`rounded-control-lg`), `background: colorBgElevated`, antd `boxShadow`
 *             (`shadow-dialog`), `pointer-events:all`
 *   icon      `marginInlineEnd: marginXS(8)`, `fontSize: fontSizeLG(16)` → `size-4`,
 *             coloured per type (success/error/warning = the semantic colour,
 *             info + loading = `colorInfo`, matching antd exactly)
 * `box-border` is required app-wide (preflight is OFF); `font-portal` because the stack is
 * portalled to `document.body`, outside the app's `font-sans` wrapper.
 *
 * Motion: antd animates `MessageMoveIn/Out` keyframes (translateY + opacity + padding
 * collapse) over `motionDurationSlow`. Reproduced as a CSS *transition* on
 * opacity/transform driven by `data-state`, so no new Tailwind keyframes are needed; the
 * `max-height`/padding collapse on leave is deliberately dropped (see AppMessage notes).
 *
 * A11y (an addition — antd's message notice has no live region at all): each toast is a
 * live region, `role="alert"`/`aria-live="assertive"` for errors and
 * `role="status"`/`aria-live="polite"` otherwise.
 */
export type ToastType = "info" | "success" | "error" | "warning" | "loading"

// antd message icon colour per type: `colorSuccess` / `colorError` / `colorWarning`, and
// `colorInfo` for BOTH info and loading (`text-info` is the token bridge's `colorInfo`).
const toastIconColor: Record<ToastType, string> = {
    success: "text-colorSuccess",
    error: "text-colorError",
    warning: "text-colorWarning",
    info: "text-info",
    loading: "text-info",
}

// antd's filled status icons (CheckCircleFilled / CloseCircleFilled / ExclamationCircleFilled /
// InfoCircleFilled) and the spinning LoadingOutlined — the latter reuses our own `Spinner`.
const toastDefaultIcon: Record<ToastType, React.ReactNode> = {
    success: <CheckCircle weight="fill" className="size-4" />,
    error: <XCircle weight="fill" className="size-4" />,
    warning: <WarningCircle weight="fill" className="size-4" />,
    info: <Info weight="fill" className="size-4" />,
    loading: <Spinner size="small" className="text-info" aria-label="Loading" />,
}

export interface ToastProps extends Omit<React.HTMLAttributes<HTMLDivElement>, "content"> {
    /** antd `type` — picks the default icon and its colour. */
    type?: ToastType
    /** antd `icon` — replaces the default status icon. Pass `null` to render none. */
    icon?: React.ReactNode
    /** Drives the enter/leave transition. `false` plays the leave transition. */
    open?: boolean
    /** antd `style`, applied to the pill (not the wrapper) — same as antd. */
    style?: React.CSSProperties
}

export function Toast({
    className,
    type = "info",
    icon,
    open = true,
    children,
    style,
    role,
    "aria-live": ariaLive,
    ...props
}: ToastProps) {
    // Mount in the "closed" pose, then flip on the next frame so the browser has a start
    // value to transition FROM (a single rAF can still be batched into the same paint).
    const [entered, setEntered] = React.useState(false)
    React.useEffect(() => {
        let inner = 0
        const outer = requestAnimationFrame(() => {
            inner = requestAnimationFrame(() => setEntered(true))
        })
        return () => {
            cancelAnimationFrame(outer)
            cancelAnimationFrame(inner)
        }
    }, [])

    const resolvedIcon = icon === undefined ? toastDefaultIcon[type] : icon
    const isError = type === "error"

    return (
        <div
            data-slot="toast-wrapper"
            // antd `-notice-wrapper`: paddingXS all round, centred.
            className="box-border p-2 text-center"
        >
            <div
                data-slot="toast"
                data-type={type}
                data-state={open && entered ? "open" : "closed"}
                role={role ?? (isError ? "alert" : "status")}
                aria-live={ariaLive ?? (isError ? "assertive" : "polite")}
                className={cn(
                    "box-border pointer-events-auto inline-flex items-center text-start align-top",
                    // contentPadding: (controlHeightLG 34 - 20)/2 = 7px vertical, paddingSM 12px.
                    "py-[7px] px-3",
                    "rounded-control-lg bg-colorBgElevated text-colorText shadow-dialog font-portal text-field-md",
                    // antd MessageMoveIn/Out, as a transition (see docblock).
                    "transition-[opacity,transform] duration-200 ease-out",
                    "data-[state=closed]:opacity-0 data-[state=closed]:-translate-y-2",
                    "data-[state=open]:opacity-100 data-[state=open]:translate-y-0",
                    className,
                )}
                style={style}
                {...props}
            >
                {resolvedIcon != null ? (
                    <span
                        data-slot="toast-icon"
                        // marginInlineEnd = marginXS (8px); fontSizeLG (16px) box.
                        className={cn(
                            "mr-2 flex shrink-0 items-center text-base leading-none",
                            toastIconColor[type],
                        )}
                    >
                        {resolvedIcon}
                    </span>
                ) : null}
                <span data-slot="toast-content">{children}</span>
            </div>
        </div>
    )
}

export interface ToastViewportProps extends React.HTMLAttributes<HTMLDivElement> {}

/**
 * The fixed, top-centred stack antd calls `.ant-message`. `pointer-events-none` so the page
 * stays clickable behind it; each pill re-enables its own pointer events.
 *
 * z-index = antd's `zIndexPopup` for Message (`zIndexPopupBase 1000 + 100 + 10`), which puts
 * toasts above Radix overlays (`z-50`) — a toast fired from inside a dialog stays visible.
 */
export function ToastViewport({className, ...props}: ToastViewportProps) {
    return (
        <div
            data-slot="toast-viewport"
            // antd holder: fixed, top marginXS (8px), full width, no pointer events.
            className={cn(
                "box-border fixed top-2 left-0 z-[1110] w-full pointer-events-none font-portal",
                className,
            )}
            {...props}
        />
    )
}
