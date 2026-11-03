import {useState} from "react"

import type {ConfigViewMode} from "@agenta/entity-ui/drill-in"
import {ConfigPanel, RevisionSwitcher} from "@agenta/playground-ui/panels/config"
import dynamic from "next/dynamic"

import {DrillInBridgeProvider} from "../chat/DrillInBridgeProvider"

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
                            viewMode={viewMode}
                            onViewModeChange={setViewMode}
                            switcher={
                                <RevisionSwitcher
                                    appId={appId}
                                    revisionId={revisionId}
                                    onSwitch={switchTo}
                                />
                            }
                            actions={
                                <RevisionActions
                                    projectId={projectId}
                                    appId={appId}
                                    revisionId={revisionId}
                                    onCommitted={onWorkflowRevisionCommitted}
                                />
                            }
                        />
                    </DrillInBridgeProvider>
                }
                runs={<PlaygroundRunPane revisionId={revisionId} />}
            />
            <CatalogDrawer />
            {switchDialog}
        </div>
    )
}
