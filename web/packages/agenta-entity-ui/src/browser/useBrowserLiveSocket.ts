import {useCallback, useEffect, useRef, useState, type RefObject} from "react"

import {
    BROWSER_VIEWPORT,
    parseBrowserLiveMessage,
    type BrowserLiveClientMessage,
    type BrowserLiveServerMessage,
    type BrowserViewport,
} from "./live"

export type BrowserLiveConnection =
    | {phase: "connecting"}
    | {phase: "live"}
    | {phase: "closed"; reason: string}
    | {phase: "error"; reason: string}

export type BrowserLiveViewStatus = Omit<
    Extract<BrowserLiveServerMessage, {type: "status"}>,
    "type"
>

/** Why the browser did not do what the viewer asked; `seq` tells two equal messages apart. */
export interface BrowserLiveNotice {
    message: string
    seq: number
}

const CLOSE_CODES: Record<number, BrowserLiveConnection> = {
    4400: {phase: "error", reason: "This session cannot show a browser."},
    4401: {phase: "error", reason: "Your sign-in expired. Sign in again to see the browser."},
    4403: {phase: "error", reason: "You do not have access to this browser."},
    4404: {phase: "closed", reason: "No browser is running right now."},
}

export const closedBy = (code: number): BrowserLiveConnection =>
    CLOSE_CODES[code] ?? {phase: "closed", reason: "The browser connection closed."}

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
    const [status, setStatus] = useState<BrowserLiveViewStatus | null>(null)
    const [notice, setNotice] = useState<BrowserLiveNotice | null>(null)
    const [viewport, setViewport] = useState<BrowserViewport>(BROWSER_VIEWPORT)
    const [attempt, setAttempt] = useState(0)
    const socketRef = useRef<WebSocket | null>(null)

    useEffect(() => {
        if (!url) return
        setConnection({phase: "connecting"})
        setStatus(null)
        setNotice(null)
        setViewport(BROWSER_VIEWPORT)
        // A new connection must not show the last frame of the browser it replaced.
        const canvas = canvasRef.current
        canvas?.getContext("2d")?.clearRect(0, 0, canvas.width, canvas.height)
        const socket = new WebSocket(url)
        socketRef.current = socket
        const paintFrame = createFramePainter(canvasRef)
        let failed = false
        let disposed = false
        let shownUrl: string | null = null
        let notices = 0
        // An open socket is not live yet: the server accepts, then closes 4401/4403/4404.
        // The first status is what proves the browser answered.
        socket.onmessage = (event) => {
            if (disposed) return
            const message = parseBrowserLiveMessage(event.data)
            if (message?.type === "frame") {
                const {width, height} = message
                setViewport((prev) =>
                    prev.width === width && prev.height === height ? prev : {width, height},
                )
                paintFrame(message.data)
            } else if (message?.type === "status") {
                setConnection((prev) => (prev.phase === "live" ? prev : {phase: "live"}))
                // A notice is about the page it was raised on; a new page clears it.
                if (message.url !== shownUrl) setNotice(null)
                shownUrl = message.url
                setStatus({
                    control: message.control,
                    url: message.url,
                    title: message.title,
                    waitReason: message.waitReason,
                    tabs: message.tabs,
                })
            } else if (message?.type === "notice") {
                setNotice({message: message.message, seq: ++notices})
            }
        }
        // A socket closed while connecting (a reconnect, a remount) still fires error and close;
        // they must not overwrite the state of the socket that replaced it.
        socket.onerror = () => {
            if (disposed) return
            failed = true
            setConnection({phase: "error", reason: "Could not connect to the browser."})
        }
        socket.onclose = (event) => {
            if (disposed || (failed && !CLOSE_CODES[event.code])) return
            setConnection(closedBy(event.code))
        }
        return () => {
            disposed = true
            socket.close()
            socketRef.current = null
        }
    }, [url, attempt, canvasRef])

    const send = useCallback((message: BrowserLiveClientMessage) => {
        const socket = socketRef.current
        if (socket?.readyState === WebSocket.OPEN) socket.send(JSON.stringify(message))
    }, [])

    const reconnect = useCallback(() => setAttempt((count) => count + 1), [])

    return {connection, status, notice, viewport, send, reconnect}
}
