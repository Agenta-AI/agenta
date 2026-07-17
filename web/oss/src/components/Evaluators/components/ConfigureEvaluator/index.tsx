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
import {type PlaygroundUIProviders} from "@agenta/playground-ui"
import {preloadEditorPlugins, SyncStateTag} from "@agenta/ui"
import {useAtomValue, useSetAtom} from "jotai"
import dynamic from "next/dynamic"

import SimpleSharedEditor from "@/oss/components/EditorViews/SimpleSharedEditor"
import PlaygroundTestcaseEditor from "@/oss/components/Playground/Components/PlaygroundTestcaseEditor"
import {OSSPlaygroundShell} from "@/oss/components/Playground/OSSPlaygroundShell"
import SharedGenerationResultUtils from "@/oss/components/SharedGenerationResultUtils"
import {playgroundSyncAtom} from "@/oss/state/url/playground"

import {evaluatorConfigEntityIdsAtom} from "./atoms"
import EvaluatorPlaygroundHeader from "./EvaluatorPlaygroundHeader"
import SelectAppEmptyState from "./SelectAppEmptyState"
import {useEvaluatorRunControls} from "./useEvaluatorRunControls"

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
        "local" | "connected" | null
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

    // Shared run controls (app adapter, app-select, run-on mode, run gate) — the
    // same hook the header and the creation drawer use, so all surfaces agree.
    const {appWorkflowAdapter, handleAppSelect, selectedAppLabel, runDisabled} =
        useEvaluatorRunControls()

    // Preload editor plugins
    useEffect(() => {
        void preloadEditorPlugins()
    }, [])

    const runDisabledContent = useMemo(
        () => (
            <SelectAppEmptyState
                adapter={appWorkflowAdapter}
                onSelect={handleAppSelect}
                selectedAppLabel={selectedAppLabel}
            />
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
        <OSSPlaygroundShell providers={providers}>
            {/* Definite height (viewport minus the app topbar) so the run panel's
             * `h-full` centering resolves — same pattern as the app playground
             * (`Playground.tsx`). With a plain `h-full` here the chain collapses
             * to content height and the empty state sticks to the top. */}
            <div className="flex flex-col w-full h-[calc(100dvh-75px)] overflow-hidden">
                <EvaluatorPlaygroundHeader />
                <PlaygroundMainView
                    mode="evaluator"
                    configEntityIdsOverride={configEntityIds}
                    runDisabled={runDisabled}
                    runDisabledContent={runDisabledContent}
                />
            </div>
        </OSSPlaygroundShell>
    )
}

const ConfigureEvaluatorPage = () => {
    return <ConfigureEvaluatorPageInner />
}

export default ConfigureEvaluatorPage
