/**
 * SessionFilesPane — the chat host's DOCKED replacement for {@link SessionFilesDrawer}: the same
 * per-session glue (this conversation's open + quick-look + staged atoms → the shared
 * {@link DriveExplorer}), but rendered inline in a resizable right-side splitter pane instead of an
 * overlay drawer. The pane mirrors the explorer (tree RIGHT, content LEFT) and swaps the drawer's
 * "×" for a "»" collapse. The overlay drawer stays in use for the non-chat hosts (config panel,
 * agent overview).
 *
 * Openers are unchanged: tiles, in-thread cards, rail rows, and chat links all set the same
 * per-session atoms; `useSessionFilesPane` folds them into the split's open flag.
 */
import {useCallback, useEffect, useMemo} from "react"

import {atom, useAtom, useAtomValue} from "jotai"
import {atomFamily} from "jotai/utils"
import dynamic from "next/dynamic"

import {useChatScopeKey} from "@/oss/components/AgentChatSlice/state/scope"
import {playgroundInspectorEnabledAtom} from "@/oss/state/settings/featureFlags"

import {type DriveId} from "./DriveExplorer"
import {DriveExplorerSkeleton} from "./DriveExplorerSkeleton"
import {useDriveArtifactId} from "./driveSessionContext"
import {useDriveGeneration} from "./FilesDrawer"
import {driveQuickLookAtomFamily} from "./quickLook"
import {filesDrawerStagedAtomFamily, matchesTail} from "./SessionFilesDrawer"
import {useSessionDriveSummary} from "./useSessionDrive"

// Heavy body — loaded lazily on first open (the split unmounts the pane while collapsed).
const DriveExplorer = dynamic(() => import("./DriveExplorer").then((m) => m.DriveExplorer), {
    ssr: false,
    loading: () => <DriveExplorerSkeleton />,
})

// The pane's open flag belongs to the chat PANEL (keyed by the app scope), not to one session:
// adding or switching tabs must not snap an open pane shut. Quick-look + staged drops stay
// per-session (they are selection state) and latch this flag open via the effect below.
const filesPaneOpenAtomFamily = atomFamily((_scope: string) => atom(false))

/** The pane's open/close/toggle — one hook so the splitter host, the session bar toggle, and
 * every opener (config Files section, context rail, inspector) drive the SAME state. */
export const useSessionFilesPane = (sessionId: string) => {
    const scope = useChatScopeKey()
    const [scopeOpen, setScopeOpen] = useAtom(filesPaneOpenAtomFamily(scope))
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

export function SessionFilesPane({sessionId}: {sessionId: string}) {
    const {open, close} = useSessionFilesPane(sessionId)
    const [quickLook] = useAtom(driveQuickLookAtomFamily(sessionId))
    const [staged, setStaged] = useAtom(filesDrawerStagedAtomFamily(sessionId))
    const artifactId = useDriveArtifactId()

    // Summary drive (cheap) — DriveExplorer lazy-loads the rest. Gated on open (the agent-mount query
    // keys on artifactId, so a live id while collapsed would fetch the agent drive before it's shown).
    const drive = useSessionDriveSummary(
        open ? sessionId : "",
        open ? (artifactId ?? undefined) : undefined,
    )

    // Resolve the quick-look path (possibly a tail) to the presented drive path the tree selects by.
    const initialPath = useMemo(() => {
        if (!quickLook) return null
        const hit = drive.recents.find((f) => matchesTail(f.path, quickLook.path))
        return hit?.path ?? quickLook.path
    }, [quickLook, drive.recents])

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
                onClose={close}
                closeVariant="collapse"
                mirrored
                // A quick look flagged hideTree (a config file row) opens on the file alone.
                initialShowTree={!quickLook?.hideTree}
                driveIds={driveIds}
                stagedFiles={staged}
                onStagedChange={setStaged}
            />
        </div>
    )
}
