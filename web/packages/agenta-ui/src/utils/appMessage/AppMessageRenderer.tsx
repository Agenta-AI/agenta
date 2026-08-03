import * as React from "react"

import {createPortal} from "react-dom"

import {
    AlertDialog,
    AlertDialogCancel,
    AlertDialogContent,
    AlertDialogDescription,
    AlertDialogFooter,
    AlertDialogHeader,
    AlertDialogTitle,
} from "../../components/ui/alert-dialog"
import {Button} from "../../components/ui/button"
import {Notification, NotificationViewport} from "../../components/ui/notification"
import {Toast, ToastViewport} from "../../components/ui/toast"
import {cn} from "../../components/ui/utils"

import {
    closeConfirmById,
    closeNotificationById,
    confirmStore,
    messageStore,
    notificationStore,
} from "./store"
import type {ConfirmRecord, NotificationRecord} from "./store"
import {notificationPlacements} from "./types"
import type {NotificationPlacement} from "./types"

/**
 * The React half of the app-message facade — see `store.ts` for the imperative half and
 * the architecture note. This subscribes to the three stores with `useSyncExternalStore`
 * and renders the toast stack, the notification stacks and the confirm modals.
 *
 * Everything is portalled to `document.body` (the confirm modals through Radix's own
 * portal), so the overlays escape whatever transformed/overflow-clipped container the
 * mount point happens to sit in. Rendering is deferred until after mount so the server
 * render and the first client render agree (the stores' `getServerSnapshot` is empty).
 */

// ---------------------------------------------------------------------------
// message
// ---------------------------------------------------------------------------

function MessageOutlet() {
    const records = React.useSyncExternalStore(
        messageStore.subscribe,
        messageStore.getSnapshot,
        messageStore.getServerSnapshot,
    )

    if (records.length === 0) return null

    return (
        <ToastViewport>
            {records.map((record) => (
                <Toast
                    key={record.id}
                    type={record.type}
                    icon={record.icon}
                    open={record.open}
                    className={record.className}
                    style={record.style}
                    onClick={record.onClick}
                >
                    {record.content}
                </Toast>
            ))}
        </ToastViewport>
    )
}

// ---------------------------------------------------------------------------
// notification
// ---------------------------------------------------------------------------

function NotificationCard({record}: {record: NotificationRecord}) {
    const {args} = record
    // antd accepts both the original names (`message`, `btn`) and the newer aliases
    // (`title`, `actions`); every app call-site uses the original pair.
    const title = args.title ?? args.message
    const actions = args.actions ?? args.btn

    return (
        <Notification
            type={args.type}
            title={title}
            description={args.description}
            actions={actions}
            icon={args.icon}
            closable={args.closable ?? true}
            closeIcon={args.closeIcon}
            onClose={() => closeNotificationById(record.id)}
            open={record.open}
            placement={record.placement}
            className={args.className}
            style={args.style}
            onClick={args.onClick}
            role={args.role}
            {...args.props}
        />
    )
}

function NotificationOutlet() {
    const records = React.useSyncExternalStore(
        notificationStore.subscribe,
        notificationStore.getSnapshot,
        notificationStore.getServerSnapshot,
    )

    if (records.length === 0) return null

    return (
        <>
            {notificationPlacements.map((placement: NotificationPlacement) => {
                const forPlacement = records.filter((record) => record.placement === placement)
                if (forPlacement.length === 0) return null
                return (
                    <NotificationViewport key={placement} placement={placement}>
                        {forPlacement.map((record) => (
                            <NotificationCard key={record.id} record={record} />
                        ))}
                    </NotificationViewport>
                )
            })}
        </>
    )
}

// ---------------------------------------------------------------------------
// modal (confirm)
// ---------------------------------------------------------------------------

function ConfirmModal({record}: {record: ConfirmRecord}) {
    const {config} = record
    const [okLoading, setOkLoading] = React.useState(false)
    const [thirdLoading, setThirdLoading] = React.useState(false)

    const close = React.useCallback(() => closeConfirmById(record.id), [record.id])

    const handleCancel = React.useCallback(() => {
        // While an async `onOk`/`onThirdButton` is in flight antd keeps the modal locked;
        // ignore dismissals.
        if (okLoading || thirdLoading) return
        // `close` is passed as the first argument, matching antd.
        config.onCancel?.(close)
        close()
    }, [close, config, okLoading, thirdLoading])

    const handleOk = React.useCallback(() => {
        // antd hands `close` to `onOk` as the first argument.
        const result = config.onOk?.(close)
        if (result && typeof (result as PromiseLike<unknown>).then === "function") {
            setOkLoading(true)
            Promise.resolve(result).then(
                () => {
                    setOkLoading(false)
                    close()
                },
                () => {
                    // A rejection keeps the modal open, exactly as antd does.
                    setOkLoading(false)
                },
            )
            return
        }
        close()
    }, [close, config])

    const handleThirdButton = React.useCallback(() => {
        // Same async/loading contract as `handleOk`: a returned Promise keeps the modal
        // open (third button in its loading state) until it settles.
        const result = config.onThirdButton?.(close)
        if (result && typeof (result as PromiseLike<unknown>).then === "function") {
            setThirdLoading(true)
            Promise.resolve(result).then(
                () => {
                    setThirdLoading(false)
                    close()
                },
                () => {
                    setThirdLoading(false)
                },
            )
            return
        }
        close()
    }, [close, config])

    const okCancel = config.okCancel ?? true
    const danger = config.okButtonProps?.danger === true || config.okType === "danger"
    const hasContent = config.content != null
    const hasTitle = config.title != null

    return (
        <AlertDialog
            open={record.open}
            onOpenChange={(next) => {
                if (!next) handleCancel()
            }}
        >
            <AlertDialogContent
                // antd's confirm modals are not closable by default; `closable` opts in.
                showCloseButton={config.closable ?? false}
                className={cn(
                    // antd non-centered Modals sit 100px from the top. `self-start` beats the
                    // positioner's `items-center` without touching the shared AlertDialog.
                    config.centered ? undefined : "self-start mt-[100px]",
                    config.className,
                )}
                style={
                    config.width != null ? {...config.style, maxWidth: config.width} : config.style
                }
                onEscapeKeyDown={(event) => {
                    if (config.keyboard === false || okLoading || thirdLoading)
                        event.preventDefault()
                }}
                // Radix always points `aria-describedby` at its Description; with no content
                // there is none, so clear it (an explicit `undefined` in the spread) to avoid
                // a dangling reference and Radix's dev warning.
                {...(hasContent ? {} : {"aria-describedby": undefined})}
            >
                <AlertDialogHeader>
                    <AlertDialogTitle className={hasTitle ? undefined : "sr-only"}>
                        {hasTitle ? config.title : "Confirm"}
                    </AlertDialogTitle>
                    {hasContent ? (
                        // `asChild` swaps Radix's <p> for a <div>: `content` is an arbitrary
                        // ReactNode and block children inside a <p> is invalid DOM nesting.
                        <AlertDialogDescription asChild>
                            <div>{config.content}</div>
                        </AlertDialogDescription>
                    ) : null}
                </AlertDialogHeader>
                <AlertDialogFooter>
                    {okCancel ? (
                        <AlertDialogCancel
                            disabled={
                                okLoading || thirdLoading || config.cancelButtonProps?.disabled
                            }
                            className={config.cancelButtonProps?.className}
                            style={config.cancelButtonProps?.style}
                        >
                            {config.cancelButtonProps?.icon}
                            {config.cancelText ?? "Cancel"}
                        </AlertDialogCancel>
                    ) : null}
                    {/* Agenta extension (not antd): an extra button between Cancel and OK. */}
                    {config.thirdButtonText ? (
                        <Button
                            variant="outline"
                            onClick={handleThirdButton}
                            disabled={okLoading || thirdLoading}
                            data-loading={thirdLoading || undefined}
                        >
                            {config.thirdButtonText}
                        </Button>
                    ) : null}
                    {/* A plain Button, NOT AlertDialogAction: Radix's action always closes the
                        dialog on click, which would break the async/rejecting `onOk` contract. */}
                    <Button
                        variant={danger ? "destructive" : "default"}
                        onClick={handleOk}
                        disabled={okLoading || thirdLoading || config.okButtonProps?.disabled}
                        className={config.okButtonProps?.className}
                        style={config.okButtonProps?.style}
                        data-loading={okLoading || undefined}
                    >
                        {config.okButtonProps?.icon}
                        {config.okText ?? "OK"}
                    </Button>
                </AlertDialogFooter>
            </AlertDialogContent>
        </AlertDialog>
    )
}

function ConfirmOutlet() {
    const records = React.useSyncExternalStore(
        confirmStore.subscribe,
        confirmStore.getSnapshot,
        confirmStore.getServerSnapshot,
    )

    return (
        <>
            {records.map((record) => (
                <ConfirmModal key={record.id} record={record} />
            ))}
        </>
    )
}

// ---------------------------------------------------------------------------
// Mount point
// ---------------------------------------------------------------------------

/**
 * Renders every app-message surface. Mount ONCE, anywhere inside the app tree; the
 * services are module-level singletons so nothing needs to be threaded through context.
 */
export function AppMessageOutlet() {
    const [mounted, setMounted] = React.useState(false)
    // No teardown on unmount: under StrictMode the mount effect runs twice, so a cleanup
    // that flushed the queue would swallow anything fired before the first commit.
    React.useEffect(() => setMounted(true), [])

    if (!mounted || typeof document === "undefined") return null

    return (
        <>
            {createPortal(
                <>
                    <MessageOutlet />
                    <NotificationOutlet />
                </>,
                document.body,
            )}
            {/* Radix portals the confirm modals itself. */}
            <ConfirmOutlet />
        </>
    )
}
