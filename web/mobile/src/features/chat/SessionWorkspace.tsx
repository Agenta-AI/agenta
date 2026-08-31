import {useEffect, useState, type ReactNode} from "react"

import {
    chatPanelMaximizedAtom,
    configPanelCollapsedPreferenceAtom,
    phoneViewportAtom,
    resolveConfigPanelCollapsed,
} from "@agenta/chat/state"
import {DriveSessionProvider, SessionFilesPane, useSessionFilesPane} from "@agenta/entity-ui/drive"
import {registerAgentAutoCommitHandler} from "@agenta/playground/state"
import {useMediaQuery} from "@agenta/ui/hooks"
import {SplitPane, usePaneSlide} from "@agenta/ui/ui"
import {useAtomValue, useSetAtom} from "jotai"
import dynamic from "next/dynamic"

import {AppShell} from "../nav/AppShell"

import {CollapsedConfigRail} from "./CollapsedConfigRail"
import {selectedRevisionAtomFamily} from "./selectedRevision"
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
    hideSessionTabs = false,
    collapseConfigByDefault = false,
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
    /**
     * Hide the session tab strip. Before the agent is created there is exactly one draft session
     * and no history, so the strip is a rail with nothing to switch between.
     */
    hideSessionTabs?: boolean
    /**
     * Start with the config pane collapsed, the way a phone already does. First run leads with the
     * question and the composer; the configuration is one `»` away rather than half the screen
     * before there is anything to configure.
     *
     * Only the DEFAULT — a stored preference still wins in both directions.
     */
    collapseConfigByDefault?: boolean
}) => {
    const base = `/w/${workspaceId}/p/${projectId}`
    const chatMaximized = useAtomValue(chatPanelMaximizedAtom)
    // Collapsing the config panel is separate from the Build/Chat mode: the desktop keeps you in
    // Build with the panel out of the way, and the top bar's "»" brings it back.
    // Follow the revision an auto-commit produced. Pin it rather than unpinning: unpinning falls
    // back to the latest-revision query, which is stale for a beat, so a commit made FROM an
    // older revision would land the pane on whatever that query last cached. The desktop gets
    // this switch from the workflow bridge's onNewRevision; mobile registers none.
    //
    // It lives HERE and not in `ConfigPane` because a commit can land while the config pane is
    // off screen — the pane is swapped out on a phone whenever the conversation has the width.
    const pinRevision = useSetAtom(selectedRevisionAtomFamily(sessionId))
    useEffect(
        () =>
            registerAgentAutoCommitHandler(
                `session-workspace:${sessionId}`,
                (revisionId, newRevisionId) => {
                    if (revisionId === entityId) pinRevision(newRevisionId)
                },
            ),
        [entityId, pinRevision, sessionId],
    )

    // Resolved from the parts rather than read off `configPanelCollapsedAtom`: that atom answers
    // for a device, and this surface gets to answer too. A stored preference still beats both.
    const configCollapsed = resolveConfigPanelCollapsed(
        useAtomValue(configPanelCollapsedPreferenceAtom),
        useAtomValue(phoneViewportAtom),
        collapseConfigByDefault,
    )
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
            <ConfigPane entityId={entityId} sessionId={sessionId} />
        ) : (
            <SessionsPane agentId={agentId} base={base} activeSessionId={sessionId} />
        )

    const workspace = (
        <>
            {/* Drive surfaces need the AGENT here, not just the session: without it the per-agent
                mount query stays disabled and `agent-files/…` falls back to the cwd mount, 404s,
                and the row opens nothing (#6270). Desktop mounts this; /m did not. */}
            <DriveSessionProvider sessionId={sessionId} artifactId={agentId ?? null}>
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
                                        <div className="ag-canvas flex h-full min-h-0">
                                            {/* Where the collapsed pane went, on a surface with no
                                                tab rail to carry its reveal — the empty column
                                                becomes the pane's own edge instead of dead canvas.
                                                Needs the width for a vertical label, so `md` up. */}
                                            {hideSessionTabs &&
                                            twoPane &&
                                            !chatMaximized &&
                                            configCollapsed ? (
                                                <CollapsedConfigRail />
                                            ) : null}
                                            <div className="flex min-h-0 min-w-0 flex-1 flex-col">
                                                {/* The rail belongs to the WORKSPACE, not to one
                                                    conversation. It used to live inside the
                                                    conversation's pinned header, so keying that per
                                                    session remounted the rail too and reset its
                                                    scroll to 0. Up here it simply stays put. */}
                                                {hideSessionTabs ? null : (
                                                    <SessionTabs
                                                        sessionId={sessionId}
                                                        projectId={projectId}
                                                        workspaceId={workspaceId}
                                                        agentId={agentId}
                                                    />
                                                )}
                                                <div className="min-h-0 flex-1">{chat}</div>
                                            </div>
                                        </div>
                                    }
                                />
                            }
                        />
                    </div>
                </div>
            </DriveSessionProvider>
        </>
    )

    if (bare) return workspace
    return (
        <AppShell workspaceId={workspaceId} projectId={projectId}>
            {workspace}
        </AppShell>
    )
}
