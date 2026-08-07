import * as React from "react"

import {CheckCircle, Info, WarningCircle, XCircle, X} from "@phosphor-icons/react"

import {cn} from "./utils"

/**
 * Notification — an @agenta/ui re-skin of one antd `notification` card, plus
 * `NotificationViewport`, the corner-anchored stack it lives in. Presentational only
 * (plain divs, no Radix, no antd): the imperative `notification.*` service that drives it
 * lives in `utils/appMessage/*` and renders these two.
 *
 * Geometry mirrors antd's `Notification` tokens MEASURED against the app theme:
 *   viewport  `position:fixed`, 24px inset from the anchored edges (antd `DEFAULT_OFFSET`),
 *             `pointer-events:none`
 *   card      `width: 384px` (`w-96`), `max-width: calc(100vw - 48px)`,
 *             `padding: paddingMD(20) paddingLG(24)`, `borderRadius: borderRadiusLG(10)`
 *             (`rounded-control-lg`), `background: colorBgElevated`, antd `boxShadow`
 *             (`shadow-dialog`), `margin-bottom: margin(16)`
 *   title     `colorTextHeading`, 16px/20px semibold — the app's overlay-title chrome
 *             (same as `AlertDialogTitle`), not antd's raw `fontSizeLG`/`lineHeightLG`
 *   desc      `fontSize`(12) `colorText`, `margin-top: marginXS(8)`
 *   icon      `fontSizeLG * lineHeightLG` box, coloured per type
 * `box-border` is required app-wide (preflight is OFF); `bg-transparent` on the native
 * close `<button>` for the same reason. `font-portal` because the stack is portalled to
 * `document.body`, outside the app's `font-sans` wrapper.
 *
 * Deviation from antd: antd lays the icon out with `position:absolute` + a matching
 * `margin-inline-start` on the title/description; this uses a two-column flex row, which
 * renders identically and survives multi-line titles.
 *
 * A11y: `role`/`aria-live` default to `alert`/`assertive` for errors and `status`/`polite`
 * otherwise (antd exposes `role` but defaults everything to `alert`).
 */
export const notificationPlacements = [
    "top",
    "topLeft",
    "topRight",
    "bottom",
    "bottomLeft",
    "bottomRight",
] as const

export type NotificationPlacement = (typeof notificationPlacements)[number]

export type NotificationType = "success" | "info" | "warning" | "error"

// antd notification icon colour per type — same semantic tokens as Alert/Toast.
const notificationIconColor: Record<NotificationType, string> = {
    success: "text-colorSuccess",
    error: "text-colorError",
    warning: "text-colorWarning",
    info: "text-info",
}

const notificationDefaultIcon: Record<NotificationType, React.ReactNode> = {
    success: <CheckCircle weight="fill" className="size-[22px]" />,
    error: <XCircle weight="fill" className="size-[22px]" />,
    warning: <WarningCircle weight="fill" className="size-[22px]" />,
    info: <Info weight="fill" className="size-[22px]" />,
}

// antd slides each card in from the edge it is anchored to.
const enterOffset: Record<NotificationPlacement, string> = {
    top: "data-[state=closed]:-translate-y-2",
    bottom: "data-[state=closed]:translate-y-2",
    topLeft: "data-[state=closed]:-translate-x-4",
    bottomLeft: "data-[state=closed]:-translate-x-4",
    topRight: "data-[state=closed]:translate-x-4",
    bottomRight: "data-[state=closed]:translate-x-4",
}

export interface NotificationProps extends Omit<React.HTMLAttributes<HTMLDivElement>, "title"> {
    /** antd `type` — picks the default icon and its colour. Omit for a plain `open()` card. */
    type?: NotificationType
    /** antd `message` / `title`. */
    title?: React.ReactNode
    /** antd `description`. */
    description?: React.ReactNode
    /** antd `btn` / `actions` — rendered bottom-right under the description. */
    actions?: React.ReactNode
    /** antd `icon`. Defaults to the status icon for `type`; pass `null` to render none. */
    icon?: React.ReactNode
    /** antd `closable` (default true). */
    closable?: boolean
    /** Fired by the close button only — NOT by the auto-dismiss timer. */
    onClose?: () => void
    /** antd `closeIcon`. */
    closeIcon?: React.ReactNode
    /** Drives the enter/leave transition. `false` plays the leave transition. */
    open?: boolean
    /** Anchors the slide-in direction to the stack's corner. */
    placement?: NotificationPlacement
}

export function Notification({
    className,
    type,
    title,
    description,
    actions,
    icon,
    closable = true,
    onClose,
    closeIcon,
    open = true,
    placement = "topRight",
    role,
    "aria-live": ariaLive,
    ...props
}: NotificationProps) {
    // Mount in the "closed" pose, then flip on the next frame so the browser has a start
    // value to transition FROM (see Toast for the same double-rAF reasoning).
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

    const resolvedIcon = icon === undefined ? (type ? notificationDefaultIcon[type] : null) : icon
    const isError = type === "error"

    return (
        <div
            data-slot="notification"
            data-type={type}
            data-state={open && entered ? "open" : "closed"}
            role={role ?? (isError ? "alert" : "status")}
            aria-live={ariaLive ?? (isError ? "assertive" : "polite")}
            className={cn(
                "box-border pointer-events-auto relative mb-4 ml-auto w-96 max-w-[calc(100vw-48px)]",
                "rounded-control-lg bg-colorBgElevated text-colorText shadow-dialog font-portal",
                "py-5 px-6",
                "transition-[opacity,transform] duration-200 ease-out",
                "data-[state=closed]:opacity-0 data-[state=open]:opacity-100 data-[state=open]:translate-x-0 data-[state=open]:translate-y-0",
                enterOffset[placement],
                className,
            )}
            {...props}
        >
            <div className="flex gap-3">
                {resolvedIcon != null ? (
                    <span
                        data-slot="notification-icon"
                        className={cn(
                            "flex shrink-0 items-start leading-none",
                            type ? notificationIconColor[type] : undefined,
                        )}
                    >
                        {resolvedIcon}
                    </span>
                ) : null}
                <div className="min-w-0 flex-1">
                    {title != null ? (
                        <div
                            data-slot="notification-title"
                            // Same chrome as AlertDialogTitle (the app's overlay title).
                            className={cn(
                                "m-0 text-base font-semibold leading-5 text-colorTextHeading",
                                closable ? "pr-6" : undefined,
                            )}
                        >
                            {title}
                        </div>
                    ) : null}
                    {description != null ? (
                        <div
                            data-slot="notification-description"
                            // antd `-description`: fontSize 12, colorText, marginTop marginXS.
                            className={cn("text-field-md text-colorText", title != null && "mt-2")}
                        >
                            {description}
                        </div>
                    ) : null}
                    {actions != null ? (
                        <div
                            data-slot="notification-actions"
                            className="mt-3 flex items-center justify-end gap-2"
                        >
                            {actions}
                        </div>
                    ) : null}
                </div>
            </div>
            {closable ? (
                <button
                    type="button"
                    data-slot="notification-close"
                    onClick={onClose}
                    aria-label="Close"
                    // Same close-X chrome as AlertDialogContent's. `bg-transparent` + `box-border`
                    // are required on native buttons (preflight is OFF).
                    className={cn(
                        "absolute right-[13px] top-[13px] box-border p-0 bg-transparent border-0 font-[inherit]",
                        "flex size-7 items-center justify-center rounded-control-sm",
                        "text-colorIcon cursor-pointer outline-none transition-colors",
                        "hover:bg-fill-quaternary hover:text-colorIconHover",
                        "focus-visible:outline focus-visible:outline-4 focus-visible:outline-offset-[-3px] focus-visible:outline-focus-ring",
                    )}
                >
                    {closeIcon ?? <X className="size-3.5" />}
                </button>
            ) : null}
        </div>
    )
}

// Corner anchoring + stack direction per antd placement. `DEFAULT_OFFSET` = 24px.
const viewportPlacement: Record<NotificationPlacement, string> = {
    top: "top-6 left-0 right-0 items-center",
    bottom: "bottom-6 left-0 right-0 items-center flex-col-reverse",
    topLeft: "top-6 left-6 items-start",
    topRight: "top-6 right-6 items-end",
    bottomLeft: "bottom-6 left-6 items-start flex-col-reverse",
    bottomRight: "bottom-6 right-6 items-end flex-col-reverse",
}

export interface NotificationViewportProps extends React.HTMLAttributes<HTMLDivElement> {
    placement?: NotificationPlacement
}

/**
 * The fixed, corner-anchored stack antd calls `.ant-notification-<placement>`.
 * z-index = antd's `zIndexPopup` for Notification (`zIndexPopupBase 1000 + 100 + 50`), so
 * notifications sit above Radix overlays (`z-50`) and above toasts.
 */
export function NotificationViewport({
    className,
    placement = "topRight",
    ...props
}: NotificationViewportProps) {
    return (
        <div
            data-slot="notification-viewport"
            data-placement={placement}
            className={cn(
                "box-border fixed z-[1150] flex flex-col pointer-events-none font-portal",
                viewportPlacement[placement],
                className,
            )}
            {...props}
        />
    )
}
