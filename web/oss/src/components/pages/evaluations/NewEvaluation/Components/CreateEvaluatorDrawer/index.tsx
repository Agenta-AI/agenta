/**
 * CreateEvaluatorDrawer
 *
 * An inline drawer for evaluator creation within the NewEvaluation modal.
 * Embeds the playground infrastructure matching the evaluator playground page behavior:
 *
 * Phase 1: Evaluator is primary node → config panel only, run disabled with app picker
 * Phase 2: App selected → app becomes primary, evaluator moves downstream, run enabled
 *
 * Flow:
 * 1. Template selected → local entity created → drawer opens with entity ID
 * 2. Playground renders with same two-phase model as evaluator playground page
 * 3. User can expand drawer to show execution panel (full mode)
 * 4. On commit → drawer closes → onEvaluatorCreated(newRevisionId)
 */
import {memo, useCallback, useEffect, useMemo, useRef} from "react"

import {
    workflowMolecule,
    registerWorkflowCommitCallbacks,
    getWorkflowCommitCallbacks,
} from "@agenta/entities/workflow"
import {type PlaygroundUIProviders} from "@agenta/playground-ui"
import {EnhancedDrawer} from "@agenta/ui/drawer"
import {ArrowsIn, ArrowsOut} from "@phosphor-icons/react"
import {Button} from "antd"
import {useAtomValue, useSetAtom} from "jotai"
import dynamic from "next/dynamic"

import SimpleSharedEditor from "@/oss/components/EditorViews/SimpleSharedEditor"
import {evaluatorConfigEntityIdsAtom} from "@/oss/components/Evaluators/components/ConfigureEvaluator/atoms"
import EvaluatorRunControls from "@/oss/components/Evaluators/components/ConfigureEvaluator/EvaluatorRunControls"
import SelectAppEmptyState from "@/oss/components/Evaluators/components/ConfigureEvaluator/SelectAppEmptyState"
import {useEvaluatorRunControls} from "@/oss/components/Evaluators/components/ConfigureEvaluator/useEvaluatorRunControls"
import {clearEvaluatorWorkflowCache} from "@/oss/components/Evaluators/store/evaluatorsPaginatedStore"
import PlaygroundTestcaseEditor from "@/oss/components/Playground/Components/PlaygroundTestcaseEditor"
import {OSSPlaygroundShell} from "@/oss/components/Playground/OSSPlaygroundShell"
import SharedGenerationResultUtils from "@/oss/components/SharedGenerationResultUtils"

import {closeDrawerAtom, drawerEntityIdAtom, drawerExpandedAtom, drawerOpenAtom} from "./state"

const PlaygroundMainView = dynamic(
    () => import("@/oss/components/Playground/Components/MainLayout"),
    {ssr: false},
)

interface CreateEvaluatorDrawerProps {
    /** Callback after successful evaluator creation. Called with the new revision ID. */
    onEvaluatorCreated?: (configId?: string) => void
}

const DrawerHeader = ({entityId, onClose}: {entityId: string; onClose: () => void}) => {
    const isExpanded = useAtomValue(drawerExpandedAtom)
    const setExpanded = useSetAtom(drawerExpandedAtom)
    const entityData = useAtomValue(
        useMemo(() => workflowMolecule.selectors.data(entityId), [entityId]),
    )
    // Entity display name lives on the artifact; the revision's own `name`
    // carries the variant name ("default"). Falls back to the entity name
    // for ephemeral drafts that have no artifact yet.
    const artifactName = useAtomValue(
        useMemo(() => workflowMolecule.selectors.artifactName(entityId), [entityId]),
    )
    const name = artifactName?.trim() || entityData?.slug?.trim() || "New Evaluator"

    return (
        <div className="flex items-center justify-between px-4 py-3 border-0 border-b border-solid border-[var(--ag-rgba-051729-06)]">
            <span className="text-base font-semibold">{name}</span>
            <div className="flex items-center gap-2">
                <EvaluatorRunControls />
                <Button
                    type="text"
                    size="small"
                    icon={isExpanded ? <ArrowsIn size={16} /> : <ArrowsOut size={16} />}
                    onClick={() => setExpanded(!isExpanded)}
                />
                <Button type="text" size="small" onClick={onClose}>
                    Close
                </Button>
            </div>
        </div>
    )
}

const DrawerContent = ({
    entityId,
    onClose,
    onEvaluatorCreated,
}: {
    entityId: string
    onClose: () => void
    onEvaluatorCreated?: (configId?: string) => void
}) => {
    const isExpanded = useAtomValue(drawerExpandedAtom)
    const configEntityIds = useAtomValue(evaluatorConfigEntityIdsAtom)
    // Same shared controls the header uses — the run gate now respects the
    // run-on mode, so test-case mode runs without forcing an app.
    const {appWorkflowAdapter, handleAppSelect, selectedAppLabel, runDisabled} =
        useEvaluatorRunControls()
    const onEvaluatorCreatedRef = useRef(onEvaluatorCreated)
    onEvaluatorCreatedRef.current = onEvaluatorCreated

    const onCloseRef = useRef(onClose)
    onCloseRef.current = onClose

    // Register commit callback to intercept the new revision ID.
    // Chain with any existing onNewRevision (e.g., from workflowEntityBridge)
    // and restore the previous handler on cleanup.
    useEffect(() => {
        const previousOnNewRevision = getWorkflowCommitCallbacks().onNewRevision

        registerWorkflowCommitCallbacks({
            onNewRevision: async (result, params) => {
                clearEvaluatorWorkflowCache()
                await previousOnNewRevision?.(result, params)
                onCloseRef.current()
                onEvaluatorCreatedRef.current?.(result.newRevisionId)
            },
        })

        return () => {
            registerWorkflowCommitCallbacks({
                onNewRevision: previousOnNewRevision,
            })
        }
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
                TestcaseEditor: PlaygroundTestcaseEditor,
            }) as unknown as PlaygroundUIProviders,
        [],
    )

    return (
        <OSSPlaygroundShell providers={providers}>
            <div className="flex flex-col w-full h-full overflow-hidden">
                <DrawerHeader entityId={entityId} onClose={onClose} />
                <PlaygroundMainView
                    mode="evaluator"
                    viewMode={isExpanded ? "full" : "configOnly"}
                    configEntityIdsOverride={configEntityIds}
                    runDisabled={runDisabled}
                    runDisabledContent={runDisabledContent}
                />
            </div>
        </OSSPlaygroundShell>
    )
}

const CreateEvaluatorDrawer = ({onEvaluatorCreated}: CreateEvaluatorDrawerProps) => {
    const isOpen = useAtomValue(drawerOpenAtom)
    const entityId = useAtomValue(drawerEntityIdAtom)
    const isExpanded = useAtomValue(drawerExpandedAtom)
    const closeDrawer = useSetAtom(closeDrawerAtom)

    const handleClose = useCallback(() => {
        closeDrawer()
    }, [closeDrawer])

    return (
        <EnhancedDrawer
            open={isOpen}
            onClose={handleClose}
            width={isExpanded ? "clamp(1155px, 92vw, 1600px)" : 800}
            destroyOnHidden
            title={null}
            closable={false}
            closeOnLayoutClick={false}
            styles={{body: {padding: 0}}}
        >
            {isOpen && entityId && (
                <DrawerContent
                    entityId={entityId}
                    onClose={handleClose}
                    onEvaluatorCreated={onEvaluatorCreated}
                />
            )}
        </EnhancedDrawer>
    )
}

export default memo(CreateEvaluatorDrawer)
