import {useState, type ReactNode} from "react"

import {chatPanelMaximizedAtom} from "@agenta/chat/state"
import {SplitPane} from "@agenta/ui/ui"
import {useAtomValue} from "jotai"
import dynamic from "next/dynamic"

import {useMediaQuery} from "@/lib/useMediaQuery"

import {AppShell} from "../nav/AppShell"

import {SessionsPane} from "./SessionsPane"
import {SessionTopBar} from "./SessionTopBar"

/**
 * Tailwind's `md` (48rem), as a query — the frame is chosen in JS, so the breakpoint has to be
 * stated once here instead of living in a `md:` class.
 */
const WIDE_FRAME_QUERY = "(min-width: 48rem)"

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
 * modes never drops a streaming turn. Crossing the breakpoint itself DOES remount it (the two
 * frames are different trees); that is a viewport resize across 48rem, not something the UI does
 * to itself, and the engine rehydrates the transcript from records afterwards.
 *
 * Pane geometry is the desktop's: 440 default and max, 300 min, controlled px so a drag persists
 * for the mount. Below `md` there is no room for two panes, so the frame drops to one and the mode
 * picks which.
 *
 * The two frames are chosen in JS and exactly ONE is rendered. Expressing the choice as
 * `md:hidden` / `hidden md:block` would leave both in the tree — two `LiveConversation`s on one
 * session (two watches, two record polls, two streaming states) and two config/session panes
 * running their queries twice.
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
    // Narrow is the server/first-paint answer: this is the mobile app, and it is the frame that
    // costs least to throw away if the viewport turns out to be wide (no SplitPane, no second
    // pane). It corrects on mount, before anything can be streaming.
    const wideFrame = useMediaQuery(WIDE_FRAME_QUERY)
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

                {wideFrame ? (
                    <div className="min-h-0 min-w-0 flex-1">
                        <SplitPane
                            paneSide="start"
                            paneSize={paneSize}
                            paneMin={300}
                            paneMax={440}
                            fillMin={420}
                            // Controlled width: the drag must write through per tick, or the pane
                            // only snaps at pointer-up.
                            onResize={(size) => setPaneSize(size)}
                            onResizeEnd={(size) => setPaneSize(size)}
                            className="h-full"
                            pane={pane}
                            fill={<div className="ag-canvas h-full">{chat}</div>}
                        />
                    </div>
                ) : (
                    /* Below md: one pane, chosen by the mode — the split's 300px pane + 420px fill
                       minimums do not fit, and forcing them would leave the conversation
                       unreadable. Both children stay mounted and only their `display` flips, so a
                       mode toggle never unmounts the conversation. */
                    <div className="flex min-h-0 min-w-0 flex-1">
                        <div className={showBuild ? "min-w-0 flex-1" : "hidden"}>{pane}</div>
                        <div className={`ag-canvas ${showBuild ? "hidden" : "min-w-0 flex-1"}`}>
                            {chat}
                        </div>
                    </div>
                )}
            </div>
        </AppShell>
    )
}
