import {useState} from "react"

import type {ConfigViewMode} from "@agenta/entity-ui/drill-in"
import {ConfigPanel, RevisionSwitcher} from "@agenta/playground-ui/panels/config"
import dynamic from "next/dynamic"

import {DrillInBridgeProvider} from "../chat/DrillInBridgeProvider"

import {PlaygroundFocusDrawerHost} from "./PlaygroundFocusDrawerHost"
import {PlaygroundHeader} from "./PlaygroundHeader"
import {PlaygroundRunPane} from "./PlaygroundRunPane"
import {PlaygroundSplit} from "./PlaygroundSplit"
import {RevisionActions} from "./RevisionActions"
import {useSwitchRevision} from "./useSwitchRevision"

// The tools section of a prompt opens the tool catalog; it loads when first opened.
const CatalogDrawer = dynamic(
    () => import("@agenta/entity-ui/gatewayTool").then((m) => m.CatalogDrawer),
    {ssr: false},
)
// The wand on a prompt section opens it; it loads when first opened.
const RefinePromptDialog = dynamic(
    () => import("@agenta/playground-ui/panels/refine").then((m) => m.RefinePromptDialog),
    {ssr: false},
)

/**
 * The loaded playground: the top bar, then the selected revision's config beside its runs.
 * A commit made in the config calls `onWorkflowRevisionCommitted` with the new revision.
 */
export const PlaygroundWorkspace = ({
    workspaceId,
    projectId,
    appId,
    appName,
    revisionId,
    onWorkflowRevisionCommitted,
}: {
    workspaceId: string
    projectId: string
    appId: string
    appName: string | null
    revisionId: string
    onWorkflowRevisionCommitted: (revisionId: string) => void
}) => {
    // Form, JSON or YAML: kept while the page is open, as in the old playground.
    const [viewMode, setViewMode] = useState<ConfigViewMode>("form")
    const {switchTo, modal: switchDialog} = useSwitchRevision(revisionId)
    // A revision the server has deleted is read only from that moment. It stays on screen until
    // the lists load again and the page takes it out, and an edit made then would be lost.
    const [deletedId, setDeletedId] = useState<string | null>(null)
    const readOnly = deletedId === revisionId
    const [refineKey, setRefineKey] = useState<string | null>(null)

    return (
        <div className="flex h-full min-h-0 flex-col bg-background">
            <PlaygroundHeader workspaceId={workspaceId} projectId={projectId} appName={appName} />
            <PlaygroundSplit
                config={
                    <DrillInBridgeProvider
                        projectId={projectId}
                        onWorkflowRevisionCommitted={onWorkflowRevisionCommitted}
                    >
                        <ConfigPanel
                            revisionId={revisionId}
                            readOnly={readOnly}
                            viewMode={viewMode}
                            onViewModeChange={setViewMode}
                            onRefinePrompt={setRefineKey}
                            switcher={
                                <RevisionSwitcher
                                    appId={appId}
                                    revisionId={revisionId}
                                    onSwitch={switchTo}
                                />
                            }
                            actions={
                                <RevisionActions
                                    workspaceId={workspaceId}
                                    projectId={projectId}
                                    appId={appId}
                                    revisionId={revisionId}
                                    readOnly={readOnly}
                                    onCommitted={onWorkflowRevisionCommitted}
                                    onArchived={setDeletedId}
                                />
                            }
                        />
                    </DrillInBridgeProvider>
                }
                runs={<PlaygroundRunPane revisionId={revisionId} />}
            />
            <CatalogDrawer />
            {refineKey ? (
                <RefinePromptDialog
                    key={`${revisionId}:${refineKey}`}
                    revisionId={revisionId}
                    promptKey={refineKey}
                    onClose={() => setRefineKey(null)}
                />
            ) : null}
            {switchDialog}
            <PlaygroundFocusDrawerHost />
        </div>
    )
}
