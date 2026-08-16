import {useState, type ReactNode} from "react"

import {chatPanelMaximizedAtom} from "@agenta/chat/state"
import {SplitPane} from "@agenta/ui/ui"
import {useAtomValue} from "jotai"
import dynamic from "next/dynamic"

import {AppShell} from "../nav/AppShell"

import {SessionsPane} from "./SessionsPane"
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
 * The conversation is ALWAYS mounted — the mode only decides what sits beside it — so switching
 * modes never drops a streaming turn.
 *
 * Pane geometry is the desktop's: 440 default and max, 300 min, controlled px so a drag persists
 * for the mount. Below `lg` there is no room for two panes, so the frame drops to one and the mode
 * picks which.
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
    const showBuild = !chatMaximized && Boolean(entityId)
    // Controlled px, as on the desktop: the dragged width persists for the mount; 440 is the
    // config panel's cap and its default.
    const [paneSize, setPaneSize] = useState(440)

    // The same surface treatment the desktop layout applies: the workspace is a recessed ground,
    // the config panel is raised above it, the conversation is the recessed canvas. Without these
    // the shared panels render flat — identical components, missing surface ladder.
    const pane =
        showBuild && entityId ? (
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

                {/* Below md: one pane, chosen by the mode — the split's 300px pane + 420px fill
                    minimums do not fit, and forcing them would leave the conversation unreadable. */}
                <div className="flex min-h-0 min-w-0 flex-1 md:hidden">
                    <div className={showBuild ? "min-w-0 flex-1" : "hidden"}>{pane}</div>
                    <div className={`ag-canvas ${showBuild ? "hidden" : "min-w-0 flex-1"}`}>
                        {chat}
                    </div>
                </div>

                <div className="hidden min-h-0 min-w-0 flex-1 md:block">
                    <SplitPane
                        paneSide="start"
                        paneSize={paneSize}
                        paneMin={300}
                        paneMax={440}
                        fillMin={420}
                        // Controlled width: the drag must write through per tick, or the pane only
                        // snaps at pointer-up.
                        onResize={(size) => setPaneSize(size)}
                        onResizeEnd={(size) => setPaneSize(size)}
                        className="h-full"
                        pane={pane}
                        fill={<div className="ag-canvas h-full">{chat}</div>}
                    />
                </div>
            </div>
        </AppShell>
    )
}
