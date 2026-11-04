import {useState} from "react"

import type {CommitCreateFieldsConfig, CommitModeOption} from "@agenta/entity-ui/modals"
import {useTestsetMenuModel} from "@agenta/playground-ui/hooks"
import {TestsetMenu} from "@agenta/playground-ui/panels/runs"
import dynamic from "next/dynamic"

// Each dialog downloads when it first opens: the menu button is all the run pane loads.
const LoadTestsetDialog = dynamic(
    () =>
        import("@agenta/playground-ui/panels/testsets").then((module) => module.LoadTestsetDialog),
    {ssr: false},
)
const KeepDraftRowsDialog = dynamic(
    () =>
        import("@agenta/playground-ui/panels/testsets").then(
            (module) => module.KeepDraftRowsDialog,
        ),
    {ssr: false},
)
const UnsavedTestsetDialog = dynamic(
    () =>
        import("@agenta/playground-ui/panels/testsets").then(
            (module) => module.UnsavedTestsetDialog,
        ),
    {ssr: false},
)
const EntityCommitModal = dynamic(
    () => import("@agenta/entity-ui/modals").then((module) => module.EntityCommitModal),
    {ssr: false},
)

const SYNC_MODES: CommitModeOption[] = [
    {id: "commit", label: "Commit changes"},
    {id: "save-new", label: "Save as new test set"},
]

const SAVE_NEW_FIELDS: CommitCreateFieldsConfig = {
    modes: ["save-new"],
    nameLabel: "Test set name",
    defaultName: ({entity}) => entity?.name ?? "",
}

/**
 * The test set menu of the run pane and the dialog it has open: load, manage, keep drafts,
 * unsaved changes, or sync.
 */
export const PlaygroundTestsetMenu = () => {
    const model = useTestsetMenuModel()
    const {dialog, loadableId} = model
    const [syncMode, setSyncMode] = useState("commit")
    if (!loadableId) return null

    return (
        <>
            <TestsetMenu model={model} />
            {dialog?.kind === "load" || dialog?.kind === "edit" ? (
                <LoadTestsetDialog
                    loadableId={loadableId}
                    mode={dialog.kind}
                    connectedRevisionId={model.connectedRevisionId}
                    connectedTestsetId={model.connectedTestsetId}
                    singleSelect={model.isChat}
                    onConfirm={dialog.kind === "edit" ? model.confirmEdit : model.confirmLoad}
                    onCancel={model.close}
                />
            ) : null}
            {dialog?.kind === "keep-drafts" ? (
                <KeepDraftRowsDialog
                    draftCount={dialog.draftCount}
                    testsetName={dialog.testsetName}
                    chat={dialog.chat}
                    onKeep={() => model.confirmKeepDrafts(true)}
                    onDiscard={() => model.confirmKeepDrafts(false)}
                    onCancel={model.close}
                />
            ) : null}
            {dialog?.kind === "unsaved" ? (
                <UnsavedTestsetDialog
                    intent={dialog.intent}
                    saving={model.saving}
                    onSave={() => void model.resolveUnsaved("save")}
                    onDiscard={() => void model.resolveUnsaved("discard")}
                    onCancel={model.close}
                />
            ) : null}
            {dialog?.kind === "sync" && model.connectedRevisionId ? (
                <EntityCommitModal
                    open
                    onClose={() => {
                        setSyncMode("commit")
                        model.close()
                    }}
                    entity={{
                        type: "revision",
                        id: model.connectedRevisionId,
                        name: model.label,
                        metadata: {loadableId},
                    }}
                    onSubmit={model.syncSubmit}
                    commitModes={SYNC_MODES}
                    defaultCommitMode="commit"
                    onModeChange={(mode) => setSyncMode(mode ?? "commit")}
                    submitLabel={syncMode === "save-new" ? "Save" : "Commit"}
                    canSubmit={model.canSyncSubmit}
                    createEntityFields={SAVE_NEW_FIELDS}
                    successMessage="Test set updated successfully"
                />
            ) : null}
        </>
    )
}
