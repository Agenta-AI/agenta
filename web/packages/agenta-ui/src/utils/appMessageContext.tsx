/**
 * AppMessageContext - Static exports for Ant Design message/modal/notification
 *
 * This component captures Ant Design's App context and exports static instances
 * of message, modal, and notification that can be used anywhere without hooks.
 *
 * ## Usage
 *
 * 1. Render the component inside your Ant Design App provider:
 * ```tsx
 * import { App } from 'antd'
 * import { AppMessageContext } from '@agenta/ui'
 *
 * function MyApp() {
 *   return (
 *     <App>
 *       <AppMessageContext />
 *       {children}
 *     </App>
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
 * ```
 */

import React from "react"

import {App} from "antd"
import type {ArgsProps, MessageInstance, MessageType} from "antd/es/message/interface"
import type {ModalStaticFunctions} from "antd/es/modal/confirm"
import type {NotificationInstance} from "antd/es/notification/interface"

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

/** Drop-in replacement for antd `ArgsProps` with optional link support. */
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

function wrapMethod(instance: MessageInstance, method: ShorthandMethod): ExtendedTypeOpen {
    return (content, duration?, onClose?) => {
        const resolved = isExtendedArgs(content) ? resolveContent(content) : content
        return (instance[method] as Function)(resolved, duration, onClose)
    }
}

function createEnhancedMessage(instance: MessageInstance): EnhancedMessageInstance {
    return {
        ...instance,
        info: wrapMethod(instance, "info"),
        success: wrapMethod(instance, "success"),
        error: wrapMethod(instance, "error"),
        warning: wrapMethod(instance, "warning"),
        loading: wrapMethod(instance, "loading"),
    }
}

// ---------------------------------------------------------------------------
// Module-level singletons
// ---------------------------------------------------------------------------

let message: EnhancedMessageInstance
let notification: NotificationInstance
let modal: Omit<ModalStaticFunctions, "warn">

/**
 * Component that captures Ant Design's App context.
 * Must be rendered inside an Ant Design App provider.
 */
const AppMessageContext = () => {
    const staticFunction = App.useApp()
    message = createEnhancedMessage(staticFunction.message)
    modal = staticFunction.modal
    notification = staticFunction.notification
    return null
}

export default AppMessageContext

export {message, modal, notification}
