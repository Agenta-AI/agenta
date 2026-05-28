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
import {
    createWorkflowRevisionAdapter,
    type WorkflowRevisionSelectionResult,
} from "@agenta/entity-ui/selection"
import {playgroundController} from "@agenta/playground"
import {type PlaygroundUIProviders} from "@agenta/playground-ui"
import {preloadEditorPlugins, SyncStateTag} from "@agenta/ui"
import {useAtomValue, useSetAtom} from "jotai"
import dynamic from "next/dynamic"

import SimpleSharedEditor from "@/oss/components/EditorViews/SimpleSharedEditor"
import PlaygroundTestcaseEditor from "@/oss/components/Playground/Components/PlaygroundTestcaseEditor"
import {OSSPlaygroundShell} from "@/oss/components/Playground/OSSPlaygroundShell"
import SharedGenerationResultUtils from "@/oss/components/SharedGenerationResultUtils"
import {playgroundSyncAtom} from "@/oss/state/url/playground"

import {connectAppToEvaluatorAtom, evaluatorConfigEntityIdsAtom} from "./atoms"
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
    const connectApp = useSetAtom(connectAppToEvaluatorAtom)

    // Read the current evaluator entity from playground nodes
    // Phase 1: evaluator is at depth 0 (primary, standalone run)
    // Phase 2: evaluator is at depth 1 (downstream of a connected app — chain run)
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

    // App workflow picker — opt-in for chain-mode execution. The evaluator can
    // also run standalone: the user fills the testcase row's template variables
    // (e.g. `{{inputs}}`, `{{outputs}}` for LLM-as-a-judge) directly. The
    // header surfaces this picker; we never block the run panel on it.
    const appWorkflowAdapter = useMemo(
        () =>
            createWorkflowRevisionAdapter({
                skipVariantLevel: true,
                excludeRevisionZero: true,
                flags: {is_evaluator: false, is_feedback: false},
                // The picker on the evaluator playground header is picking an
                // upstream *app* workflow to connect to — without this the
                // search bar would say "Search evaluator…" (the adapter's
                // historical default) while the user is choosing an app.
                parentLabel: "Application",
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
        <OSSPlaygroundShell providers={providers}>
            <div className="flex flex-col w-full h-full overflow-hidden">
                <EvaluatorPlaygroundHeader
                    appWorkflowAdapter={appWorkflowAdapter}
                    onAppSelect={handleAppSelect}
                />
                <PlaygroundMainView mode="evaluator" configEntityIdsOverride={configEntityIds} />
            </div>
        </OSSPlaygroundShell>
    )
}

const ConfigureEvaluatorPage = () => {
    return <ConfigureEvaluatorPageInner />
}

export default ConfigureEvaluatorPage
