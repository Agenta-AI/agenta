import type * as React from "react"

/**
 * Local, structurally-compatible replacements for the antd types the app-message facade
 * used to re-export (`antd/es/message/interface`, `antd/es/notification/interface`,
 * `antd/es/modal/confirm`). Same precedent as `EnhancedButton` / `EnhancedModal` /
 * `PageLayout`: the facade keeps its public shape, the antd dependency disappears.
 *
 * These are deliberately WIDE — a call-site that compiles against antd's props must keep
 * compiling. When something is missing, widen HERE, never edit the call-site.
 */

// ---------------------------------------------------------------------------
// message
// ---------------------------------------------------------------------------

/** antd `NoticeType`. */
export type NoticeType = "info" | "success" | "error" | "warning" | "loading"

/** antd message `ArgsProps`. */
export interface ArgsProps {
    content: React.ReactNode
    /** Seconds on screen. `0` never auto-dismisses. Defaults to 3 (antd's default). */
    duration?: number
    type?: NoticeType
    onClose?: () => void
    icon?: React.ReactNode
    /** Re-using a key UPDATES the existing toast in place instead of stacking a new one. */
    key?: string | number
    style?: React.CSSProperties
    className?: string
    onClick?: (e: React.MouseEvent<HTMLDivElement>) => void
    /** Accepted for antd source compatibility; not implemented (see AppMessage notes). */
    classNames?: Record<string, string | undefined>
    /** Accepted for antd source compatibility; not implemented. */
    styles?: Record<string, React.CSSProperties | undefined>
    /** Accepted for antd source compatibility; not implemented. */
    pauseOnHover?: boolean
}

/**
 * antd `MessageType`: the returned handle is BOTH callable (calling it closes the toast)
 * and awaitable (resolves when the toast closes).
 */
export interface MessageType extends PromiseLike<boolean> {
    (): void
}

export type JointContent = React.ReactNode | ArgsProps

export type TypeOpen = (
    content: JointContent,
    duration?: number | VoidFunction,
    onClose?: VoidFunction,
) => MessageType

/** antd `MessageInstance`. */
export interface MessageInstance {
    info: TypeOpen
    success: TypeOpen
    error: TypeOpen
    warning: TypeOpen
    loading: TypeOpen
    open: (args: ArgsProps) => MessageType
    destroy: (key?: React.Key) => void
}

// ---------------------------------------------------------------------------
// notification
// ---------------------------------------------------------------------------

export const notificationPlacements = [
    "top",
    "topLeft",
    "topRight",
    "bottom",
    "bottomLeft",
    "bottomRight",
] as const

/** antd `NotificationPlacement`. */
export type NotificationPlacement = (typeof notificationPlacements)[number]

/** antd notification `IconType`. */
export type IconType = "success" | "info" | "error" | "warning"

/** antd notification `ArgsProps`. */
export interface NotificationArgsProps {
    /** The card's heading (antd's original name; `title` is the newer alias). */
    message?: React.ReactNode
    title?: React.ReactNode
    description?: React.ReactNode
    /** Footer action(s) (antd's original name; `actions` is the newer alias). */
    btn?: React.ReactNode
    actions?: React.ReactNode
    /** Re-using a key UPDATES the existing card in place. */
    key?: React.Key
    onClose?: () => void
    /** Seconds on screen. `0`/`false` never auto-dismisses. Defaults to 4.5 (antd's default). */
    duration?: number | false
    icon?: React.ReactNode
    placement?: NotificationPlacement
    style?: React.CSSProperties
    className?: string
    readonly type?: IconType
    onClick?: () => void
    closeIcon?: React.ReactNode
    closable?: boolean
    role?: "alert" | "status"
    props?: React.HTMLAttributes<HTMLDivElement> & {"data-testid"?: string}
    /** Accepted for antd source compatibility; not implemented. */
    showProgress?: boolean
    /** Accepted for antd source compatibility; not implemented. */
    pauseOnHover?: boolean
    /** Accepted for antd source compatibility; not implemented. */
    classNames?: Record<string, string | undefined>
    /** Accepted for antd source compatibility; not implemented. */
    styles?: Record<string, React.CSSProperties | undefined>
}

/** antd `NotificationInstance`. */
export interface NotificationInstance {
    success: (args: NotificationArgsProps) => void
    error: (args: NotificationArgsProps) => void
    info: (args: NotificationArgsProps) => void
    warning: (args: NotificationArgsProps) => void
    open: (args: NotificationArgsProps) => void
    destroy: (key?: React.Key) => void
}

// ---------------------------------------------------------------------------
// modal
// ---------------------------------------------------------------------------

/**
 * The slice of antd's `ButtonProps` that confirm-modal call-sites actually pass. Widen as
 * needed — `okButtonProps` / `cancelButtonProps` are pass-throughs, so an unknown key here
 * would be a compile error at a call-site we must not touch.
 */
export interface ModalButtonProps {
    danger?: boolean
    disabled?: boolean
    loading?: boolean | {delay?: number}
    type?: "primary" | "default" | "dashed" | "link" | "text"
    icon?: React.ReactNode
    className?: string
    style?: React.CSSProperties
    href?: string
    target?: string
    htmlType?: "submit" | "button" | "reset"
    size?: "small" | "middle" | "large"
    shape?: "default" | "circle" | "round"
    block?: boolean
    ghost?: boolean
    autoFocus?: boolean
    id?: string
    onClick?: React.MouseEventHandler<HTMLElement>
    "aria-label"?: string
    "data-testid"?: string
}

/** antd `ModalFuncProps` (the config `Modal.confirm` and friends take). */
export interface ModalFuncProps {
    className?: string
    rootClassName?: string
    open?: boolean
    title?: React.ReactNode
    content?: React.ReactNode
    /**
     * Return a Promise to keep the modal open (with the OK button in its loading state)
     * until it settles: resolve closes the modal, reject leaves it open.
     * `close` is passed as the first argument, matching antd.
     */
    onOk?: (close: () => void) => unknown
    onCancel?: (close: () => void) => unknown
    /** Agenta extension (not antd): renders an extra button between Cancel and OK. */
    thirdButtonText?: React.ReactNode
    /** Handler for `thirdButtonText`; receives `close` like `onOk`/`onCancel`. */
    onThirdButton?: (close: () => void) => unknown
    afterClose?: () => void
    okButtonProps?: ModalButtonProps
    cancelButtonProps?: ModalButtonProps
    centered?: boolean
    width?: string | number
    okText?: React.ReactNode
    okType?: "primary" | "default" | "dashed" | "link" | "text" | "danger"
    cancelText?: React.ReactNode
    icon?: React.ReactNode
    maskClosable?: boolean
    zIndex?: number
    /** `false` renders OK only (antd's `info`/`success`/`error`/`warning` behaviour). */
    okCancel?: boolean
    style?: React.CSSProperties
    wrapClassName?: string
    type?: "info" | "success" | "error" | "warn" | "warning" | "confirm"
    /** `false` disables Escape-to-dismiss. */
    keyboard?: boolean
    closable?: boolean
    closeIcon?: React.ReactNode
    autoFocusButton?: null | "ok" | "cancel"
    /** Accepted for antd source compatibility; not implemented. */
    prefixCls?: string
    /** Accepted for antd source compatibility; not implemented. */
    maskStyle?: React.CSSProperties
    /** Accepted for antd source compatibility; not implemented. */
    bodyStyle?: React.CSSProperties
    /** Accepted for antd source compatibility; not implemented. */
    transitionName?: string
    /** Accepted for antd source compatibility; not implemented. */
    maskTransitionName?: string
    /** Accepted for antd source compatibility; not implemented. */
    getContainer?: unknown
    /** Accepted for antd source compatibility; not implemented. */
    footer?: React.ReactNode
    /** Accepted for antd source compatibility; not implemented. */
    modalRender?: (node: React.ReactNode) => React.ReactNode
}

export type ConfigUpdate = ModalFuncProps | ((prevConfig: ModalFuncProps) => ModalFuncProps)

/** antd `ModalFunc` — returns the imperative `{destroy, update}` handle. */
export type ModalFunc = (props: ModalFuncProps) => {
    destroy: () => void
    update: (configUpdate: ConfigUpdate) => void
}

/** antd `Omit<ModalStaticFunctions, "warn">` — the shape the facade has always exported. */
export interface ModalInstance {
    info: ModalFunc
    success: ModalFunc
    error: ModalFunc
    warning: ModalFunc
    confirm: ModalFunc
}
