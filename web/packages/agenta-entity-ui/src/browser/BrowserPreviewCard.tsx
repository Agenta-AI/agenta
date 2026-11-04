import {useRef, type RefObject} from "react"

import {projectIdAtom} from "@agenta/shared/state"
import {useAtomValue} from "jotai"

import {browserLiveUrl} from "./live"
import {useBrowserLiveSocket} from "./useBrowserLiveSocket"

const hostOf = (url: string) => {
    try {
        return new URL(url).host
    } catch {
        return ""
    }
}

/** The canvas stays mounted while hidden: frames paint into it from the first message. */
export const BrowserPreviewView = ({
    title,
    url,
    tabCount,
    live,
    canvasRef,
    onOpen,
}: {
    title: string
    url: string
    tabCount: number
    live: boolean
    canvasRef: RefObject<HTMLCanvasElement | null>
    onOpen: () => void
}) => (
    <button
        type="button"
        onClick={onOpen}
        aria-label={`View the agent's browser: ${title || hostOf(url) || "open"}`}
        className={`w-80 max-w-full cursor-pointer overflow-hidden rounded-lg border border-solid border-colorBorderSecondary bg-colorBgContainer p-0 text-left transition-colors hover:border-colorBorder ${live ? "block" : "hidden"}`}
    >
        <canvas
            ref={canvasRef}
            aria-hidden
            className="block aspect-[16/10] w-full bg-colorFillQuaternary object-cover object-top"
        />
        <span className="flex min-w-0 items-center gap-2 border-0 border-t border-solid border-colorBorderSecondary px-2.5 py-2 text-xs">
            <span aria-hidden className="size-1.5 shrink-0 rounded-full bg-success" />
            <span className="min-w-0 truncate font-medium text-colorText">
                {title || hostOf(url) || "Browser"}
            </span>
            {tabCount > 1 ? (
                <span className="shrink-0 text-colorTextTertiary">· {tabCount} tabs</span>
            ) : null}
            <span className="ml-auto shrink-0 text-colorTextSecondary">View</span>
        </span>
    </button>
)

/** A live look at the agent's browser while it works; the pane is the full view. */
export const BrowserPreviewCard = ({
    sessionId,
    onOpen,
}: {
    sessionId: string
    onOpen: () => void
}) => {
    const projectId = useAtomValue(projectIdAtom)
    const canvasRef = useRef<HTMLCanvasElement | null>(null)
    const url = projectId ? browserLiveUrl(projectId, sessionId) : null
    const {connection, status} = useBrowserLiveSocket(url, canvasRef)
    return (
        <BrowserPreviewView
            title={status?.title ?? ""}
            url={status?.url ?? ""}
            tabCount={status?.tabs.length ?? 0}
            live={connection.phase === "live" && Boolean(status)}
            canvasRef={canvasRef}
            onOpen={onOpen}
        />
    )
}
