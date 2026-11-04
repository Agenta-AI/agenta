import {useEffect, useRef, useState} from "react"

import type {CommitCreateFieldsConfig, CommitModeOption} from "@agenta/entity-ui/modals"
import {useTestsetMenuModel} from "@agenta/playground-ui/hooks"
import {TestsetMenu} from "@agenta/playground-ui/panels/runs"
import {projectIdAtom} from "@agenta/shared/state"
import {message} from "@agenta/ui/app-message"
import {useAtomValue} from "jotai"
import dynamic from "next/dynamic"
import {useRouter} from "next/router"

import {useProjectPermission} from "../context/useProjectPermission"
import type {CreatedTestset} from "../testsets/create/useUploadTestset"

import {createdTestsetPayload} from "./createdTestsetLoad"

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
// The create dialog is the test sets page's own dialog; it downloads only when it opens.
const CreateTestsetDialog = dynamic(
    () => import("../testsets/create/CreateTestsetDialog").then((m) => m.CreateTestsetDialog),
    {ssr: false},
)
// "Add to test set" opens the traces page's sheet with the runs of this page.
const PlaygroundAddToTestset = dynamic(() => import("./PlaygroundAddToTestset"), {ssr: false})
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
    const [creating, setCreating] = useState(false)
    const [adding, setAdding] = useState(false)
    const router = useRouter()
    const projectId = useAtomValue(projectIdAtom) as string | null
    const canAddToTestset = useProjectPermission(projectId ?? "", "edit_testsets")
    // Leaving the page while the rows load must not connect a playground that is gone.
    const mounted = useRef(true)
    useEffect(() => {
        mounted.current = true
        return () => {
            mounted.current = false
        }
    }, [])
    if (!loadableId) return null

    // The new test set loads the way a pick in the load dialog does, with all of its rows.
    const loadCreated = async (created: CreatedTestset): Promise<void> => {
        if (!projectId || !created.revisionId) return
        try {
            const payload = await createdTestsetPayload(projectId, {
                ...created,
                revisionId: created.revisionId,
            })
            if (mounted.current) model.confirmLoad(payload)
        } catch (error) {
            console.error("Loading the new test set failed", error)
            message.error("The test set was created, but it did not load")
        }
    }

    return (
        <>
            <TestsetMenu
                model={model}
                onAddToTestset={canAddToTestset ? () => setAdding(true) : undefined}
            />
            {adding ? (
                <PlaygroundAddToTestset loadableId={loadableId} onClose={() => setAdding(false)} />
            ) : null}
            {dialog?.kind === "load" || dialog?.kind === "edit" ? (
                <LoadTestsetDialog
                    loadableId={loadableId}
                    mode={dialog.kind}
                    connectedRevisionId={model.connectedRevisionId}
                    connectedTestsetId={model.connectedTestsetId}
                    singleSelect={model.isChat}
                    onConfirm={dialog.kind === "edit" ? model.confirmEdit : model.confirmLoad}
                    onCancel={model.close}
                    onCreate={() => setCreating(true)}
                />
            ) : null}
            {creating && projectId ? (
                <CreateTestsetDialog
                    projectId={projectId}
                    base={`/w/${router.query.workspace_id}/p/${projectId}`}
                    onClose={() => setCreating(false)}
                    onCreated={loadCreated}
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
