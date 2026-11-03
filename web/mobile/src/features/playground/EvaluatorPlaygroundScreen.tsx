import {useCallback, useEffect, useState} from "react"

import {workflowMolecule} from "@agenta/entities/workflow"
import type {WorkflowRevisionSelectionResult} from "@agenta/entity-ui/selection"
import {evaluatorChainController, playgroundController} from "@agenta/playground"
import type {RunOnMode} from "@agenta/playground-ui/panels/evaluator"
import {preloadEditorPlugins} from "@agenta/ui/editor"
import {useAtomValue, useStore} from "jotai"

import {PageNotFound} from "@/components/PageNotFound"
import {PageTitle} from "@/components/PageTitle"

import {EvaluatorPlaygroundWorkspace} from "./EvaluatorPlaygroundWorkspace"
import {PlaygroundLoadError} from "./states/PlaygroundLoadError"
import {PlaygroundSkeleton} from "./states/PlaygroundSkeleton"
import {useEvaluatorPlaygroundSelection} from "./useEvaluatorPlaygroundSelection"
import {usePlaygroundLeaveGuard} from "./usePlaygroundLeaveGuard"

/**
 * The evaluator playground: one evaluator revision's config beside its runs. It runs on test
 * cases the reader gives it, or on the output of an app the reader connects.
 */
export const EvaluatorPlaygroundScreen = ({
    workspaceId,
    projectId,
}: {
    workspaceId: string
    projectId: string
}) => {
    const store = useStore()
    const selection = useEvaluatorPlaygroundSelection()
    const leaveDialog = usePlaygroundLeaveGuard()
    const {status, evaluatorRevisionId, primaryRevisionId, appRevisionId} = selection
    const name = useAtomValue(workflowMolecule.selectors.artifactName(evaluatorRevisionId ?? ""))
    // A connected app means "Run on an app output", whatever was picked before.
    const [picked, setPicked] = useState<RunOnMode>("app")
    const runOn: RunOnMode = appRevisionId ? "app" : picked

    useEffect(() => {
        preloadEditorPlugins()
    }, [])

    const connectApp = useCallback(
        (app: WorkflowRevisionSelectionResult) => {
            if (!evaluatorRevisionId) return
            store.set(evaluatorChainController.actions.connectAppToEvaluator, {
                appRevisionId: app.id,
                appLabel: app.label,
                evaluatorRevisionId,
                evaluatorLabel: name ?? "Evaluator",
            })
        },
        [evaluatorRevisionId, name, store],
    )
    const disconnectApp = useCallback(
        () => store.set(evaluatorChainController.actions.disconnectAppFromEvaluator),
        [store],
    )
    const pickRunOn = useCallback(
        (mode: RunOnMode) => {
            // Test cases feed the evaluator directly: the app goes.
            if (mode === "data") disconnectApp()
            setPicked(mode)
        },
        [disconnectApp],
    )

    // A commit makes a new evaluator revision: the playground follows it, after the app if one
    // is connected.
    const followCommit = useCallback(
        (revisionId: string) => {
            if (!evaluatorRevisionId) return
            store.set(playgroundController.actions.switchEntity, {
                currentEntityId: evaluatorRevisionId,
                newEntityId: revisionId,
            })
        },
        [evaluatorRevisionId, store],
    )

    if (status === "not-found") return <PageNotFound />

    return (
        <>
            <PageTitle title="Playground" context={name ?? undefined} />
            {status === "error" ? (
                <PlaygroundLoadError onRetry={selection.retry} />
            ) : status !== "ready" || !evaluatorRevisionId || !primaryRevisionId ? (
                <PlaygroundSkeleton />
            ) : (
                <EvaluatorPlaygroundWorkspace
                    workspaceId={workspaceId}
                    projectId={projectId}
                    evaluatorName={name}
                    evaluatorRevisionId={evaluatorRevisionId}
                    primaryRevisionId={primaryRevisionId}
                    appRevisionId={appRevisionId}
                    runOn={runOn}
                    onRunOnChange={pickRunOn}
                    onConnectApp={connectApp}
                    onDisconnectApp={disconnectApp}
                    onWorkflowRevisionCommitted={followCommit}
                />
            )}
            {leaveDialog}
        </>
    )
}
