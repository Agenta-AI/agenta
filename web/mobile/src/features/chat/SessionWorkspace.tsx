import {useState, type ReactNode} from "react"

import {chatPanelMaximizedAtom, configPanelCollapsedAtom} from "@agenta/chat/state"
import {SessionFilesPane, useSessionFilesPane} from "@agenta/entity-ui/drive"
import {useMediaQuery} from "@agenta/ui/hooks"
import {SplitPane} from "@agenta/ui/ui"
import {useAtomValue} from "jotai"
import dynamic from "next/dynamic"

import {AppShell} from "../nav/AppShell"

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
}: {
    /** The revision being configured. Absent = nothing to build yet (a session with no turns). */
    entityId: string | null
    agentId?: string | null
    sessionId: string
    workspaceId: string
    projectId: string
    /** The conversation, rendered embedded (it brings its own header, dock and composer). */
    chat: ReactNode
}) => {
    const base = `/w/${workspaceId}/p/${projectId}`
    const chatMaximized = useAtomValue(chatPanelMaximizedAtom)
    // Collapsing the config panel is separate from the Build/Chat mode: the desktop keeps you in
    // Build with the panel out of the way, and the top bar's "»" brings it back.
    const configCollapsed = useAtomValue(configPanelCollapsedAtom)
    const showConfig = !chatMaximized && !configCollapsed && Boolean(entityId)
    // The sessions rail stands in for the config panel ONLY in maximized mode, as on the desktop.
    // Collapsing config collapses the PANE and gives the width to the conversation; swapping the
    // rail in instead means the collapse never actually frees any space.
    const showPane = showConfig || chatMaximized
    // Files dock as a resizable right-edge pane, as they do on the desktop, rather than an
    // overlay drawer. Scope is the AGENT, not the session: opening files then switching session
    // must not snap the pane shut.
    const filesScope = agentId ?? sessionId
    const {open: filesOpen} = useSessionFilesPane(filesScope, sessionId)
    // Tailwind's `md`. Client-only, so the first paint is the phone layout — the right guess here.
    const twoPane = useMediaQuery("(min-width: 768px)")
    // Controlled px, as on the desktop: the dragged width persists for the mount; 440 is the
    // config panel's cap and its default.
    const [paneSize, setPaneSize] = useState(440)

    // The same surface treatment the desktop layout applies: the workspace is a recessed ground,
    // the config panel is raised above it, the conversation is the recessed canvas. Without these
    // the shared panels render flat — identical components, missing surface ladder.
    const pane =
        showConfig && entityId ? (
            <ConfigPane entityId={entityId} agentId={agentId} sessionId={sessionId} />
        ) : (
            <SessionsPane agentId={agentId} base={base} activeSessionId={sessionId} />
        )

    return (
        <AppShell workspaceId={workspaceId} projectId={projectId}>
            {/* The workspace column: the shared playground top bar, then the panes under it. The
                column owns the top safe-area inset (the bar is the topmost chrome). */}
            <div className="ag-app-ground flex h-dvh min-w-0 flex-col pt-[env(safe-area-inset-top)]">
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
                        pane={pane}
                        fill={
                            <SplitPane
                                paneSide="end"
                                paneSize={twoPane && filesOpen ? 380 : 0}
                                paneMin={320}
                                paneMax={560}
                                fillMin={360}
                                barHidden={!twoPane || !filesOpen}
                                resizable={twoPane && filesOpen}
                                className="h-full"
                                pane={
                                    filesOpen ? (
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
        </AppShell>
    )
}
