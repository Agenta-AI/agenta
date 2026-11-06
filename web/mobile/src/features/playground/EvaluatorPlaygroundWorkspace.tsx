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
import {EvaluatorTypeTag} from "./EvaluatorTypeTag"
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
    const switchTo = useSwitchRevision()
    const evaluator = useAtomValue(workflowMolecule.selectors.data(evaluatorRevisionId))
    const nodes = useAtomValue(playgroundController.selectors.nodes())
    const appName = useAtomValue(workflowMolecule.selectors.artifactName(appRevisionId ?? ""))
    const appData = useAtomValue(workflowMolecule.selectors.data(appRevisionId ?? ""))
    // A link restores the app with its id as the label: name it from its data instead.
    const nodeLabel = nodes[0]?.label
    const appLabel = !appRevisionId
        ? null
        : nodeLabel && nodeLabel !== appRevisionId
          ? nodeLabel
          : appName
            ? `${appName}${appData?.version != null ? ` v${appData.version}` : ""}`
            : null
    const evaluatorId = evaluator?.workflow_id ?? ""

    return (
        <div data-playground className="flex h-full min-h-0 flex-col bg-background">
            <EvaluatorPlaygroundHeader
                workspaceId={workspaceId}
                projectId={projectId}
                evaluatorName={evaluatorName}
                typeTag={<EvaluatorTypeTag revisionId={evaluatorRevisionId} />}
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
                                        onSwitch={(id) => switchTo(evaluatorRevisionId, id)}
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
            <PlaygroundFocusDrawerHost />
        </div>
    )
}
