import {useCallback, useEffect, useRef, useState, type RefObject} from "react"

import {
    parseBrowserLiveMessage,
    type BrowserLiveClientMessage,
    type BrowserLiveServerMessage,
} from "@agenta/entities/browserProfile"

export type BrowserLiveConnection =
    | {phase: "connecting"}
    | {phase: "live"}
    | {phase: "closed"; reason: string}
    | {phase: "error"; reason: string}

export type BrowserLiveStatus = Omit<Extract<BrowserLiveServerMessage, {type: "status"}>, "type">

const CLOSE_CODES: Record<number, BrowserLiveConnection> = {
    4401: {phase: "error", reason: "Your sign-in expired. Sign in again to see the browser."},
    4403: {phase: "error", reason: "You do not have access to this browser."},
    4404: {phase: "closed", reason: "No browser is running right now."},
}

const closedBy = (event: CloseEvent): BrowserLiveConnection =>
    CLOSE_CODES[event.code] ?? {phase: "closed", reason: "The browser connection closed."}

/** Draws the newest frame only; frames that arrive while one decodes replace each other. */
const createFramePainter = (canvasRef: RefObject<HTMLCanvasElement | null>) => {
    let pending: string | null = null
    let busy = false
    const paint = () => {
        if (busy || pending === null) return
        const data = pending
        pending = null
        busy = true
        const image = new Image()
        image.onload = image.onerror = () => {
            const canvas = canvasRef.current
            if (canvas && image.naturalWidth) {
                if (canvas.width !== image.naturalWidth) canvas.width = image.naturalWidth
                if (canvas.height !== image.naturalHeight) canvas.height = image.naturalHeight
                canvas.getContext("2d")?.drawImage(image, 0, 0)
            }
            busy = false
            paint()
        }
        image.src = `data:image/jpeg;base64,${data}`
    }
    return (data: string) => {
        pending = data
        paint()
    }
}

export const useBrowserLiveSocket = (
    url: string | null,
    canvasRef: RefObject<HTMLCanvasElement | null>,
) => {
    const [connection, setConnection] = useState<BrowserLiveConnection>({phase: "connecting"})
    const [status, setStatus] = useState<BrowserLiveStatus | null>(null)
    const [attempt, setAttempt] = useState(0)
    const socketRef = useRef<WebSocket | null>(null)

    useEffect(() => {
        if (!url) return
        setConnection({phase: "connecting"})
        setStatus(null)
        const socket = new WebSocket(url)
        socketRef.current = socket
        const paintFrame = createFramePainter(canvasRef)
        let failed = false
        socket.onopen = () => setConnection({phase: "live"})
        socket.onmessage = (event) => {
            const message = parseBrowserLiveMessage(event.data)
            if (message?.type === "frame") paintFrame(message.data)
            else if (message?.type === "status") {
                setStatus({control: message.control, url: message.url, title: message.title})
            }
        }
        socket.onerror = () => {
            failed = true
            setConnection({phase: "error", reason: "Could not connect to the browser."})
        }
        socket.onclose = (event) => {
            if (failed && !CLOSE_CODES[event.code]) return
            setConnection(closedBy(event))
        }
        return () => {
            socket.onclose = null
            socket.close()
            socketRef.current = null
        }
    }, [url, attempt, canvasRef])

    const send = useCallback((message: BrowserLiveClientMessage) => {
        const socket = socketRef.current
        if (socket?.readyState === WebSocket.OPEN) socket.send(JSON.stringify(message))
    }, [])

    const reconnect = useCallback(() => setAttempt((count) => count + 1), [])

    return {connection, status, send, reconnect}
}
