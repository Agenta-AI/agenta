import {useState} from "react"

import type {ConfigViewMode} from "@agenta/entity-ui/drill-in"
import {PlaygroundConfigPanel} from "@agenta/playground-ui/panels/config"
import dynamic from "next/dynamic"

import {DrillInBridgeProvider} from "../chat/DrillInBridgeProvider"

import {PlaygroundHeader} from "./PlaygroundHeader"
import {PlaygroundSplit} from "./PlaygroundSplit"
import {RunPanePlaceholder} from "./RunPanePlaceholder"

// The tools section of a prompt opens the tool catalog; it loads when first opened.
const CatalogDrawer = dynamic(
    () => import("@agenta/entity-ui/gatewayTool").then((m) => m.CatalogDrawer),
    {ssr: false},
)

/**
 * The loaded playground: the top bar, then the selected revision's config beside its runs.
 * A commit made in the config calls `onRevisionCommitted` with the new revision.
 */
export const PlaygroundWorkspace = ({
    workspaceId,
    projectId,
    appName,
    revisionId,
    onRevisionCommitted,
}: {
    workspaceId: string
    projectId: string
    appName: string | null
    revisionId: string
    onRevisionCommitted: (revisionId: string) => void
}) => {
    // Form, JSON or YAML: kept while the page is open, as in the old playground.
    const [viewMode, setViewMode] = useState<ConfigViewMode>("form")

    return (
        <div className="flex h-full min-h-0 flex-col bg-background">
            <PlaygroundHeader workspaceId={workspaceId} projectId={projectId} appName={appName} />
            <PlaygroundSplit
                config={
                    <DrillInBridgeProvider
                        projectId={projectId}
                        onWorkflowRevisionCommitted={onRevisionCommitted}
                    >
                        <PlaygroundConfigPanel
                            revisionId={revisionId}
                            viewMode={viewMode}
                            onViewModeChange={setViewMode}
                        />
                    </DrillInBridgeProvider>
                }
                runs={<RunPanePlaceholder />}
            />
            <CatalogDrawer />
        </div>
    )
}
