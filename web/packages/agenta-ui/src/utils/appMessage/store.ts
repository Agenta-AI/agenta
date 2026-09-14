import * as React from "react"

import {toast} from "sonner"

import type {
    ArgsProps,
    ConfigUpdate,
    MessageType,
    ModalFuncProps,
    NoticeType,
    NotificationArgsProps,
    NotificationPlacement,
} from "./types"

/**
 * The imperative half of the app-message facade: three tiny external stores plus the
 * module-level services that push into them. No React, no antd — so `message.error(...)`
 * works from an atom, an axios interceptor, or any other non-component code, exactly as
 * antd's `App.useApp()` singletons did.
 *
 * ## Architecture
 *
 * store (this file, module scope)  →  `AppMessageContext` renderer subscribes via
 * `useSyncExternalStore` and portals the viewports into `document.body`.
 *
 * ## Called before the renderer mounts?
 *
 * The record is QUEUED, not dropped: services mutate a plain module-level array whose
 * contents the renderer reads on its very first render, so anything fired during module
 * evaluation or an early effect shows up as soon as the renderer commits. Auto-dismiss
 * timers start at push time (not at mount), so a toast fired 10s before the renderer
 * mounts has already expired and correctly never appears. Nothing throws when the
 * renderer is absent entirely (SSR, unit tests): the records simply accumulate and expire.
 */

// Exit transition length. MUST match the `duration-200` on Notification and the 0.2s
// `animate-dialog-out` / `animate-overlay-out` on AlertDialogContent. (Toasts are Sonner's
// and animate themselves.)
const EXIT_MS = 200

// antd `message` DEFAULT_DURATION. Applies to every type INCLUDING `loading` — antd does
// not special-case it (verified against antd 6.3.7 `es/message/useMessage.js`); the
// sticky loading toasts in the app pass `duration: 0` explicitly.
const MESSAGE_DEFAULT_DURATION = 3

// antd `notification` DEFAULT_DURATION / DEFAULT_PLACEMENT.
const NOTIFICATION_DEFAULT_DURATION = 4.5
const NOTIFICATION_DEFAULT_PLACEMENT: NotificationPlacement = "topRight"

type Listener = () => void

interface Store<T> {
    subscribe: (listener: Listener) => () => void
    getSnapshot: () => readonly T[]
    getServerSnapshot: () => readonly T[]
}

function createStore<T>() {
    // One stable empty array per store: `useSyncExternalStore` loops forever if
    // getSnapshot/getServerSnapshot hand back a fresh [] each call.
    const empty: readonly T[] = []
    let items: readonly T[] = empty
    const listeners = new Set<Listener>()

    const emit = () => {
        listeners.forEach((listener) => listener())
    }

    return {
        subscribe(listener: Listener) {
            listeners.add(listener)
            return () => {
                listeners.delete(listener)
            }
        },
        getSnapshot: () => items,
        getServerSnapshot: () => empty,
        read: () => items,
        write(next: readonly T[]) {
            items = next
            emit()
        },
    }
}

let uid = 0
const nextId = () => (uid += 1)

// ---------------------------------------------------------------------------
// message
// ---------------------------------------------------------------------------

/**
 * `openMessage` maps antd's message args onto Sonner's `toast()`; a handle per toast keeps the
 * antd contract (call to close, await for close, `onClose` once) that Sonner does not model.
 */
interface ToastHandle {
    settled: boolean
    onClose?: () => void
    resolve: (value: boolean) => void
    /** Our own auto-close for `loading`, which Sonner never times out. */
    timer: ReturnType<typeof setTimeout> | null
}

/** Sonner ids; antd's `React.Key` also admits bigint, which nothing passes. */
type ToastKey = string | number

const toastHandles = new Map<ToastKey, ToastHandle>()

/** Fires `onClose` and settles the promise exactly once, however the toast went away. */
function settleToast(key: ToastKey, handle: ToastHandle, withOnClose: boolean) {
    if (handle.settled) return
    handle.settled = true
    if (handle.timer) clearTimeout(handle.timer)
    if (toastHandles.get(key) === handle) toastHandles.delete(key)
    if (withOnClose) handle.onClose?.()
    handle.resolve(true)
}

const toastByType: Record<NoticeType, typeof toast.info> = {
    info: toast.info,
    success: toast.success,
    error: toast.error,
    warning: toast.warning,
    loading: toast.loading,
}

function openMessage(args: ArgsProps): MessageType {
    const key: ToastKey = args.key ?? `ag-message-${nextId()}`
    const duration = args.duration ?? MESSAGE_DEFAULT_DURATION

    // Re-using a key updates the toast in place (Sonner does this by id). antd settles the
    // superseded handle without firing its `onClose`, and so do we.
    const superseded = toastHandles.get(key)
    if (superseded) settleToast(key, superseded, false)

    let resolveFn: (value: boolean) => void = () => undefined
    const promise = new Promise<boolean>((resolve) => {
        resolveFn = resolve
    })
    const handle: ToastHandle = {
        settled: false,
        onClose: args.onClose,
        resolve: resolveFn,
        timer: null,
    }
    toastHandles.set(key, handle)

    // Sonner has no `onClick` on a toast; the content carries it instead.
    const content = args.onClick
        ? React.createElement(
              "span",
              {onClick: args.onClick as React.MouseEventHandler<HTMLSpanElement>},
              args.content,
          )
        : args.content

    toastByType[args.type ?? "info"](content, {
        id: key,
        // antd counts seconds and `0` means sticky; Sonner counts ms and `Infinity` is sticky.
        duration: duration > 0 ? duration * 1000 : Infinity,
        icon: args.icon ?? undefined,
        className: args.className,
        style: args.style,
        onDismiss: () => settleToast(key, handle, true),
        onAutoClose: () => settleToast(key, handle, true),
    })

    const close = () => {
        toast.dismiss(key)
        settleToast(key, handle, true)
    }
    // Sonner skips auto-close for loading toasts; antd times them out like any other.
    if (args.type === "loading" && duration > 0) {
        handle.timer = setTimeout(close, duration * 1000)
    }
    const messageHandle = (() => close()) as MessageType
    messageHandle.then = <TResult1 = boolean, TResult2 = never>(
        onfulfilled?: ((value: boolean) => TResult1 | PromiseLike<TResult1>) | null,
        onrejected?: ((reason: unknown) => TResult2 | PromiseLike<TResult2>) | null,
    ) => promise.then(onfulfilled, onrejected)
    return messageHandle
}

function destroyMessage(key?: React.Key) {
    if (key === undefined) {
        toast.dismiss()
        Array.from(toastHandles.entries()).forEach(([id, handle]) => settleToast(id, handle, true))
        return
    }
    const id = key as ToastKey
    const handle = toastHandles.get(id)
    toast.dismiss(id)
    if (handle) settleToast(id, handle, true)
}

export const messageService = {
    open: openMessage,
    destroy: destroyMessage,
}

// ---------------------------------------------------------------------------
// notification
// ---------------------------------------------------------------------------

export interface NotificationRecord {
    id: number
    key: React.Key
    placement: NotificationPlacement
    args: NotificationArgsProps
    open: boolean
    timer: ReturnType<typeof setTimeout> | null
}

const notificationStoreImpl = createStore<NotificationRecord>()
export const notificationStore: Store<NotificationRecord> = notificationStoreImpl

function clearNotificationTimer(record: NotificationRecord) {
    if (record.timer !== null) {
        clearTimeout(record.timer)
        record.timer = null
    }
}

function removeNotification(id: number) {
    const record = notificationStoreImpl.read().find((item) => item.id === id)
    if (!record) return
    notificationStoreImpl.write(notificationStoreImpl.read().filter((item) => item.id !== id))
    record.args.onClose?.()
}

export function closeNotificationById(id: number) {
    const record = notificationStoreImpl.read().find((item) => item.id === id)
    if (!record || !record.open) return
    clearNotificationTimer(record)
    notificationStoreImpl.write(
        notificationStoreImpl
            .read()
            .map((item) => (item.id === id ? {...item, open: false} : item)),
    )
    setTimeout(() => removeNotification(id), EXIT_MS)
}

function scheduleNotification(record: NotificationRecord, duration: number | false | undefined) {
    clearNotificationTimer(record)
    const seconds = duration === false ? 0 : (duration ?? NOTIFICATION_DEFAULT_DURATION)
    if (seconds > 0) {
        record.timer = setTimeout(() => closeNotificationById(record.id), seconds * 1000)
    }
}

function openNotification(args: NotificationArgsProps) {
    const key = args.key ?? `ag-notification-${nextId()}`
    const placement = args.placement ?? NOTIFICATION_DEFAULT_PLACEMENT

    const items = notificationStoreImpl.read()
    const existing = items.find((item) => item.key === key)

    if (existing && !existing.open) {
        clearNotificationTimer(existing)
        notificationStoreImpl.write(items.filter((item) => item.id !== existing.id))
    }

    const target = existing && existing.open ? existing : undefined

    const record: NotificationRecord = {
        id: target ? target.id : nextId(),
        key,
        placement,
        args,
        open: true,
        timer: null,
    }

    if (target) {
        // antd updates a same-key notification in place. Unlike antd we also RESTART the
        // timer from the new `duration` — antd leaves a `duration: 0` entry's timer
        // disabled, a quirk the batch-queue toast works around with an explicit destroy().
        clearNotificationTimer(target)
        notificationStoreImpl.write(
            notificationStoreImpl.read().map((item) => (item.id === record.id ? record : item)),
        )
    } else {
        notificationStoreImpl.write([...notificationStoreImpl.read(), record])
    }

    scheduleNotification(record, args.duration)
}

function destroyNotification(key?: React.Key) {
    if (key === undefined) {
        notificationStoreImpl.read().forEach((item) => closeNotificationById(item.id))
        return
    }
    const record = notificationStoreImpl.read().find((item) => item.key === key)
    if (record) closeNotificationById(record.id)
}

export const notificationService = {
    open: openNotification,
    destroy: destroyNotification,
}

// ---------------------------------------------------------------------------
// modal (confirm)
// ---------------------------------------------------------------------------

export interface ConfirmRecord {
    id: number
    config: ModalFuncProps
    open: boolean
}

const confirmStoreImpl = createStore<ConfirmRecord>()
export const confirmStore: Store<ConfirmRecord> = confirmStoreImpl

function removeConfirm(id: number) {
    const record = confirmStoreImpl.read().find((item) => item.id === id)
    if (!record) return
    confirmStoreImpl.write(confirmStoreImpl.read().filter((item) => item.id !== id))
    record.config.afterClose?.()
}

export function closeConfirmById(id: number) {
    const record = confirmStoreImpl.read().find((item) => item.id === id)
    if (!record || !record.open) return
    confirmStoreImpl.write(
        confirmStoreImpl.read().map((item) => (item.id === id ? {...item, open: false} : item)),
    )
    setTimeout(() => removeConfirm(id), EXIT_MS)
}

export function openConfirm(config: ModalFuncProps) {
    const id = nextId()
    confirmStoreImpl.write([...confirmStoreImpl.read(), {id, config, open: true}])

    return {
        destroy: () => closeConfirmById(id),
        update: (configUpdate: ConfigUpdate) => {
            confirmStoreImpl.write(
                confirmStoreImpl.read().map((item) =>
                    item.id === id
                        ? {
                              ...item,
                              config:
                                  typeof configUpdate === "function"
                                      ? configUpdate(item.config)
                                      : {...item.config, ...configUpdate},
                          }
                        : item,
                ),
            )
        },
    }
}
