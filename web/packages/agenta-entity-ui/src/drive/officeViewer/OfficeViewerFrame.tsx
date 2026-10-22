import {type ReactNode, useCallback, useEffect, useMemo, useRef, useState} from "react"

import {Button} from "@agenta/ui/ui"
import {CaretLeft, CaretRight} from "@phosphor-icons/react"

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
}: {
    kind: OfficeViewerKind
    blob: Blob
    onFailed: () => void
    /** Shown over the frame until the file has rendered. */
    placeholder: ReactNode
}) {
    const frameRef = useRef<HTMLIFrameElement>(null)
    const [script, setScript] = useState<string | null>(null)
    const [state, setState] = useState<ViewerState>({status: "loading"})
    // The slide last asked for; clicks step from it, not from the frame's slower echo.
    const targetRef = useRef(0)

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
            const message = parseViewerMessage(event.data)
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
                    return
                case "slide":
                    targetRef.current = message.index
                    setState((s) => (s.status === "rendered" ? {...s, index: message.index} : s))
                    return
                case "failed":
                    setState({status: "failed"})
                    onFailed()
                    return
                case "open-link":
                    openViewerLink(message.url)
                    return
            }
        }
        window.addEventListener("message", onMessage)
        return () => window.removeEventListener("message", onMessage)
    }, [blob, kind, onFailed, send])

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
        <div className="relative flex min-h-0 flex-1 flex-col">
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
