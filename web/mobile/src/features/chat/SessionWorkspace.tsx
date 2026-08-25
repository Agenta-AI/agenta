import {useState, type ReactNode} from "react"

import {chatPanelMaximizedAtom, configPanelCollapsedAtom} from "@agenta/chat/state"
import {SessionFilesPane, useSessionFilesPane} from "@agenta/entity-ui/drive"
import {useMediaQuery} from "@agenta/ui/hooks"
import {SplitPane, usePaneSlide} from "@agenta/ui/ui"
import {useAtomValue} from "jotai"
import dynamic from "next/dynamic"

import {AppShell} from "../nav/AppShell"

import {resolveSessionPanes} from "./sessionPanes"
import {SessionsPane} from "./SessionsPane"
import {SessionTabs} from "./SessionTabs"
import {SessionTopBar} from "./SessionTopBar"

// Build's config panel carries the whole schema-form surface (DrillInView + the editor). Chat
// mode never renders it, so it loads on demand instead of riding in the session page's bundle —
// the panel is behind an explicit mode switch, so a chunk fetch on that click is invisible.
const ConfigPane = dynamic(() => import("./ConfigPane").then((m) => m.ConfigPane), {
    ssr: false,
})

/**
 * The playground's two-pane frame, on the SAME kit `SplitPane` the desktop drives it with and the
 * SAME `chatPanelMaximizedAtom` that decides the mode: "chat" maximizes the conversation (config
 * collapsed to 0, session rail in its place), "build" is the two-panel edit view.
 *
 * The conversation is ALWAYS mounted EXACTLY ONCE — the mode only decides what sits beside it, and
 * the width only decides the geometry — so neither a mode switch nor a rotation drops a streaming
 * turn. That is why both widths drive the SAME `SplitPane` rather than two sibling containers: a
 * node rendered in two containers mounts twice even when one is CSS-hidden, which ran two chat
 * engines at once.
 *
 * Pane geometry is the desktop's: 440 default and max, 300 min, controlled px so a drag persists
 * for the mount. Below `md` there is no room for two panes (300 pane + 420 fill), so the split
 * collapses to one visible pane and the mode picks which.
 */
export const SessionWorkspace = ({
    entityId,
    agentId,
    sessionId,
    workspaceId,
    projectId,
    chat,
    bare = false,
}: {
    /** The revision being configured. Absent = nothing to build yet (a session with no turns). */
    entityId: string | null
    agentId?: string | null
    sessionId: string
    workspaceId: string
    projectId: string
    /** The conversation, rendered embedded (it brings its own header, dock and composer). */
    chat: ReactNode
    /**
     * Skip the surrounding `AppShell`. A host that already renders one (first run, which swaps
     * only Home's body) would otherwise stack a second nav rail beside the first.
     */
    bare?: boolean
}) => {
    const base = `/w/${workspaceId}/p/${projectId}`
    const chatMaximized = useAtomValue(chatPanelMaximizedAtom)
    // Collapsing the config panel is separate from the Build/Chat mode: the desktop keeps you in
    // Build with the panel out of the way, and the top bar's "»" brings it back.
    const configCollapsed = useAtomValue(configPanelCollapsedAtom)
    // Files dock as a resizable right-edge pane, as they do on the desktop, rather than an
    // overlay drawer. Scope is the AGENT, not the session: opening files then switching session
    // must not snap the pane shut.
    const filesScope = agentId ?? sessionId
    const {open: filesOpen} = useSessionFilesPane(filesScope, sessionId)
    // Tailwind's `md`. Client-only, so the first paint is the phone layout — the right guess here.
    const twoPane = useMediaQuery("(min-width: 768px)")
    // Which half is on screen. The rule is in `sessionPanes.ts`, with its tests: on a phone the
    // pane replaces the conversation, so getting it wrong puts the composer out of reach.
    const {showConfig, showPane} = resolveSessionPanes({
        chatMaximized,
        configCollapsed,
        twoPane,
        hasEntity: Boolean(entityId),
    })
    // Controlled px, as on the desktop: the dragged width persists for the mount; 440 is the
    // config panel's cap and its default.
    const [paneSize, setPaneSize] = useState(440)
    // The files pane needs its own width, for the same reason the config pane does: a hardcoded
    // `paneSize` means a drag has nowhere to write, so the divider moves under the pointer and the
    // pane snaps straight back. 380 is its default, within the 320/560 bounds below.
    const [filesPaneSize, setFilesPaneSize] = useState(380)

    // Both panes slide rather than snap, on the same shared mechanism the desktop uses. Without
    // it the pane's width flipped in one frame and its content unmounted before the flip, so
    // opening and hiding either panel jumped instead of moving.
    const configSlide = usePaneSlide(showPane)
    const filesSlide = usePaneSlide(twoPane && filesOpen)

    // The same surface treatment the desktop layout applies: the workspace is a recessed ground,
    // the config panel is raised above it, the conversation is the recessed canvas. Without these
    // the shared panels render flat — identical components, missing surface ladder.
    const pane =
        showConfig && entityId ? (
            <ConfigPane entityId={entityId} agentId={agentId} sessionId={sessionId} />
        ) : (
            <SessionsPane agentId={agentId} base={base} activeSessionId={sessionId} />
        )

    const workspace = (
        <>
            {/* The workspace column: the shared playground top bar, then the panes under it. The
                column owns the top safe-area inset (the bar is the topmost chrome). */}
            <div className="ag-app-ground flex h-[var(--ag-viewport-height,100dvh)] min-w-0 flex-col pt-[env(safe-area-inset-top)]">
                <SessionTopBar
                    entityId={entityId}
                    agentId={agentId}
                    sessionId={sessionId}
                    workspaceId={workspaceId}
                    projectId={projectId}
                />

                {/* One split at every width. On a phone the pane it does not show is CSS-hidden
                    rather than dropped, which is what keeps both halves mounted exactly once. */}
                <div className="min-h-0 min-w-0 flex-1">
                    <SplitPane
                        paneSide="start"
                        paneSize={twoPane && showPane ? paneSize : 0}
                        paneMin={300}
                        paneMax={440}
                        fillMin={420}
                        // Phone: no divider, no drag, and the visible half takes the full width.
                        animate={configSlide.animate}
                        barHidden={!twoPane || !showPane}
                        resizable={twoPane && showPane}
                        paneGrow={!twoPane && showPane}
                        paneClassName={!twoPane && !showPane ? "hidden" : undefined}
                        fillClassName={!twoPane && showPane ? "hidden" : undefined}
                        // Controlled width: the drag must write through per tick, or the pane only
                        // snaps at pointer-up.
                        onResize={(size) => setPaneSize(size)}
                        onResizeEnd={(size) => setPaneSize(size)}
                        className="h-full"
                        pane={configSlide.keepMounted ? pane : null}
                        fill={
                            <SplitPane
                                paneSide="end"
                                paneSize={twoPane && filesOpen ? filesPaneSize : 0}
                                paneMin={320}
                                paneMax={560}
                                fillMin={360}
                                animate={filesSlide.animate}
                                barHidden={!twoPane || !filesOpen}
                                resizable={twoPane && filesOpen}
                                // Controlled width, so the drag must write through per tick or the
                                // pane only moves at pointer-up.
                                onResize={(size) => setFilesPaneSize(size)}
                                onResizeEnd={(size) => setFilesPaneSize(size)}
                                className="h-full"
                                pane={
                                    filesSlide.keepMounted ? (
                                        <SessionFilesPane
                                            scope={filesScope}
                                            sessionId={sessionId}
                                        />
                                    ) : null
                                }
                                fill={
                                    <div className="ag-canvas flex h-full min-h-0 flex-col">
                                        {/* The rail belongs to the WORKSPACE, not to one
                                            conversation. It used to live inside the conversation's
                                            pinned header, so keying that per session remounted the
                                            rail too and reset its scroll to 0 — you would scroll a
                                            long strip, pick a tab, and the strip snapped back to
                                            the start. Up here it simply stays put. */}
                                        <SessionTabs
                                            sessionId={sessionId}
                                            projectId={projectId}
                                            workspaceId={workspaceId}
                                            agentId={agentId}
                                        />
                                        <div className="min-h-0 flex-1">{chat}</div>
                                    </div>
                                }
                            />
                        }
                    />
                </div>
            </div>
        </>
    )

    if (bare) return workspace
    return (
        <AppShell workspaceId={workspaceId} projectId={projectId}>
            {workspace}
        </AppShell>
    )
}
