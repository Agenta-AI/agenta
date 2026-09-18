/**
 * SessionFilesPane — the chat host's DOCKED Files pane: this conversation's open + quick-look +
 * staged atoms → the shared {@link DriveExplorer}, rendered inline in a resizable right-side
 * splitter pane (tree RIGHT, content LEFT). The close is row 1's "»" or the host's own
 * session-bar toggle (`closeControl`).
 *
 * Every opener (tiles, in-thread cards, rail rows, chat links, the config pane's Files section,
 * the agent overview) sets the same per-session atoms; `useSessionFilesPane` folds them into the
 * split's open flag.
 */
import {useCallback, useEffect, useMemo, useRef} from "react"

import {type DriveId} from "@agenta/entities/drive"
import {useSessionDriveSummary} from "@agenta/entities/drive"
import {playgroundInspectorEnabledAtom} from "@agenta/shared/state"
import {atom, useAtom, useAtomValue} from "jotai"
import {atomFamily} from "jotai-family"
import dynamic from "next/dynamic"

import {DriveExplorerSkeleton} from "./index"
import {useDriveArtifactId} from "./index"
import {useDriveGeneration} from "./index"
import {driveQuickLookAtomFamily} from "./index"
import {filesDrawerStagedAtomFamily, resolveQuickLookPath} from "./index"

// Heavy body — loaded lazily on first open (the split unmounts the pane while collapsed).
const DriveExplorer = dynamic(() => import("./DriveExplorer").then((m) => m.DriveExplorer), {
    ssr: false,
    loading: () => <DriveExplorerSkeleton withChrome mirrored showTree={false} />,
})

// The pane's open flag belongs to the chat PANEL (keyed by the app scope), not to one session:
// adding or switching tabs must not snap an open pane shut. Quick-look + staged drops stay
// per-session (they are selection state) and latch this flag open via the effect below.
export const sessionFilesPaneOpenAtomFamily = atomFamily((_scope: string) => atom(false))

/** The pane's open/close/toggle — one hook so the splitter host, the session bar toggle, and
 * every opener (config Files section, context rail, inspector) drive the SAME state. */
/** `scope` is the HOST's to resolve (the desktop passes its chat scope key) — the package must
 * not reach into the app's chat slice for it. */
export const useSessionFilesPane = (scope: string, sessionId: string) => {
    const [scopeOpen, setScopeOpen] = useAtom(sessionFilesPaneOpenAtomFamily(scope))
    const [quickLook, setQuickLook] = useAtom(driveQuickLookAtomFamily(sessionId))
    const [staged, setStaged] = useAtom(filesDrawerStagedAtomFamily(sessionId))
    // A per-session opener (file card, chat link, staged drop) latches the panel-level flag, so
    // the pane it opened survives a later session switch/add.
    const sessionRequested = quickLook != null || staged.length > 0
    useEffect(() => {
        if (sessionRequested) setScopeOpen(true)
    }, [sessionRequested, setScopeOpen])
    const open = scopeOpen || sessionRequested
    const close = useCallback(() => {
        setScopeOpen(false)
        setQuickLook(null)
        setStaged([])
    }, [setScopeOpen, setQuickLook, setStaged])
    const openPane = useCallback(() => setScopeOpen(true), [setScopeOpen])
    const toggle = useCallback(() => (open ? close() : openPane()), [open, close, openPane])
    return {open, close, openPane, toggle}
}

export function SessionFilesPane({
    scope,
    sessionId,
    closeControl = "collapse",
}: {
    scope: string
    sessionId: string
    /** Who closes the pane: row 1's "»" (the desktop), the host's own session-bar toggle
     * (`"none"` — `/m`, where the panel icon shows the open state and flips it), or a leading
     * "»" (`"back"` — a phone, where the pane has the screen and that bar is off it). */
    closeControl?: "collapse" | "back" | "none"
}) {
    const {open, close} = useSessionFilesPane(scope, sessionId)
    const [quickLook] = useAtom(driveQuickLookAtomFamily(sessionId))
    const [staged, setStaged] = useAtom(filesDrawerStagedAtomFamily(sessionId))
    const artifactId = useDriveArtifactId()

    // Summary drive (cheap) — DriveExplorer lazy-loads the rest. Gated on open (the agent-mount query
    // keys on artifactId, so a live id while collapsed would fetch the agent drive before it's shown).
    const drive = useSessionDriveSummary(
        open ? sessionId : "",
        open ? (artifactId ?? undefined) : undefined,
    )

    // Every opener writes a fresh request, so the same path clicked twice still re-opens.
    const requestSeq = useRef(0)
    const initialPathSeq = useMemo(() => (requestSeq.current += 1), [quickLook])
    // A quick look resolves a tail to the presented path; an empty path is the root itself.
    const initialPath = useMemo(
        () =>
            quickLook
                ? quickLook.path
                    ? resolveQuickLookPath(drive.recents, quickLook.path)
                    : ""
                : null,
        [quickLook, drive.recents],
    )

    // Raw ids are a DEBUGGING affordance (wiring an SDK call, filing a bug), so they ride the same
    // switch as the rest of the inspection surface — off, the overflow menu is just "Download all".
    const inspectorEnabled = useAtomValue(playgroundInspectorEnabledAtom)
    const driveIds = useMemo(
        () =>
            !inspectorEnabled
                ? []
                : ([
                      drive.mount?.id
                          ? {key: "mount", label: "Drive ID", value: drive.mount.id}
                          : null,
                      sessionId ? {key: "owner", label: "Session ID", value: sessionId} : null,
                  ].filter(Boolean) as DriveId[]),
        [inspectorEnabled, drive.mount?.id, sessionId],
    )

    const driveGeneration = useDriveGeneration(drive.mount?.id)

    return (
        <div className="flex h-full min-h-0 w-full flex-col">
            <DriveExplorer
                key={driveGeneration}
                drive={drive}
                scope="session"
                initialPath={initialPath}
                initialPathSeq={initialPathSeq}
                chrome
                onClose={closeControl === "none" ? undefined : close}
                closeVariant={closeControl === "back" ? "back" : "collapse"}
                mirrored
                // The rail starts closed: the grid + breadcrumb browse on their own, and the row-1
                // toggle (or a search, which needs the rows) brings it in; the choice then sticks.
                initialShowTree={false}
                treePersistKey="session"
                driveIds={driveIds}
                stagedFiles={staged}
                onStagedChange={setStaged}
            />
        </div>
    )
}
