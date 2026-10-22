import {type ReactNode, useCallback, useEffect, useMemo, useRef, useState} from "react"

import type {PinQuery} from "@agenta/shared/previewPicker"
import {
    PreviewCommentLayer,
    usePreviewComments,
    type PreviewCommentTarget,
    type PreviewPick,
    type PreviewPinRect,
    type PreviewRect,
} from "@agenta/ui/quote-selection"
import {Button} from "@agenta/ui/ui"
import {CaretLeft, CaretRight} from "@phosphor-icons/react"

import {useDriveSessionId} from "../driveSessionContext"
import {usePreviewCommentMode} from "../previewCommentMode"

import {
    buildViewerSrcdoc,
    OFFICE_VIEWER_SANDBOX,
    openViewerLink,
    parseViewerMessage,
    type HostToViewer,
    type OfficeViewerKind,
} from "./protocol"

const loadViewerScript = (kind: OfficeViewerKind): Promise<string> =>
    kind === "document"
        ? import("./generated/docxViewer").then((m) => m.DOCX_VIEWER_SCRIPT)
        : import("./generated/pptxViewer").then((m) => m.PPTX_VIEWER_SCRIPT)

const RENDER_TIMEOUT_MS = 60_000

type ViewerState =
    | {status: "loading"}
    | {status: "rendered"; slideCount: number; index: number}
    | {status: "failed"}

/** A frame-viewport rect moved into the root's coordinates. */
const toRoot = (rect: PreviewRect, frame: HTMLIFrameElement, root: HTMLElement): PreviewRect => {
    const f = frame.getBoundingClientRect()
    const r = root.getBoundingClientRect()
    return {...rect, top: rect.top + f.top - r.top, left: rect.left + f.left - r.left}
}

/** Renders a DOCX or PPTX in the sandboxed viewer frame; slide controls stay in the app. */
export function OfficeViewerFrame({
    kind,
    blob,
    onFailed,
    placeholder,
    target,
}: {
    kind: OfficeViewerKind
    blob: Blob
    onFailed: () => void
    /** Shown over the frame until the file has rendered. */
    placeholder: ReactNode
    /** The file comments and pins belong to. */
    target: PreviewCommentTarget
}) {
    const frameRef = useRef<HTMLIFrameElement>(null)
    const rootRef = useRef<HTMLDivElement>(null)
    const [script, setScript] = useState<string | null>(null)
    const [state, setState] = useState<ViewerState>({status: "loading"})
    // The slide last asked for; clicks step from it, not from the frame's slower echo.
    const targetRef = useRef(0)
    // The slide the frame last reported; a new object per report, so pins follow every one.
    const [shown, setShown] = useState<{slide: number} | null>(null)
    const [pick, setPick] = useState<PreviewPick | null>(null)
    const [pinRects, setPinRects] = useState<PreviewPinRect[]>([])
    const sessionId = useDriveSessionId()
    const {enabled, setEnabled} = usePreviewCommentMode()
    const format = kind === "document" ? "document" : "presentation"

    useEffect(() => {
        let cancelled = false
        loadViewerScript(kind)
            .then((s) => !cancelled && setScript(s))
            .catch(() => !cancelled && onFailed())
        return () => {
            cancelled = true
        }
    }, [kind, onFailed])

    const srcdoc = useMemo(() => (script ? buildViewerSrcdoc(script) : null), [script])

    const send = useCallback((message: HostToViewer, transfer: Transferable[] = []) => {
        frameRef.current?.contentWindow?.postMessage(message, "*", transfer)
    }, [])

    useEffect(() => {
        const onMessage = (event: MessageEvent) => {
            const frame = frameRef.current?.contentWindow
            if (!frame || event.source !== frame) return
            const box = frameRef.current
            const message = parseViewerMessage(event.data, {
                width: box?.clientWidth ?? 0,
                height: box?.clientHeight ?? 0,
            })
            if (!message) return
            switch (message.type) {
                case "ready":
                    blob.arrayBuffer().then(
                        (bytes) => send({type: "render", kind, bytes}, [bytes]),
                        onFailed,
                    )
                    return
                case "rendered":
                    targetRef.current = 0
                    setState({status: "rendered", slideCount: message.slideCount, index: 0})
                    setShown({slide: 0})
                    return
                case "slide":
                    targetRef.current = message.index
                    setState((s) => (s.status === "rendered" ? {...s, index: message.index} : s))
                    setPinRects([])
                    setShown({slide: message.index})
                    return
                case "failed":
                    setState({status: "failed"})
                    onFailed()
                    return
                case "open-link":
                    openViewerLink(message.url)
                    return
                case "picked": {
                    const root = rootRef.current
                    if (!enabled || !box || !root) return
                    const {selector, tag, page, point} = message.element
                    setPick({
                        anchor: {type: "element", format, selector, tag, page, point},
                        text: message.text,
                        rect: toRoot(message.rect, box, root),
                    })
                    return
                }
                case "pick-cancel":
                    setEnabled(false)
                    return
                case "pin-rects": {
                    const root = rootRef.current
                    if (!box || !root) return
                    setPinRects(
                        message.rects.map(({id, rect}) => ({
                            id,
                            rect: rect ? toRoot(rect, box, root) : null,
                        })),
                    )
                    return
                }
            }
        }
        window.addEventListener("message", onMessage)
        return () => window.removeEventListener("message", onMessage)
    }, [blob, kind, onFailed, send, enabled, setEnabled, format])

    // A frame that has not rendered yet ignores the mode.
    const picking = useRef(false)
    useEffect(() => {
        if (!shown) return
        if (enabled) {
            picking.current = true
            const page = format === "presentation" ? shown.slide + 1 : undefined
            send({type: "pick-start", format, page})
        } else if (picking.current) {
            picking.current = false
            send({type: "pick-stop"})
        }
    }, [shown, enabled, format, send])

    // A slide's pins go only to that slide; the others keep their staleness untouched.
    const comments = usePreviewComments(sessionId, target)
    const pins = useMemo(() => {
        const slide = shown ? shown.slide + 1 : null
        const list: PinQuery[] = []
        for (const quote of comments) {
            const {anchor} = quote.source
            if (anchor.type !== "element") continue
            if (format === "presentation" && anchor.page !== slide) continue
            list.push({id: quote.id, selector: anchor.selector, text: quote.text})
        }
        return list
    }, [comments, shown, format])
    useEffect(() => {
        if (shown) send({type: "pins", pins})
    }, [shown, pins, send])

    // A file that keeps the renderer busy falls back to download instead of loading forever.
    const loading = state.status === "loading"
    useEffect(() => {
        if (!loading) return
        const timer = setTimeout(() => {
            setState({status: "failed"})
            onFailed()
        }, RENDER_TIMEOUT_MS)
        return () => clearTimeout(timer)
    }, [loading, onFailed])

    const slides = kind === "presentation" && state.status === "rendered" ? state : null
    const step = (delta: number) => {
        if (!slides) return
        const index = Math.min(Math.max(targetRef.current + delta, 0), slides.slideCount - 1)
        if (index === targetRef.current) return
        targetRef.current = index
        setState({...slides, index})
        send({type: "goto", index})
    }

    return (
        <div ref={rootRef} className="relative flex min-h-0 flex-1 flex-col">
            {state.status === "rendered" ? null : (
                <div className="absolute inset-0 flex flex-col">{placeholder}</div>
            )}
            {srcdoc ? (
                <iframe
                    ref={frameRef}
                    srcDoc={srcdoc}
                    sandbox={OFFICE_VIEWER_SANDBOX}
                    title={kind === "document" ? "Document preview" : "Presentation preview"}
                    // Same color scheme as the frame document, so the browser keeps its canvas transparent.
                    className={`min-h-0 w-full flex-1 border-0 [color-scheme:light] ${
                        state.status === "rendered" ? "" : "invisible"
                    }`}
                />
            ) : null}
            {shown ? (
                <PreviewCommentLayer
                    rootRef={rootRef}
                    sessionId={sessionId}
                    target={target}
                    pick={pick}
                    onPickConsumed={() => setPick(null)}
                    pinRects={pinRects}
                />
            ) : null}
            {slides ? (
                <div className="flex shrink-0 items-center justify-center gap-2 border-0 border-t border-solid border-colorBorderSecondary px-2 py-1">
                    <Button
                        variant="ghost"
                        size="icon-sm"
                        aria-label="Previous slide"
                        disabled={slides.index <= 0}
                        onClick={() => step(-1)}
                    >
                        <CaretLeft />
                    </Button>
                    <span className="min-w-12 text-center text-xs tabular-nums text-colorTextSecondary">
                        {slides.index + 1} / {slides.slideCount}
                    </span>
                    <Button
                        variant="ghost"
                        size="icon-sm"
                        aria-label="Next slide"
                        disabled={slides.index >= slides.slideCount - 1}
                        onClick={() => step(1)}
                    >
                        <CaretRight />
                    </Button>
                </div>
            ) : null}
        </div>
    )
}
