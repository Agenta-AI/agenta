import type * as React from "react"

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

// Exit transition length. MUST match the `duration-200` on Toast / Notification and the
// 0.2s `animate-dialog-out` / `animate-overlay-out` on AlertDialogContent.
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

export interface ToastRecord {
    id: number
    key: React.Key
    type: NoticeType
    content: React.ReactNode
    icon?: React.ReactNode
    className?: string
    style?: React.CSSProperties
    onClick?: (e: React.MouseEvent<HTMLDivElement>) => void
    /** `false` once the leave transition has started. */
    open: boolean
    onClose?: () => void
    resolve: (value: boolean) => void
    timer: ReturnType<typeof setTimeout> | null
}

const toastStore = createStore<ToastRecord>()
export const messageStore: Store<ToastRecord> = toastStore

function clearToastTimer(record: ToastRecord) {
    if (record.timer !== null) {
        clearTimeout(record.timer)
        record.timer = null
    }
}

function removeToast(id: number) {
    const record = toastStore.read().find((item) => item.id === id)
    if (!record) return
    toastStore.write(toastStore.read().filter((item) => item.id !== id))
    record.onClose?.()
    record.resolve(true)
}

/** Starts the leave transition, then drops the record once it has played. */
function closeToastById(id: number) {
    const record = toastStore.read().find((item) => item.id === id)
    if (!record || !record.open) return
    clearToastTimer(record)
    toastStore.write(
        toastStore.read().map((item) => (item.id === id ? {...item, open: false} : item)),
    )
    setTimeout(() => removeToast(id), EXIT_MS)
}

function scheduleToast(record: ToastRecord, duration: number) {
    clearToastTimer(record)
    // antd: `duration: 0` (and anything <= 0) never auto-dismisses.
    if (duration > 0) {
        record.timer = setTimeout(() => closeToastById(record.id), duration * 1000)
    }
}

function openMessage(args: ArgsProps): MessageType {
    const key = args.key ?? `ag-message-${nextId()}`
    const duration = args.duration ?? MESSAGE_DEFAULT_DURATION

    let resolveFn: (value: boolean) => void = () => undefined
    const promise = new Promise<boolean>((resolve) => {
        resolveFn = resolve
    })

    const items = toastStore.read()
    const existing = items.find((item) => item.key === key)

    // A key collision with a toast that is already LEAVING can't be an in-place update —
    // drop the outgoing one immediately so the new one lands cleanly. (This is the path
    // `notification.destroy(key)` + immediate re-open takes, and message keys behave the
    // same way.)
    if (existing && !existing.open) {
        clearToastTimer(existing)
        toastStore.write(items.filter((item) => item.id !== existing.id))
    }

    const target = existing && existing.open ? existing : undefined

    const record: ToastRecord = {
        id: target ? target.id : nextId(),
        key,
        type: args.type ?? "info",
        content: args.content,
        icon: args.icon,
        className: args.className,
        style: args.style,
        onClick: args.onClick,
        open: true,
        onClose: args.onClose,
        resolve: resolveFn,
        timer: null,
    }

    if (target) {
        // In-place update: keep the id (so React reuses the node and the toast does not
        // replay its entrance) and settle the superseded handle's promise. antd does not
        // fire the superseded `onClose` on a key update, and neither do we.
        clearToastTimer(target)
        target.resolve(true)
        toastStore.write(toastStore.read().map((item) => (item.id === record.id ? record : item)))
    } else {
        toastStore.write([...toastStore.read(), record])
    }

    scheduleToast(record, duration)

    const close = () => closeToastById(record.id)
    const handle = (() => close()) as MessageType
    handle.then = <TResult1 = boolean, TResult2 = never>(
        onfulfilled?: ((value: boolean) => TResult1 | PromiseLike<TResult1>) | null,
        onrejected?: ((reason: unknown) => TResult2 | PromiseLike<TResult2>) | null,
    ) => promise.then(onfulfilled, onrejected)
    return handle
}

function destroyMessage(key?: React.Key) {
    if (key === undefined) {
        toastStore.read().forEach((item) => closeToastById(item.id))
        return
    }
    const record = toastStore.read().find((item) => item.key === key)
    if (record) closeToastById(record.id)
}

export const messageService = {
    open: openMessage,
    destroy: destroyMessage,
    close: closeToastById,
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
