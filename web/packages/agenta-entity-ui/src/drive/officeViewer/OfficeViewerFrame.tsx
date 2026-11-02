import {type ReactNode, useCallback, useEffect, useMemo, useRef, useState} from "react"

import {
    frameRectToRoot,
    PreviewCommentLayer,
    toPinQueries,
    usePreviewComments,
    type PreviewCommentTarget,
    type PreviewPick,
    type PreviewPinRect,
} from "@agenta/ui/quote-selection"
import {Button, Segmented} from "@agenta/ui/ui"
import {CaretLeft, CaretRight} from "@phosphor-icons/react"

import {usePreviewCommentMode, usePreviewCommentSession} from "../previewCommentMode"

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
// Narrower than this, a Word page scaled to fit is too small to read, so text reflows instead.
const REFLOW_BELOW_PX = 480

type ViewerState =
    | {status: "loading"}
    | {status: "rendered"; slideCount: number; index: number}
    | {status: "failed"}

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
    const [dismissSignal, setDismissSignal] = useState(0)
    const [pinRects, setPinRects] = useState<PreviewPinRect[]>([])
    const sessionId = usePreviewCommentSession()
    const {enabled, setEnabled} = usePreviewCommentMode()
    const enabledRef = useRef(enabled)
    enabledRef.current = enabled
    const [reflow, setReflow] = useState(false)
    // The layout last asked for; quick clicks compare against it, not a stale render's state.
    const reflowRef = useRef(false)
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
                case "ready": {
                    const narrow =
                        kind === "document" && (rootRef.current?.clientWidth ?? 0) < REFLOW_BELOW_PX
                    reflowRef.current = narrow
                    setReflow(narrow)
                    blob.arrayBuffer().then(
                        (bytes) => send({type: "render", kind, bytes, reflow: narrow}, [bytes]),
                        onFailed,
                    )
                    return
                }
                case "rendered":
                    targetRef.current = 0
                    setState({status: "rendered", slideCount: message.slideCount, index: 0})
                    setShown({slide: 0})
                    return
                case "slide":
                    targetRef.current = message.index
                    setState((s) => (s.status === "rendered" ? {...s, index: message.index} : s))
                    // A document's page report only moves the counter; its pins span every page.
                    if (kind === "document") return
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
                    if (!enabledRef.current || !box || !root) return
                    const {selector, tag, page, block, point} = message.element
                    setPick({
                        anchor: {type: "element", format, selector, tag, page, block, point},
                        text: message.text,
                        rect: frameRectToRoot(message.rect, box, root),
                    })
                    return
                }
                case "pick-cancel":
                    setEnabled(false)
                    return
                case "pick-dismiss":
                    setDismissSignal((n) => n + 1)
                    return
                case "pick-toggle":
                    setEnabled(!enabledRef.current)
                    return
                case "pin-rects": {
                    const root = rootRef.current
                    if (!box || !root) return
                    setPinRects(
                        message.rects.map(({id, rect}) => ({
                            id,
                            rect: rect ? frameRectToRoot(rect, box, root) : null,
                        })),
                    )
                    return
                }
            }
        }
        window.addEventListener("message", onMessage)
        return () => window.removeEventListener("message", onMessage)
    }, [blob, kind, onFailed, send, setEnabled, format])

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
        return toPinQueries(comments, (a) => format !== "presentation" || a.page === slide)
    }, [comments, shown, format])
    useEffect(() => {
        if (shown) send({type: "pins", pins})
    }, [shown, pins, send])
    useEffect(() => {
        if (shown && sessionId) send({type: "pick-keys"})
    }, [shown, sessionId, send])

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

    const layout = useCallback(
        (next: boolean) => {
            if (next === reflowRef.current) return
            reflowRef.current = next
            setReflow(next)
            send({type: "layout", reflow: next})
        },
        [send],
    )

    const rendered = state.status === "rendered" ? state : null
    const slides = kind === "presentation" ? rendered : null
    const pages = kind === "document" ? rendered : null
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
                    onNoteChange={(held) => send({type: "pick-hold", held})}
                    dismissSignal={dismissSignal}
                    onRevealPin={({id, source: {anchor}}) => {
                        if (anchor.type === "element" && slides && anchor.page)
                            step(anchor.page - 1 - targetRef.current)
                        send({type: "pin-reveal", id})
                    }}
                    commenting={enabled}
                    pinRects={pinRects}
                />
            ) : null}
            {slides ? (
                <div className="flex shrink-0 items-center justify-between gap-2 border-0 border-t border-solid border-colorBorderSecondary px-2 py-1">
                    <Button
                        variant="ghost"
                        size="icon"
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
                        size="icon"
                        aria-label="Next slide"
                        disabled={slides.index >= slides.slideCount - 1}
                        onClick={() => step(1)}
                    >
                        <CaretRight />
                    </Button>
                </div>
            ) : null}
            {pages ? (
                <div className="flex shrink-0 items-center justify-between gap-2 border-0 border-t border-solid border-colorBorderSecondary px-3 py-1">
                    <span className="text-xs tabular-nums text-colorTextSecondary">
                        {reflow || !pages.slideCount
                            ? ""
                            : `Page ${pages.index + 1} of ${pages.slideCount}`}
                    </span>
                    <Segmented
                        size="sm"
                        aria-label="Layout"
                        value={reflow ? "reflow" : "pages"}
                        onChange={(v) => layout(v === "reflow")}
                        options={[
                            {value: "reflow", label: "Reflow"},
                            {value: "pages", label: "Pages"},
                        ]}
                    />
                </div>
            ) : null}
        </div>
    )
}
