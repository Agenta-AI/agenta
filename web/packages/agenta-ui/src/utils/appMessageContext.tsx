/**
 * AppMessageContext - Static message/modal/notification services for the app
 *
 * A self-contained toast / confirm-modal / notification service built on the `@agenta/ui`
 * primitives (`Toast`, `Notification`, `AlertDialog`). It exposes the same imperative,
 * module-level singletons the Ant Design `App.useApp()` facade used to export, so it can be
 * called from anywhere — atoms, hooks, interceptors, plain modules — not just components.
 *
 * ## Usage
 *
 * 1. Render the component ONCE inside your app tree (no provider required — it portals its
 *    own surfaces to `document.body`):
 * ```tsx
 * import { AppMessageContext } from '@agenta/ui'
 *
 * function MyApp() {
 *   return (
 *     <>
 *       <AppMessageContext />
 *       {children}
 *     </>
 *   )
 * }
 * ```
 *
 * 2. Import and use the static exports anywhere:
 * ```tsx
 * import { message, modal, notification } from '@agenta/ui'
 *
 * // Plain text
 * message.success('Saved successfully')
 *
 * // With a navigation link (callback-based, e.g. Next.js router.push)
 * message.success({ content: 'Queue created.', onNavigate: () => router.push(url), duration: 3 })
 *
 * // With a plain href link
 * message.success({ content: 'Queue created.', url: '/annotations/abc', duration: 3 })
 *
 * // Custom link label (default is "View")
 * message.success({ content: 'Done.', url: '/path', linkText: 'Open', duration: 3 })
 *
 * // Confirm modal (async `onOk`: rejecting keeps the modal open)
 * modal.confirm({ title: 'Delete?', content: 'This cannot be undone.', onOk: doDelete })
 *
 * // Corner notification
 * notification.success({ message: 'Deployed', description: 'v3 is live.', duration: 3 })
 * ```
 *
 * Calls made BEFORE the component mounts are queued, not dropped — see the architecture
 * note in `./appMessage/store.ts`.
 */

import React from "react"

import {AppMessageOutlet} from "./appMessage/AppMessageRenderer"
import {messageService, notificationService, openConfirm} from "./appMessage/store"
import type {
    ArgsProps,
    MessageInstance,
    MessageType,
    ModalFuncProps,
    ModalInstance,
    NotificationInstance,
} from "./appMessage/types"

// ---------------------------------------------------------------------------
// Extended args type
// ---------------------------------------------------------------------------

export interface MessageLinkOptions {
    /** Programmatic navigation callback. Takes priority over `url` when both are provided. */
    onNavigate?: () => void
    /** Plain href for the link anchor. Used when `onNavigate` is not provided. */
    url?: string
    /** Label rendered inside the link. Defaults to `"View"`. */
    linkText?: string
}

/** Drop-in replacement for Ant Design `ArgsProps` with optional link support. */
export type ExtendedMessageArgsProps = ArgsProps & MessageLinkOptions

type ExtendedJointContent = React.ReactNode | ExtendedMessageArgsProps

// ---------------------------------------------------------------------------
// Enhanced message instance type
// ---------------------------------------------------------------------------

type ExtendedTypeOpen = (
    content: ExtendedJointContent,
    duration?: number | VoidFunction,
    onClose?: VoidFunction,
) => MessageType

export interface EnhancedMessageInstance extends Omit<
    MessageInstance,
    "info" | "success" | "error" | "warning" | "loading"
> {
    info: ExtendedTypeOpen
    success: ExtendedTypeOpen
    error: ExtendedTypeOpen
    warning: ExtendedTypeOpen
    loading: ExtendedTypeOpen
}

// ---------------------------------------------------------------------------
// Internal helpers
// ---------------------------------------------------------------------------

function isExtendedArgs(content: unknown): content is ExtendedMessageArgsProps {
    return (
        typeof content === "object" &&
        content !== null &&
        !React.isValidElement(content) &&
        "content" in content
    )
}

function resolveContent(args: ExtendedMessageArgsProps): ArgsProps {
    const {url, onNavigate, linkText = "View", ...rest} = args
    if (!url && !onNavigate) return rest

    const link = onNavigate ? (
        <a
            onClick={(e) => {
                e.preventDefault()
                onNavigate()
            }}
            className="underline underline-offset-2"
        >
            {linkText}
        </a>
    ) : (
        <a href={url} className="underline underline-offset-2">
            {linkText}
        </a>
    )

    return {
        ...rest,
        content: (
            <span>
                {rest.content} {link}
            </span>
        ),
    }
}

type ShorthandMethod = "info" | "success" | "error" | "warning" | "loading"

/**
 * Ant Design's `typeOpen`: the second argument is EITHER the duration OR the `onClose` callback,
 * and a plain (non-`ArgsProps`) first argument becomes `{content}`.
 */
function wrapMethod(method: ShorthandMethod): ExtendedTypeOpen {
    return (content, duration?, onClose?) => {
        const base: ArgsProps = isExtendedArgs(content)
            ? resolveContent(content)
            : {content: content as React.ReactNode}

        let mergedDuration: number | undefined
        let mergedOnClose: VoidFunction | undefined
        if (typeof duration === "function") {
            mergedOnClose = duration
        } else {
            mergedDuration = duration
            mergedOnClose = onClose
        }

        return messageService.open({
            onClose: mergedOnClose,
            duration: mergedDuration,
            ...base,
            type: method,
        })
    }
}

// ---------------------------------------------------------------------------
// Module-level singletons
// ---------------------------------------------------------------------------

const message: EnhancedMessageInstance = {
    info: wrapMethod("info"),
    success: wrapMethod("success"),
    error: wrapMethod("error"),
    warning: wrapMethod("warning"),
    loading: wrapMethod("loading"),
    open: (args: ArgsProps) => messageService.open(args),
    destroy: (key?: React.Key) => messageService.destroy(key),
}

const notification: NotificationInstance = {
    success: (args) => notificationService.open({...args, type: "success"}),
    error: (args) => notificationService.open({...args, type: "error"}),
    info: (args) => notificationService.open({...args, type: "info"}),
    warning: (args) => notificationService.open({...args, type: "warning"}),
    open: (args) => notificationService.open(args),
    destroy: (key?: React.Key) => notificationService.destroy(key),
}

// Ant Design's `info`/`success`/`error`/`warning` modals show OK only; `confirm` shows both.
const modalFunc = (defaults: ModalFuncProps) => (config: ModalFuncProps) =>
    openConfirm({...defaults, ...config})

const modal: ModalInstance = {
    info: modalFunc({type: "info", okCancel: false}),
    success: modalFunc({type: "success", okCancel: false}),
    error: modalFunc({type: "error", okCancel: false}),
    warning: modalFunc({type: "warning", okCancel: false}),
    confirm: modalFunc({type: "confirm", okCancel: true}),
}

/**
 * Mount point for every app-message surface. Render it once anywhere in the tree; it needs
 * no provider and portals its own overlays to `document.body`.
 */
const AppMessageContext = () => <AppMessageOutlet />

export default AppMessageContext

export {message, modal, notification}

export type {
    ArgsProps,
    ConfigUpdate,
    IconType,
    JointContent,
    MessageInstance,
    MessageType,
    ModalButtonProps,
    ModalFunc,
    ModalFuncProps,
    ModalInstance,
    NoticeType,
    NotificationArgsProps,
    NotificationInstance,
    NotificationPlacement,
    TypeOpen,
} from "./appMessage/types"
