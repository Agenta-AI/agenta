import {useCallback} from "react"

import {
    ADD_TO_TESTSET_COMMIT_MODES,
    annotationSessionController,
    CREATE_TESTSET_FIELDS,
} from "@agenta/annotation"
import {
    EntityCommitModal,
    type CommitSubmitParams,
    type CommitSubmitResult,
} from "@agenta/entity-ui/modals"
import {EntityPicker} from "@agenta/entity-ui/selection"
import {useAtomValue, useSetAtom} from "jotai"

import {ADD_TO_TESTSET_TARGET_ADAPTER, type AddToTestsetTargetSelection} from "./addToTestsetTarget"

const START_FAILURE_TEXT = "Failed to start testset export"

/**
 * Adds annotated items to a testset: an existing one picked from the list, or a new one named
 * after the queue. The scope (one item, the selection, everything) was set when it opened.
 */
export const AddToTestsetModal = ({queueId, queueName}: {queueId: string; queueName: string}) => {
    const open = useAtomValue(annotationSessionController.selectors.isAddToTestsetModalOpen())
    const pending = useAtomValue(annotationSessionController.selectors.pendingTestsetSelection())
    const isExporting = useAtomValue(
        annotationSessionController.selectors.isAddToTestsetExporting(),
    )
    const close = useSetAtom(annotationSessionController.actions.closeAddToTestsetModal)
    const setPending = useSetAtom(annotationSessionController.actions.setPendingTestsetSelection)
    const addToTestset = useSetAtom(annotationSessionController.actions.addScenariosToTestset)

    const submit = useCallback(
        async (params: CommitSubmitParams): Promise<CommitSubmitResult> => {
            try {
                await addToTestset({
                    targetMode: params.mode === "new" ? "new" : "existing",
                    commitMessage: params.message ?? "",
                    newTestsetName: params.entityName,
                    newTestsetSlug: params.entitySlug,
                })
                return {success: true}
            } catch (cause) {
                console.error("Starting the testset export failed", cause)
                return {success: false, error: START_FAILURE_TEXT}
            }
        },
        [addToTestset],
    )

    const onModeChange = useCallback(
        (mode: string | undefined) => {
            if (mode === "new") setPending({testsetId: null})
        },
        [setPending],
    )

    const canSubmit = useCallback(
        ({mode}: {mode?: string}) => !isExporting && (mode === "new" || Boolean(pending)),
        [isExporting, pending],
    )

    const renderModeContent = useCallback(
        ({mode}: {mode?: string}) =>
            mode === "new" ? null : (
                <EntityPicker<AddToTestsetTargetSelection>
                    variant="cascading"
                    adapter={ADD_TO_TESTSET_TARGET_ADAPTER}
                    initialSelections={[pending]}
                    showLabels
                    showAutoIndicator={false}
                    placeholders={["Select testset"]}
                    onSelect={(selection) =>
                        setPending({
                            testsetId: selection.metadata.testsetId,
                            testsetName: selection.metadata.testsetName,
                        })
                    }
                    onDeselect={() => setPending({testsetId: null})}
                />
            ),
        [pending, setPending],
    )

    return (
        <EntityCommitModal
            open={open}
            onClose={close}
            entity={{type: "simpleQueue", id: queueId, name: queueName}}
            onSubmit={submit}
            // The export runs after the modal closes; its own toast reports the result.
            successMessage={null}
            commitModes={ADD_TO_TESTSET_COMMIT_MODES}
            defaultCommitMode="existing"
            onModeChange={onModeChange}
            renderModeContent={renderModeContent}
            canSubmit={canSubmit}
            createEntityFields={CREATE_TESTSET_FIELDS}
            submitLabel="Add"
            actionLabel="Add to Testset"
        />
    )
}
