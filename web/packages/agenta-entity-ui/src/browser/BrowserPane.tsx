import {useRef} from "react"

import {projectIdAtom} from "@agenta/shared/state"
import {Button, SimpleTooltip} from "@agenta/ui/ui"
import {CaretDoubleLeft, CaretDoubleRight, Globe} from "@phosphor-icons/react"
import {useAtomValue} from "jotai"

import {ROW_ICON_BTN} from "../drive/DriveHeader"

import {BrowserLiveSurface} from "./BrowserLiveSurface"
import {BrowserTabStrip} from "./BrowserTabStrip"
import {browserLiveUrl} from "./live"
import {
    useBrowserLiveSocket,
    type BrowserLiveConnection,
    type BrowserLiveStatus,
} from "./useBrowserLiveSocket"

// Mobile's StatusTag tones: the accent asks for action, success is live, muted is at rest.
const TONES = {
    attention: "border-primary/40 text-primary bg-primary/10",
    live: "border-success/40 text-success bg-success/10",
    muted: "border-border text-muted-foreground bg-muted/40",
}

const DOTS = {
    attention: "bg-primary",
    live: "bg-success",
    muted: "bg-muted-foreground",
}

interface BrowserState {
    tone: keyof typeof TONES
    dot?: boolean
    label: string
}

const StateTag = ({tone, dot, label}: BrowserState) => (
    <span
        className={`inline-flex shrink-0 items-center gap-1 rounded-full border border-solid px-2 py-0.5 text-xs leading-none font-medium ${TONES[tone]}`}
    >
        {dot ? <span aria-hidden className="size-1.5 rounded-full bg-current" /> : null}
        {label}
    </span>
)

/** Beside the tab chips the width belongs to the tabs; the address row says the rest. */
const StateDot = ({tone, label}: BrowserState) => (
    <SimpleTooltip title={label}>
        <span
            role="img"
            aria-label={label}
            className={`mx-1 size-2 shrink-0 rounded-full ${DOTS[tone]}`}
        />
    </SimpleTooltip>
)

const browserState = (
    connection: BrowserLiveConnection,
    status: BrowserLiveStatus | null,
): BrowserState | null => {
    if (connection.phase !== "live" || !status)
        return connection.phase === "connecting" ? null : {tone: "muted", label: "Closed"}
    if (status.waiting) return {tone: "attention", dot: true, label: "Needs you"}
    if (status.control === "user") return {tone: "muted", label: "You're in control"}
    return {tone: "live", dot: true, label: "Live"}
}

/** The agent's browser, docked like the Files pane; `closeControl` follows that pane's. */
export const BrowserPane = ({
    sessionId,
    closeControl = "collapse",
    onClose,
}: {
    sessionId: string
    closeControl?: "back" | "collapse"
    onClose: () => void
}) => {
    const projectId = useAtomValue(projectIdAtom)
    const canvasRef = useRef<HTMLCanvasElement | null>(null)
    const url = projectId ? browserLiveUrl(projectId, sessionId) : null
    const {connection, status, notice, viewport, send, reconnect} = useBrowserLiveSocket(
        url,
        canvasRef,
    )

    const tabs = connection.phase === "live" ? (status?.tabs ?? []) : []
    const state = browserState(connection, status)
    const backButton =
        closeControl === "back" ? (
            <Button
                variant="ghost"
                size="icon-sm"
                aria-label="Close browser"
                onClick={onClose}
                className={ROW_ICON_BTN}
            >
                <CaretDoubleLeft size={15} />
            </Button>
        ) : null
    const collapseButton =
        closeControl === "collapse" ? (
            <SimpleTooltip title="Hide browser">
                <Button
                    variant="ghost"
                    size="icon-sm"
                    aria-label="Close browser"
                    onClick={onClose}
                    className={ROW_ICON_BTN}
                >
                    <CaretDoubleRight size={15} />
                </Button>
            </SimpleTooltip>
        ) : null

    return (
        <section aria-label="Agent browser" className="flex h-full min-h-0 w-full flex-col">
            {tabs.length > 1 ? (
                <BrowserTabStrip
                    tabs={tabs}
                    onSelect={(id) => send({type: "tab", id})}
                    leading={backButton}
                    trailing={
                        <>
                            {state ? <StateDot {...state} /> : null}
                            {collapseButton}
                        </>
                    }
                />
            ) : (
                <div className="flex h-[48px] shrink-0 items-center gap-1.5 border-0 border-b border-solid border-[var(--ag-surface-card-border)] px-2">
                    {backButton}
                    <Globe size={15} className="ml-1 shrink-0 text-colorTextTertiary" aria-hidden />
                    <span className="min-w-0 truncate text-sm font-medium text-colorText">
                        {status?.title || "Browser"}
                    </span>
                    <span className="ml-auto shrink-0">
                        {state ? <StateTag {...state} /> : null}
                    </span>
                    {collapseButton}
                </div>
            )}
            <div className="flex min-h-0 flex-1 flex-col p-2">
                <BrowserLiveSurface
                    connection={connection}
                    status={status}
                    notice={notice}
                    viewport={viewport}
                    canvasRef={canvasRef}
                    send={send}
                    onReconnect={reconnect}
                />
            </div>
        </section>
    )
}
