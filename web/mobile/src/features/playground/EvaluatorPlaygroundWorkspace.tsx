import {useState} from "react"

import {workflowMolecule} from "@agenta/entities/workflow"
import type {ConfigViewMode} from "@agenta/entity-ui/drill-in"
import type {WorkflowRevisionSelectionResult} from "@agenta/entity-ui/selection"
import {playgroundController} from "@agenta/playground"
import {ConfigPanel, RevisionSwitcher} from "@agenta/playground-ui/panels/config"
import {ChainTokenPathProvider, type RunOnMode} from "@agenta/playground-ui/panels/evaluator"
import {useAtomValue} from "jotai"

import {DrillInBridgeProvider} from "../chat/DrillInBridgeProvider"

import {EvaluatorPlaygroundHeader} from "./EvaluatorPlaygroundHeader"
import {LoadPresetAction} from "./LoadPresetAction"
import {PlaygroundFocusDrawerHost} from "./PlaygroundFocusDrawerHost"
import {PlaygroundRunPane} from "./PlaygroundRunPane"
import {PlaygroundSplit} from "./PlaygroundSplit"
import {RevisionActions} from "./RevisionActions"
import {SelectAppEmpty} from "./states/SelectAppEmpty"
import {useSwitchRevision} from "./useSwitchRevision"

/**
 * The loaded evaluator playground: the top bar, then the evaluator's config beside the runs. The
 * runs start at the first revision: the connected app, or the evaluator when it runs alone.
 */
export const EvaluatorPlaygroundWorkspace = ({
    workspaceId,
    projectId,
    evaluatorName,
    evaluatorRevisionId,
    primaryRevisionId,
    appRevisionId,
    runOn,
    onRunOnChange,
    onConnectApp,
    onDisconnectApp,
    onWorkflowRevisionCommitted,
}: {
    workspaceId: string
    projectId: string
    evaluatorName: string | null
    evaluatorRevisionId: string
    primaryRevisionId: string
    appRevisionId: string | null
    runOn: RunOnMode
    onRunOnChange: (mode: RunOnMode) => void
    onConnectApp: (app: WorkflowRevisionSelectionResult) => void
    onDisconnectApp: () => void
    onWorkflowRevisionCommitted: (revisionId: string) => void
}) => {
    const [viewMode, setViewMode] = useState<ConfigViewMode>("form")
    const {switchTo, modal: switchDialog} = useSwitchRevision(evaluatorRevisionId)
    const evaluator = useAtomValue(workflowMolecule.selectors.data(evaluatorRevisionId))
    const nodes = useAtomValue(playgroundController.selectors.nodes())
    const appLabel = appRevisionId ? (nodes[0]?.label ?? null) : null
    const evaluatorId = evaluator?.workflow_id ?? ""

    return (
        <div className="flex h-full min-h-0 flex-col bg-background">
            <EvaluatorPlaygroundHeader
                workspaceId={workspaceId}
                projectId={projectId}
                evaluatorName={evaluatorName}
                runOn={runOn}
                appLabel={appLabel}
                onRunOnChange={onRunOnChange}
                onConnectApp={onConnectApp}
                onDisconnectApp={onDisconnectApp}
            />
            <PlaygroundSplit
                config={
                    <DrillInBridgeProvider
                        projectId={projectId}
                        onWorkflowRevisionCommitted={onWorkflowRevisionCommitted}
                    >
                        <ChainTokenPathProvider entityId={evaluatorRevisionId}>
                            <ConfigPanel
                                revisionId={evaluatorRevisionId}
                                viewMode={viewMode}
                                onViewModeChange={setViewMode}
                                switcher={
                                    <RevisionSwitcher
                                        appId={evaluatorId}
                                        revisionId={evaluatorRevisionId}
                                        onSwitch={switchTo}
                                    />
                                }
                                actions={
                                    <>
                                        <LoadPresetAction revisionId={evaluatorRevisionId} />
                                        <RevisionActions
                                            evaluator
                                            workspaceId={workspaceId}
                                            projectId={projectId}
                                            appId={evaluatorId}
                                            revisionId={evaluatorRevisionId}
                                            readOnly={false}
                                            onCommitted={onWorkflowRevisionCommitted}
                                        />
                                    </>
                                }
                            />
                        </ChainTokenPathProvider>
                    </DrillInBridgeProvider>
                }
                runs={
                    runOn === "app" && !appRevisionId ? (
                        <SelectAppEmpty onSelect={onConnectApp} />
                    ) : (
                        <PlaygroundRunPane revisionId={primaryRevisionId} />
                    )
                }
            />
            {switchDialog}
            <PlaygroundFocusDrawerHost />
        </div>
    )
}
