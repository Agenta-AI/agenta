import {useEffect, useRef, type RefObject} from "react"

import {Button, Spinner} from "@agenta/ui/ui"
import {
    ArrowClockwise,
    CheckCircle,
    Globe,
    HandPointing,
    Keyboard,
    Robot,
} from "@phosphor-icons/react"

import {ROW_ICON_BTN} from "../drive/DriveHeader"

import {BROWSER_VIEWPORT, type BrowserLiveClientMessage, type BrowserViewport} from "./live"
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
    /** The remote viewport of the latest frame, in CSS pixels; pointer input maps into it. */
    viewport: BrowserViewport
    canvasRef: RefObject<HTMLCanvasElement | null>
    send: (message: BrowserLiveClientMessage) => void
    onReconnect: () => void
}

const TAP_SLOP_PX = 8

export const BrowserLiveSurface = ({
    connection,
    status,
    notice = null,
    viewport,
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
    // The agent ran `agenta-browser wait`: only "I'm done" ends it; giving back control does not.
    const waiting = live ? status?.waiting || "" : ""

    const point = (clientX: number, clientY: number) =>
        canvasRef.current ? toViewportPoint(canvasRef.current, clientX, clientY, viewport) : null

    useEffect(() => {
        const canvas = canvasRef.current
        if (!canvas || !userControl) return
        const onWheel = (event: WheelEvent) => {
            event.preventDefault()
            const at = toViewportPoint(canvas, event.clientX, event.clientY, viewport)
            send({type: "mouse", event: "wheel", ...at, deltaX: event.deltaX, deltaY: event.deltaY})
        }
        canvas.addEventListener("wheel", onWheel, {passive: false})
        return () => canvas.removeEventListener("wheel", onWheel)
    }, [canvasRef, send, userControl, viewport])

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

    const takeControl = () => send({type: "control", take: true})
    const giveBack = () => send({type: "control", take: false})
    const done = () => send({type: "done"})

    return (
        <div className="flex min-h-0 flex-1 flex-col gap-2">
            <div className="flex items-center gap-1.5">
                <Button
                    variant="ghost"
                    size="icon-sm"
                    aria-label="Reload page"
                    title="Reload page"
                    disabled={!live || !status}
                    onClick={() => send({type: "reload"})}
                    className={ROW_ICON_BTN}
                >
                    <ArrowClockwise size={15} />
                </Button>
                <form
                    className="flex h-8 min-w-0 flex-1 items-center gap-1.5 rounded-md bg-colorFillTertiary px-2 text-xs text-colorTextTertiary"
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
                        className="min-w-0 flex-1 truncate border-0 bg-transparent p-0 font-mono text-xs text-colorText outline-none"
                    />
                </form>
                <Button
                    variant="ghost"
                    size="icon-sm"
                    className={`md:hidden ${ROW_ICON_BTN}`}
                    aria-label="Show keyboard"
                    disabled={!userControl}
                    onClick={() => inputRef.current?.focus({preventScroll: true})}
                >
                    <Keyboard size={15} />
                </Button>
                {/* While the agent waits, its ask below carries the actions. */}
                {waiting ? null : (
                    <Button
                        size="sm"
                        variant="outline"
                        disabled={!live || !status}
                        onClick={userControl ? giveBack : takeControl}
                    >
                        {userControl ? <Robot size={14} /> : <HandPointing size={14} />}
                        {userControl ? "Give back control" : "Take control"}
                    </Button>
                )}
            </div>
            {waiting ? (
                <div
                    role="status"
                    className="flex flex-wrap items-center gap-x-3 gap-y-2 rounded-lg border border-solid border-colorBorderSecondary bg-colorBgContainer p-3"
                >
                    <div className="flex min-w-0 flex-1 basis-60 flex-col gap-1">
                        <span className="flex items-center gap-1.5 text-xs font-medium text-colorText">
                            <HandPointing size={14} weight="fill" className="shrink-0" />
                            The agent needs you
                        </span>
                        <span className="text-[13px] leading-relaxed text-colorTextSecondary [text-wrap:pretty]">
                            {waiting}
                        </span>
                    </div>
                    <div className="ml-auto flex shrink-0 items-center gap-1.5">
                        {userControl ? (
                            <>
                                <Button size="sm" variant="ghost" onClick={giveBack}>
                                    Give back control
                                </Button>
                                <Button size="sm" onClick={done}>
                                    <CheckCircle size={14} />
                                    I'm done
                                </Button>
                            </>
                        ) : (
                            <>
                                <Button size="sm" variant="ghost" onClick={done}>
                                    I'm done
                                </Button>
                                <Button size="sm" onClick={takeControl}>
                                    <HandPointing size={14} />
                                    Take control
                                </Button>
                            </>
                        )}
                    </div>
                </div>
            ) : null}
            {notice ? (
                <p role="status" className="m-0 text-xs text-colorError">
                    {notice.message}
                </p>
            ) : null}
            <div className="relative flex min-h-0 flex-1 items-center justify-center overflow-hidden rounded-lg border border-solid border-colorBorderSecondary bg-colorFillQuaternary">
                <canvas
                    ref={canvasRef}
                    width={BROWSER_VIEWPORT.width}
                    height={BROWSER_VIEWPORT.height}
                    aria-label={status?.title ? `Browser showing ${status.title}` : "Browser"}
                    className={`block max-h-full max-w-full touch-none select-none bg-colorBgContainer ${userControl ? "cursor-default" : "cursor-not-allowed"}`}
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
                    <div className="absolute inset-0 flex flex-col items-center justify-center gap-3 bg-muted/90 p-4 text-center text-sm text-colorTextSecondary">
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
                                        connection.phase === "error" ? "text-colorError" : undefined
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
                ) : null}
            </div>
            {live && status && !userControl && !waiting ? (
                <p className="m-0 text-xs text-colorTextTertiary">
                    View only. Take control to click and type.
                </p>
            ) : null}
        </div>
    )
}
