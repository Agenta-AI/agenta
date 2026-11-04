import {useCallback, useState} from "react"

import type {ConfigViewMode} from "@agenta/entity-ui/drill-in"
import {CompareButton} from "@agenta/playground-ui/panels/config"
import dynamic from "next/dynamic"

import {DrillInBridgeProvider} from "../chat/DrillInBridgeProvider"

import {PlaygroundFocusDrawerHost} from "./PlaygroundFocusDrawerHost"
import {PlaygroundHeader} from "./PlaygroundHeader"
import {PlaygroundRunPane} from "./PlaygroundRunPane"
import {PlaygroundSplit} from "./PlaygroundSplit"
import {RevisionConfig} from "./RevisionConfig"
import {useSwitchRevision} from "./useSwitchRevision"

// The tools section of a prompt opens the tool catalog; it loads when first opened.
const CatalogDrawer = dynamic(
    () => import("@agenta/entity-ui/gatewayTool").then((m) => m.CatalogDrawer),
    {ssr: false},
)
// The compare view loads the first time the page shows two revisions.
const PlaygroundCompare = dynamic(
    () => import("./PlaygroundCompare").then((m) => m.PlaygroundCompare),
    {ssr: false},
)
// The wand on a prompt section opens it; it loads when first opened.
const RefinePromptDialog = dynamic(
    () => import("@agenta/playground-ui/panels/refine").then((m) => m.RefinePromptDialog),
    {ssr: false},
)

/**
 * The loaded playground: the top bar, then the selected revision's config beside its runs, or,
 * with two or more revisions, the compare view. A commit in a revision's config shows the new
 * revision in that revision's place.
 */
export const PlaygroundWorkspace = ({
    workspaceId,
    projectId,
    appId,
    appName,
    revisionIds,
    onWorkflowRevisionCommitted,
}: {
    workspaceId: string
    projectId: string
    appId: string
    appName: string | null
    /** The revisions on screen, in order. Never empty. */
    revisionIds: string[]
    onWorkflowRevisionCommitted: (fromRevisionId: string, toRevisionId: string) => void
}) => {
    // Form, JSON or YAML: kept while the page is open, as in the old playground.
    const [viewMode, setViewMode] = useState<ConfigViewMode>("form")
    const {switchTo, modal: switchDialog} = useSwitchRevision()
    // A revision the server has deleted is read only from that moment. It stays on screen until
    // the lists load again and the page takes it out, and an edit made then would be lost.
    const [deletedId, setDeletedId] = useState<string | null>(null)
    const [refine, setRefine] = useState<{revisionId: string; promptKey: string} | null>(null)
    const primaryId = revisionIds[0]
    // Only an agent's model settings commit from inside the editor; a prompt commits from its bar.
    const followEditorCommit = useCallback(
        (revisionId: string) => onWorkflowRevisionCommitted(primaryId, revisionId),
        [onWorkflowRevisionCommitted, primaryId],
    )
    const column = {
        workspaceId,
        projectId,
        appId,
        viewMode,
        onViewModeChange: setViewMode,
        onSwitch: switchTo,
        onCommitted: onWorkflowRevisionCommitted,
        onArchived: setDeletedId,
        onRefinePrompt: (revisionId: string, promptKey: string) =>
            setRefine({revisionId, promptKey}),
    }

    return (
        <div className="flex h-full min-h-0 flex-col bg-background">
            <PlaygroundHeader
                workspaceId={workspaceId}
                projectId={projectId}
                appName={appName}
                actions={<CompareButton appId={appId} />}
            />
            <DrillInBridgeProvider
                projectId={projectId}
                onWorkflowRevisionCommitted={followEditorCommit}
            >
                {revisionIds.length > 1 ? (
                    <PlaygroundCompare
                        revisionIds={revisionIds}
                        deletedId={deletedId}
                        column={column}
                    />
                ) : (
                    <PlaygroundSplit
                        config={
                            <RevisionConfig
                                {...column}
                                revisionId={primaryId}
                                readOnly={deletedId === primaryId}
                            />
                        }
                        runs={<PlaygroundRunPane revisionId={primaryId} />}
                    />
                )}
            </DrillInBridgeProvider>
            <CatalogDrawer />
            {refine ? (
                <RefinePromptDialog
                    key={`${refine.revisionId}:${refine.promptKey}`}
                    revisionId={refine.revisionId}
                    promptKey={refine.promptKey}
                    onClose={() => setRefine(null)}
                />
            ) : null}
            {switchDialog}
            <PlaygroundFocusDrawerHost />
        </div>
    )
}
