/**
 * useEvaluatorRunControls
 *
 * Single source of truth for the evaluator playground's run controls, shared by
 * the full-page playground, the evaluator-creation drawer, and the workflow
 * revision drawer. Before this hook, the app adapter, app-select handler,
 * evaluator-node lookup, and run-on wiring were copy-pasted across every
 * surface — which is exactly how the drawers drifted out of sync with the page
 * (they kept forcing an app even in test-case mode). Centralizing it here means
 * every surface behaves identically by construction.
 */

import {useCallback, useMemo} from "react"

import {isAgentWorkflow} from "@agenta/entities/workflow"
import {
    createWorkflowRevisionAdapter,
    type WorkflowRevisionSelectionResult,
} from "@agenta/entity-ui/selection"
import {playgroundController} from "@agenta/playground"
import {useAtomValue, useSetAtom} from "jotai"

import {
    connectAppToEvaluatorAtom,
    disconnectAppFromEvaluatorAtom,
    effectiveRunOnModeAtom,
    hasAppConnectedAtom,
    runOnModeAtom,
    selectedAppLabelAtom,
    type RunOnMode,
} from "./atoms"

export function useEvaluatorRunControls() {
    // Evaluator node — phase 1: evaluator at depth 0 (primary); phase 2:
    // evaluator at depth 1 (downstream of a connected app).
    const nodes = useAtomValue(useMemo(() => playgroundController.selectors.nodes(), []))
    const evaluatorNode = useMemo(() => {
        const downstream = nodes.find((n) => n.depth > 0)
        if (downstream) return downstream
        return nodes[0] ?? null
    }, [nodes])

    // App picker — picks an upstream *app* workflow to attach to the evaluator.
    // `parentLabel: "Application"` keeps the search bar saying "Search app…"
    // rather than the adapter's historical "Search evaluator…" default.
    const appWorkflowAdapter = useMemo(
        () =>
            createWorkflowRevisionAdapter({
                skipVariantLevel: true,
                excludeRevisionZero: true,
                flags: {is_evaluator: false, is_feedback: false},
                // Agent workflows aren't runnable evaluation subjects here.
                filterWorkflows: (w) => !isAgentWorkflow(w),
                parentLabel: "Application",
            }),
        [],
    )

    const connectApp = useSetAtom(connectAppToEvaluatorAtom)
    const disconnectApp = useSetAtom(disconnectAppFromEvaluatorAtom)

    const handleAppSelect = useCallback(
        (selection: WorkflowRevisionSelectionResult) => {
            if (!evaluatorNode) return
            connectApp({
                appRevisionId: selection.id,
                appLabel: selection.label,
                evaluatorRevisionId: evaluatorNode.entityId,
                evaluatorLabel: evaluatorNode.label ?? "Evaluator",
            })
        },
        [connectApp, evaluatorNode],
    )

    // Run-on mode. A connected app forces effective "app" mode (the node graph
    // is the source of truth); the stored preference only applies when nothing
    // is connected.
    const runOnMode = useAtomValue(effectiveRunOnModeAtom)
    const setRunOnMode = useSetAtom(runOnModeAtom)
    const handlePickRunOn = useCallback(
        (next: RunOnMode) => {
            if (next === "trace") return // disabled, not selectable
            // Leaving "app" mode drops the connected app so the graph returns to
            // standalone-evaluator shape.
            if (next === "data") disconnectApp()
            setRunOnMode(next)
        },
        [disconnectApp, setRunOnMode],
    )

    const hasAppConnected = useAtomValue(hasAppConnectedAtom)
    const selectedAppLabel = useAtomValue(selectedAppLabelAtom)

    // In "app" mode with no app connected yet, the evaluator can't run — the run
    // panel surfaces the app selector instead of the testcase rows. In test-case
    // mode the evaluator runs standalone, so it's never blocked on an app. Only
    // takes effect where the run panel renders (the page and expanded drawers).
    const runDisabled = runOnMode === "app" && !hasAppConnected

    return {
        appWorkflowAdapter,
        handleAppSelect,
        disconnectApp,
        runOnMode,
        handlePickRunOn,
        hasAppConnected,
        selectedAppLabel,
        runDisabled,
    }
}
