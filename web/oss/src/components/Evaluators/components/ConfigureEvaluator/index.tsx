/**
 * ConfigureEvaluatorPage
 *
 * Evaluator configuration page using the playground infrastructure.
 * Entity loading is URL-driven via playgroundSyncAtom (same as the app playground).
 *
 * URL: /evaluators/playground?revisions=<evalRevId>#pgSnapshot=...
 *
 * Phase 1 (initial load): URL has evaluator revision → hydrated as primary node
 * Phase 2 (app select): App becomes primary, evaluator moves to downstream (depth 1)
 */

import {useCallback, useEffect, useMemo} from "react"

import {loadableController} from "@agenta/entities/loadable"
import {testcaseMolecule} from "@agenta/entities/testcase"
import {EntityPicker} from "@agenta/entity-ui"
import {
    createWorkflowRevisionAdapter,
    type WorkflowRevisionSelectionResult,
} from "@agenta/entity-ui/selection"
import {playgroundController} from "@agenta/playground"
import {PlaygroundUIProvider, type PlaygroundUIProviders} from "@agenta/playground-ui"
import {EntitySelectorProvider} from "@agenta/playground-ui/components"
import {preloadEditorPlugins, SyncStateTag} from "@agenta/ui"
import {Typography} from "antd"
import {useAtomValue, useSetAtom} from "jotai"
import dynamic from "next/dynamic"

import {OSSdrillInUIProvider} from "@/oss/components/DrillInView/OSSdrillInUIProvider"
import SimpleSharedEditor from "@/oss/components/EditorViews/SimpleSharedEditor"
import PlaygroundTestcaseEditor from "@/oss/components/Playground/Components/PlaygroundTestcaseEditor"
import {OSSPlaygroundEntityProvider} from "@/oss/components/Playground/OSSPlaygroundEntityProvider"
import SharedGenerationResultUtils from "@/oss/components/SharedGenerationResultUtils"
import {playgroundSyncAtom} from "@/oss/state/url/playground"

import {
    connectAppToEvaluatorAtom,
    evaluatorConfigEntityIdsAtom,
    hasAppConnectedAtom,
    selectedAppLabelAtom,
} from "./atoms"
import EvaluatorPlaygroundHeader from "./EvaluatorPlaygroundHeader"

const PlaygroundMainView = dynamic(
    () => import("@/oss/components/Playground/Components/MainLayout"),
    {ssr: false},
)

/**
 * Sync state tag — renders sync badge in each row header.
 * Same as the app playground's version.
 */
function EvaluatorSyncStateTag({rowId, loadableId}: {rowId: string; loadableId: string}) {
    const mode = useAtomValue(loadableController.selectors.mode(loadableId)) as
        | "local"
        | "connected"
        | null
    const isDirty = useAtomValue(useMemo(() => testcaseMolecule.isDirty(rowId), [rowId])) as boolean
    const discard = useSetAtom(testcaseMolecule.actions.discard)
    const handleDiscard = useCallback(() => discard(rowId), [discard, rowId])

    if (mode !== "connected") return null

    const isNew = rowId.startsWith("new-") || rowId.startsWith("local-")
    const syncState = isNew ? "new" : isDirty ? "modified" : "unmodified"

    return (
        <SyncStateTag
            syncState={syncState}
            dismissible={syncState === "modified"}
            onDismiss={syncState === "modified" ? handleDiscard : undefined}
        />
    )
}

const ConfigureEvaluatorPageInner = () => {
    // Mount the playground URL sync system (same as app playground)
    useAtomValue(playgroundSyncAtom)

    const configEntityIds = useAtomValue(evaluatorConfigEntityIdsAtom)
    const hasAppConnected = useAtomValue(hasAppConnectedAtom)
    const connectApp = useSetAtom(connectAppToEvaluatorAtom)
    const selectedAppLabel = useAtomValue(selectedAppLabelAtom)

    // Read the current evaluator entity from playground nodes
    // Phase 1: evaluator is at depth 0 (primary)
    // Phase 2: evaluator is at depth 1 (downstream)
    const nodes = useAtomValue(useMemo(() => playgroundController.selectors.nodes(), []))
    const evaluatorNode = useMemo(() => {
        const downstream = nodes.find((n) => n.depth > 0)
        if (downstream) return downstream
        return nodes[0] ?? null
    }, [nodes])

    // Preload editor plugins
    useEffect(() => {
        void preloadEditorPlugins()
    }, [])

    // App workflow picker (shared between header and empty state)
    const appWorkflowAdapter = useMemo(
        () =>
            createWorkflowRevisionAdapter({
                skipVariantLevel: true,
                excludeRevisionZero: true,
                flags: {is_evaluator: false, is_human: false},
            }),
        [],
    )

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

    const runDisabledContent = useMemo(
        () => (
            <>
                <Typography.Text type="secondary" className="text-sm">
                    Select an app to run the evaluator chain
                </Typography.Text>
                <EntityPicker<WorkflowRevisionSelectionResult>
                    variant="popover-cascader"
                    adapter={appWorkflowAdapter}
                    onSelect={handleAppSelect}
                    size="middle"
                    placeholder={selectedAppLabel ?? "Select app"}
                />
            </>
        ),
        [appWorkflowAdapter, handleAppSelect, selectedAppLabel],
    )

    const providers = useMemo(
        () =>
            ({
                SimpleSharedEditor,
                SharedGenerationResultUtils,
                renderSyncStateTag: EvaluatorSyncStateTag,
                TestcaseEditor: PlaygroundTestcaseEditor,
            }) as unknown as PlaygroundUIProviders,
        [],
    )

    return (
        <OSSPlaygroundEntityProvider>
            <PlaygroundUIProvider providers={providers}>
                <EntitySelectorProvider>
                    <OSSdrillInUIProvider>
                        <div className="flex flex-col w-full h-full overflow-hidden">
                            <EvaluatorPlaygroundHeader
                                appWorkflowAdapter={appWorkflowAdapter}
                                onAppSelect={handleAppSelect}
                            />
                            <PlaygroundMainView
                                mode="evaluator"
                                configEntityIdsOverride={configEntityIds}
                                runDisabled={!hasAppConnected}
                                runDisabledContent={runDisabledContent}
                            />
                        </div>
                    </OSSdrillInUIProvider>
                </EntitySelectorProvider>
            </PlaygroundUIProvider>
        </OSSPlaygroundEntityProvider>
    )
}

const ConfigureEvaluatorPage = () => {
    return <ConfigureEvaluatorPageInner />
}

export default ConfigureEvaluatorPage
