/** Parent side of preview comments, shared by the host and the mock; survives frame reloads. */
import {parsePickerMessage, type PinQuery} from "@agenta/shared/previewPicker"

import type {HtmlAppHost, ParentToPicker, PickedPayload, PinRectsMsg} from "./protocol"

type PickApi = Required<
    Pick<
        HtmlAppHost,
        "startPick" | "stopPick" | "setPins" | "onPicked" | "onPinRects" | "onPickCancel"
    >
>

export interface PickBridge extends PickApi {
    /** A new frame is attached: nothing is sent to it until its `hello-ack`. */
    attached(iframe: HTMLIFrameElement): void
    detached(): void
    /** The frame acknowledged the hello: re-send pins and comment mode. */
    acked(): void
    /** Handle a picker message from the frame; false when `data` is not one. */
    receive(data: unknown): boolean
}

const subscribe = <T>(set: Set<T>, cb: T) => {
    set.add(cb)
    return () => {
        set.delete(cb)
    }
}

export function createPickBridge(post: (msg: ParentToPicker) => void): PickBridge {
    let frame: HTMLIFrameElement | null = null
    let ready = false
    let picking = false
    let pins: PinQuery[] = []
    const pickedCbs = new Set<(picked: PickedPayload) => void>()
    const rectCbs = new Set<(rects: PinRectsMsg["rects"]) => void>()
    const cancelCbs = new Set<() => void>()

    const send = (msg: ParentToPicker) => {
        if (ready) post(msg)
    }

    return {
        attached(iframe) {
            frame = iframe
            ready = false
        },
        detached() {
            frame = null
            ready = false
        },
        acked() {
            ready = true
            if (pins.length > 0) send({v: 1, type: "pins", pins})
            if (picking) send({v: 1, type: "pick-start", format: "html"})
        },
        receive(data) {
            if (!frame) return false
            const size = {width: frame.clientWidth || 0, height: frame.clientHeight || 0}
            const msg = parsePickerMessage(data, size)
            if (!msg) return false
            if (msg.type === "picked") {
                if (!picking) return true
                const payload: PickedPayload = {
                    element: msg.element,
                    text: msg.text,
                    rect: msg.rect,
                }
                for (const cb of pickedCbs) cb(payload)
            } else if (msg.type === "pin-rects") {
                for (const cb of rectCbs) cb(msg.rects)
            } else {
                for (const cb of cancelCbs) cb()
            }
            return true
        },
        startPick() {
            picking = true
            send({v: 1, type: "pick-start", format: "html"})
        },
        stopPick() {
            picking = false
            send({v: 1, type: "pick-stop"})
        },
        setPins(next) {
            pins = next
            send({v: 1, type: "pins", pins})
        },
        onPicked: (cb) => subscribe(pickedCbs, cb),
        onPinRects: (cb) => subscribe(rectCbs, cb),
        onPickCancel: (cb) => subscribe(cancelCbs, cb),
    }
}
