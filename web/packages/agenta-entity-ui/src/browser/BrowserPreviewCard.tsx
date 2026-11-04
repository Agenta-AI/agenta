import {useRef, type RefObject} from "react"

import {projectIdAtom} from "@agenta/shared/state"
import {ArrowUpRight} from "@phosphor-icons/react"
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

/** Chrome titles a tab "Loading <url>" before the page answers; that is not a page name. */
const pageName = (title: string, host: string) =>
    title && !title.startsWith("Loading ") ? title : host || "Opening a page"

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
}) => {
    const host = hostOf(url)
    const name = pageName(title, host)
    return (
        <button
            type="button"
            onClick={onOpen}
            aria-label={`View the agent's browser: ${name}`}
            className={`group relative w-[22.5rem] max-w-full cursor-pointer border-0 bg-transparent p-0 text-left ${live ? "block" : "hidden"}`}
        >
            <span className="relative block overflow-hidden rounded-xl border border-solid border-colorBorderSecondary bg-colorBgContainer shadow-lg shadow-black/30">
                <canvas
                    ref={canvasRef}
                    aria-hidden
                    className="block aspect-[16/10] w-full bg-colorFillQuaternary object-cover object-top transition-transform duration-700 ease-out group-hover:scale-[1.03]"
                />
                <span
                    aria-hidden
                    className="absolute inset-x-0 bottom-0 h-3/5 bg-gradient-to-t from-black/90 via-black/55 to-transparent"
                />
                <span className="absolute top-2.5 left-2.5 flex items-center gap-1.5 rounded-full bg-black/55 py-1 pr-2.5 pl-2 text-[11px] leading-none font-medium text-white backdrop-blur-md">
                    <span aria-hidden className="relative flex size-1.5">
                        <span className="absolute inset-0 rounded-full bg-success motion-safe:animate-ping" />
                        <span className="relative size-1.5 rounded-full bg-success" />
                    </span>
                    Browsing
                </span>
                <span
                    aria-hidden
                    className="absolute top-2.5 right-2.5 flex size-6 items-center justify-center rounded-full bg-black/55 text-white opacity-0 backdrop-blur-md transition-opacity duration-200 group-hover:opacity-100 group-focus-visible:opacity-100"
                >
                    <ArrowUpRight size={13} weight="bold" />
                </span>
                <span className="absolute inset-x-0 bottom-0 flex items-end gap-2.5 p-3">
                    <span
                        aria-hidden
                        className="flex size-8 shrink-0 items-center justify-center rounded-lg bg-white/15 text-sm font-semibold text-white uppercase backdrop-blur-md"
                    >
                        {(host.replace(/^www\./, "") || "?").charAt(0)}
                    </span>
                    <span className="flex min-w-0 flex-1 flex-col gap-0.5">
                        <span className="truncate text-[13px] leading-tight font-medium text-white">
                            {name}
                        </span>
                        <span className="truncate text-[11px] leading-tight text-white/60">
                            {host}
                        </span>
                    </span>
                    {tabCount > 1 ? (
                        <span className="shrink-0 rounded-full bg-white/15 px-2 py-1 text-[11px] leading-none font-medium text-white backdrop-blur-md">
                            {tabCount} tabs
                        </span>
                    ) : null}
                </span>
            </span>
        </button>
    )
}

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
