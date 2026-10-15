import {useEffect, useRef, type RefObject} from "react"

import {BROWSER_VIEWPORT, type BrowserLiveClientMessage} from "@agenta/entities/browserProfile"
import {Button, Spinner} from "@agenta/ui/ui"
import {ArrowClockwise, Globe, HandPointing, Keyboard, Robot} from "@phosphor-icons/react"

import {isCommandKey, mouseButton, toViewportPoint} from "./liveInput"
import type {
    BrowserLiveConnection,
    BrowserLiveNotice,
    BrowserLiveStatus,
} from "./useBrowserLiveSocket"

export interface BrowserLiveSurfaceProps {
    connection: BrowserLiveConnection
    status: BrowserLiveStatus | null
    notice?: BrowserLiveNotice | null
    canvasRef: RefObject<HTMLCanvasElement | null>
    send: (message: BrowserLiveClientMessage) => void
    onReconnect: () => void
}

const TAP_SLOP_PX = 8

export const BrowserLiveSurface = ({
    connection,
    status,
    notice = null,
    canvasRef,
    send,
    onReconnect,
}: BrowserLiveSurfaceProps) => {
    const inputRef = useRef<HTMLInputElement | null>(null)
    const touchRef = useRef<{
        x: number
        y: number
        lastX: number
        lastY: number
        scrolled: boolean
    } | null>(null)
    const moveRef = useRef<{x: number; y: number} | null>(null)
    const live = connection.phase === "live"
    const userControl = live && status?.control === "user"

    const point = (clientX: number, clientY: number) =>
        canvasRef.current ? toViewportPoint(canvasRef.current, clientX, clientY) : null

    useEffect(() => {
        const canvas = canvasRef.current
        if (!canvas || !userControl) return
        const onWheel = (event: WheelEvent) => {
            event.preventDefault()
            const at = toViewportPoint(canvas, event.clientX, event.clientY)
            send({type: "mouse", event: "wheel", ...at, deltaX: event.deltaX, deltaY: event.deltaY})
        }
        canvas.addEventListener("wheel", onWheel, {passive: false})
        return () => canvas.removeEventListener("wheel", onWheel)
    }, [canvasRef, send, userControl])

    const onPointerDown = (event: React.PointerEvent<HTMLCanvasElement>) => {
        const at = point(event.clientX, event.clientY)
        if (!userControl || !at) return
        if (event.pointerType === "touch") {
            touchRef.current = {...at, lastX: event.clientX, lastY: event.clientY, scrolled: false}
            return
        }
        event.currentTarget.setPointerCapture(event.pointerId)
        send({type: "mouse", event: "down", ...at, button: mouseButton(event.button)})
        inputRef.current?.focus({preventScroll: true})
        event.preventDefault()
    }

    const onPointerMove = (event: React.PointerEvent<HTMLCanvasElement>) => {
        if (!userControl) return
        const touch = touchRef.current
        if (event.pointerType === "touch") {
            if (!touch) return
            const dx = event.clientX - touch.lastX
            const dy = event.clientY - touch.lastY
            if (!touch.scrolled && Math.hypot(dx, dy) < TAP_SLOP_PX) return
            touch.scrolled = true
            touch.lastX = event.clientX
            touch.lastY = event.clientY
            send({type: "mouse", event: "wheel", x: touch.x, y: touch.y, deltaX: -dx, deltaY: -dy})
            return
        }
        const pending = moveRef.current
        moveRef.current = point(event.clientX, event.clientY)
        if (pending) return
        requestAnimationFrame(() => {
            const at = moveRef.current
            moveRef.current = null
            if (at) send({type: "mouse", event: "move", ...at})
        })
    }

    const onPointerUp = (event: React.PointerEvent<HTMLCanvasElement>) => {
        if (!userControl) return
        if (event.pointerType === "touch") {
            const touch = touchRef.current
            touchRef.current = null
            if (!touch || touch.scrolled) return
            send({type: "mouse", event: "down", x: touch.x, y: touch.y, button: "left"})
            send({type: "mouse", event: "up", x: touch.x, y: touch.y, button: "left"})
            return
        }
        const at = point(event.clientX, event.clientY)
        if (at) send({type: "mouse", event: "up", ...at, button: mouseButton(event.button)})
    }

    const onKey = (event: React.KeyboardEvent<HTMLInputElement>, kind: "down" | "up") => {
        if (!userControl) return
        const pasting = (event.ctrlKey || event.metaKey) && event.key.toLowerCase() === "v"
        if (pasting || !isCommandKey(event)) return
        event.preventDefault()
        send({type: "key", event: kind, key: event.key, code: event.code})
    }

    const sendText = (input: HTMLInputElement) => {
        if (userControl && input.value) send({type: "text", text: input.value})
        input.value = ""
    }

    return (
        <div className="flex min-h-0 flex-1 flex-col gap-2">
            <div className="flex items-center gap-2">
                <Button
                    variant="outline"
                    size="icon-sm"
                    aria-label="Reload page"
                    title="Reload page"
                    disabled={!live || !status}
                    onClick={() => send({type: "reload"})}
                >
                    <ArrowClockwise size={14} />
                </Button>
                <form
                    className="flex h-8 min-w-0 flex-1 items-center gap-1.5 rounded-md border border-solid border-border bg-muted px-2 text-xs text-muted-foreground"
                    title={status?.title || undefined}
                    onSubmit={(event) => {
                        event.preventDefault()
                        const field = event.currentTarget.elements.namedItem("url")
                        const url = field instanceof HTMLInputElement ? field.value.trim() : ""
                        if (url && live) send({type: "navigate", url})
                        field instanceof HTMLInputElement && field.blur()
                    }}
                >
                    <Globe size={14} className="shrink-0" />
                    <input
                        // A refusal leaves the URL as it was; the notice resets the typed address.
                        key={`${status?.url ?? ""}#${notice?.seq ?? 0}`}
                        name="url"
                        aria-label="Address"
                        defaultValue={status?.url || ""}
                        placeholder="about:blank"
                        disabled={!live}
                        autoCapitalize="off"
                        autoComplete="off"
                        autoCorrect="off"
                        spellCheck={false}
                        className="min-w-0 flex-1 truncate border-0 bg-transparent p-0 font-mono text-xs text-foreground outline-none"
                    />
                </form>
                <Button
                    variant="outline"
                    size="icon-sm"
                    className="md:hidden"
                    aria-label="Show keyboard"
                    disabled={!userControl}
                    onClick={() => inputRef.current?.focus({preventScroll: true})}
                >
                    <Keyboard size={14} />
                </Button>
                <Button
                    size="sm"
                    variant={userControl ? "outline" : "default"}
                    disabled={!live || !status}
                    onClick={() => send({type: "control", take: !userControl})}
                >
                    {userControl ? <Robot size={14} /> : <HandPointing size={14} />}
                    {userControl ? "Give back control" : "Take control"}
                </Button>
            </div>
            {notice ? (
                <p role="status" className="text-xs text-destructive">
                    {notice.message}
                </p>
            ) : null}
            <div className="relative flex min-h-0 flex-1 items-center justify-center overflow-hidden rounded-lg border border-solid border-border bg-muted">
                <canvas
                    ref={canvasRef}
                    width={BROWSER_VIEWPORT.width}
                    height={BROWSER_VIEWPORT.height}
                    aria-label={status?.title ? `Browser showing ${status.title}` : "Browser"}
                    className={`block max-h-full max-w-full touch-none select-none bg-background ${userControl ? "cursor-default" : "cursor-not-allowed"}`}
                    onPointerDown={onPointerDown}
                    onPointerMove={onPointerMove}
                    onPointerUp={onPointerUp}
                    onPointerCancel={() => {
                        touchRef.current = null
                    }}
                    onContextMenu={(event) => event.preventDefault()}
                />
                <input
                    ref={inputRef}
                    aria-label="Type into the browser"
                    autoCapitalize="off"
                    autoComplete="off"
                    autoCorrect="off"
                    spellCheck={false}
                    className="pointer-events-none absolute left-0 top-0 h-px w-px border-0 p-0 text-base opacity-0"
                    onKeyDown={(event) => onKey(event, "down")}
                    onKeyUp={(event) => onKey(event, "up")}
                    onChange={(event) => {
                        if (!(event.nativeEvent as InputEvent).isComposing)
                            sendText(event.currentTarget)
                    }}
                    onCompositionEnd={(event) => sendText(event.currentTarget)}
                />
                {connection.phase !== "live" ? (
                    <div className="absolute inset-0 flex flex-col items-center justify-center gap-3 bg-muted/90 p-4 text-center text-sm text-muted-foreground">
                        {connection.phase === "connecting" ? (
                            <>
                                <Spinner />
                                <span>Connecting to the browser…</span>
                            </>
                        ) : (
                            <>
                                <span
                                    role={connection.phase === "error" ? "alert" : undefined}
                                    className={
                                        connection.phase === "error"
                                            ? "text-destructive"
                                            : undefined
                                    }
                                >
                                    {connection.reason}
                                </span>
                                <Button size="sm" variant="outline" onClick={onReconnect}>
                                    <ArrowClockwise size={14} />
                                    Reconnect
                                </Button>
                            </>
                        )}
                    </div>
                ) : status && !userControl ? (
                    <div className="pointer-events-none absolute bottom-3 left-1/2 -translate-x-1/2 rounded-full bg-background/90 px-3 py-1 text-xs text-muted-foreground shadow-sm">
                        The agent is using the browser. Take control to use it yourself.
                    </div>
                ) : null}
            </div>
        </div>
    )
}
