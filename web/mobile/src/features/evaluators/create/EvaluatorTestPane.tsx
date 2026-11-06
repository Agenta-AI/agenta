import {useCallback, useState} from "react"

import {workflowMolecule} from "@agenta/entities/workflow"
import type {WorkflowRevisionSelectionResult} from "@agenta/entity-ui/selection"
import {evaluatorChainController, playgroundController} from "@agenta/playground"
import {AppPicker, RunOnSelector, type RunOnMode} from "@agenta/playground-ui/panels/evaluator"
import {Button, SimpleTooltip} from "@agenta/ui/ui"
import {X} from "@phosphor-icons/react"
import {useAtomValue, useStore} from "jotai"

import {PlaygroundRunPane} from "../../playground/PlaygroundRunPane"
import {SelectAppEmpty} from "../../playground/states/SelectAppEmpty"

/**
 * The evaluator's test pane in the editable drawer: what it runs on (an app's output or test cases
 * directly), the app it runs on, then the test cases and their runs. A connected app stays
 * connected when the evaluator is created or committed.
 */
export const EvaluatorTestPane = ({revisionId}: {revisionId: string}) => {
    const store = useStore()
    const nodes = useAtomValue(playgroundController.selectors.nodes())
    const name = useAtomValue(workflowMolecule.selectors.artifactName(revisionId))
    const appRevisionId = nodes.length > 1 ? (nodes[0]?.entityId ?? null) : null
    const appLabel = appRevisionId ? (nodes[0]?.label ?? null) : null
    const primaryRevisionId = nodes[0]?.entityId ?? revisionId
    // A connected app means "Run on an app output", whatever was picked before.
    const [picked, setPicked] = useState<RunOnMode>("app")
    const runOn: RunOnMode = appRevisionId ? "app" : picked

    const connectApp = useCallback(
        (app: WorkflowRevisionSelectionResult) => {
            store.set(evaluatorChainController.actions.connectAppToEvaluator, {
                appRevisionId: app.id,
                appLabel: app.label,
                evaluatorRevisionId: revisionId,
                evaluatorLabel: name ?? "Evaluator",
            })
        },
        [name, revisionId, store],
    )
    const disconnectApp = useCallback(
        () => store.set(evaluatorChainController.actions.disconnectAppFromEvaluator),
        [store],
    )
    const pickRunOn = (mode: RunOnMode) => {
        // Test cases feed the evaluator directly: the app goes.
        if (mode === "data") disconnectApp()
        setPicked(mode)
    }

    return (
        <section className="flex min-h-full flex-col" aria-label="Test evaluator">
            <div className="flex min-h-12 shrink-0 flex-wrap items-center gap-1 border-0 border-b border-solid border-border px-4 py-2">
                <span className="mr-auto text-sm font-medium text-foreground">Test evaluator</span>
                <RunOnSelector mode={runOn} onPick={pickRunOn} />
                {runOn === "app" ? (
                    <AppPicker selectedLabel={appLabel} onSelect={connectApp} />
                ) : null}
                {runOn === "app" && appLabel !== null ? (
                    <SimpleTooltip title="Disconnect app" side="bottom">
                        <Button
                            size="icon-sm"
                            variant="ghost"
                            aria-label="Disconnect app"
                            onClick={disconnectApp}
                        >
                            <X aria-hidden />
                        </Button>
                    </SimpleTooltip>
                ) : null}
            </div>
            <div className="min-h-0 flex-1">
                {runOn === "app" && !appRevisionId ? (
                    <SelectAppEmpty onSelect={connectApp} />
                ) : (
                    <PlaygroundRunPane revisionId={primaryRevisionId} />
                )}
            </div>
        </section>
    )
}
