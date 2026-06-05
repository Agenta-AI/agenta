/**
 * useEvaluatorRunControls
 *
 * Single source of truth for the evaluator playground's run controls, shared by
 * the full-page playground and the evaluator-creation drawer. Before this hook,
 * the app adapter, app-select handler, evaluator-node lookup, and run-on
 * wiring were copy-pasted across the page header, page body, drawer header, and
 * drawer body — which is exactly how the drawer drifted out of sync with the
 * page (it kept forcing an app even in test-case mode). Centralizing it here
 * means both surfaces behave identically by construction.
 */

import {useCallback, useMemo} from "react"

import {
    createWorkflowRevisionAdapter,
    type WorkflowRevisionSelectionResult,
} from "@agenta/entity-ui/selection"
import {playgroundController} from "@agenta/playground"
import {getDefaultStore, useAtomValue, useSetAtom} from "jotai"

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
    // Bind to the default store explicitly. The playground state runs on the
    // default store (the playground package uses `getDefaultStore()` throughout),
    // but the evaluator-creation drawer renders inside a scoped Jotai store
    // (`EvaluationRunsTableStoreProvider`) that doesn't mirror the playground or
    // run-on atoms. Without this, the drawer would read/write run-on mode in the
    // scoped store while the playground lives in the default store — the two
    // split, so switching to test-case mode never reaches the run panel and it
    // stays stuck on "select an app". On the full page (no scoped store) this is
    // a no-op. Same pattern as `usePreviewVariantConfig` / `TestsetCells`.
    const store = getDefaultStore()

    // Evaluator node — phase 1: evaluator at depth 0 (primary); phase 2:
    // evaluator at depth 1 (downstream of a connected app).
    const nodes = useAtomValue(
        useMemo(() => playgroundController.selectors.nodes(), []),
        {store},
    )
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
                parentLabel: "Application",
            }),
        [],
    )

    const connectApp = useSetAtom(connectAppToEvaluatorAtom, {store})
    const disconnectApp = useSetAtom(disconnectAppFromEvaluatorAtom, {store})

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
    const runOnMode = useAtomValue(effectiveRunOnModeAtom, {store})
    const setRunOnMode = useSetAtom(runOnModeAtom, {store})
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

    const hasAppConnected = useAtomValue(hasAppConnectedAtom, {store})
    const selectedAppLabel = useAtomValue(selectedAppLabelAtom, {store})

    // In "app" mode with no app connected yet, the evaluator can't run — the run
    // panel surfaces the app selector instead of the testcase rows. In test-case
    // mode the evaluator runs standalone, so it's never blocked on an app.
    // Only takes effect where the run panel renders (the page and the expanded
    // drawer); the collapsed drawer is config-only and ignores `runDisabled`.
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
