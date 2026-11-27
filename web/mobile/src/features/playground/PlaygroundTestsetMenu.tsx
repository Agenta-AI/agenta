import {useEffect, useRef, useState} from "react"

import type {CommitCreateFieldsConfig, CommitModeOption} from "@agenta/entity-ui/modals"
import {useT} from "@agenta/i18n"
import testsetsCatalog from "@agenta/i18n/catalogs/playground.testsets"
import {useTestsetMenuModel} from "@agenta/playground-ui/hooks"
import {TestsetMenu} from "@agenta/playground-ui/panels/runs"
import {projectIdAtom} from "@agenta/shared/state"
import {message} from "@agenta/ui/app-message"
import {
    AlertDialog,
    AlertDialogCancel,
    AlertDialogContent,
    AlertDialogDescription,
    AlertDialogFooter,
    AlertDialogHeader,
    AlertDialogTitle,
    Button,
} from "@agenta/ui/ui"
import {useAtomValue, useStore} from "jotai"
import dynamic from "next/dynamic"
import {useRouter} from "next/router"

import {useProjectPermission} from "../context/useProjectPermission"
import type {CreatedTestset} from "../testsets/create/useUploadTestset"

import {createdTestsetPayload} from "./createdTestsetLoad"
import {runTraceIds} from "./playgroundRunTraces"
import {PlaygroundTestsetDrop} from "./PlaygroundTestsetDrop"

// Each dialog downloads when it first opens: the menu button is all the run pane loads.
const LoadTestsetDialog = dynamic(
    () =>
        import("@agenta/playground-ui/panels/testsets").then((module) => module.LoadTestsetDialog),
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

// The unsaved-changes copy for each leave intent.
const UNSAVED_COPY = {
    disconnect: {
        title: "playground.testsets.disconnectTitle",
        question: "playground.testsets.disconnectQuestion",
        note: "playground.testsets.disconnectNote",
        discard: "playground.testsets.disconnectDiscard",
        save: "playground.testsets.disconnectSave",
    },
    change: {
        title: "playground.testsets.changeTitle",
        question: "playground.testsets.changeQuestion",
        note: "playground.testsets.changeNote",
        discard: "playground.testsets.changeDiscard",
        save: "playground.testsets.changeSave",
    },
} as const

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
    const t = useT(testsetsCatalog)
    const model = useTestsetMenuModel()
    const {dialog, loadableId} = model
    const [syncMode, setSyncMode] = useState("commit")
    // The create dialog is open; with the file dropped in the load dialog, if there was one.
    const [creating, setCreating] = useState<{file?: File} | null>(null)
    // The traces of the runs to add, read when the user picks "Add to test set".
    const [adding, setAdding] = useState<string[] | null>(null)
    const store = useStore()
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
    const draftsTestsetName =
        dialog?.kind === "keep-drafts"
            ? dialog.testsetName?.trim() || t("playground.testsets.theTestSet")
            : ""

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
                onAddToTestset={
                    canAddToTestset
                        ? () => setAdding(runTraceIds(store.get, loadableId))
                        : undefined
                }
            />
            {adding ? (
                <PlaygroundAddToTestset traceIds={adding} onClose={() => setAdding(null)} />
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
                    create={<PlaygroundTestsetDrop onFile={(file) => setCreating({file})} />}
                />
            ) : null}
            {creating && projectId ? (
                <CreateTestsetDialog
                    projectId={projectId}
                    base={`/w/${router.query.workspace_id}/p/${projectId}`}
                    onClose={() => setCreating(null)}
                    onCreated={loadCreated}
                    initialFile={creating.file}
                />
            ) : null}
            {dialog?.kind === "keep-drafts" ? (
                <AlertDialog
                    open
                    onOpenChange={(next) => {
                        if (!next) model.close()
                    }}
                >
                    <AlertDialogContent>
                        <AlertDialogHeader>
                            <AlertDialogTitle>
                                {dialog.chat
                                    ? t("playground.testsets.replaceConversationTitle")
                                    : t("playground.testsets.keepDraftsTitle")}
                            </AlertDialogTitle>
                            <AlertDialogDescription asChild>
                                <div className="flex flex-col gap-2">
                                    {dialog.chat ? (
                                        <>
                                            <p className="m-0">
                                                {t("playground.testsets.loadingReplaces", {
                                                    name: draftsTestsetName,
                                                })}
                                            </p>
                                            <p className="m-0">
                                                {t("playground.testsets.chatOneAtATime")}
                                            </p>
                                        </>
                                    ) : (
                                        <>
                                            <p className="m-0">
                                                {dialog.draftCount > 1
                                                    ? t("playground.testsets.draftsMany", {
                                                          count: dialog.draftCount,
                                                      })
                                                    : t("playground.testsets.draftsOne")}
                                            </p>
                                            <p className="m-0">
                                                {dialog.draftCount > 1
                                                    ? t("playground.testsets.keepThemAndLoad", {
                                                          name: draftsTestsetName,
                                                      })
                                                    : t("playground.testsets.keepItAndLoad", {
                                                          name: draftsTestsetName,
                                                      })}
                                            </p>
                                        </>
                                    )}
                                </div>
                            </AlertDialogDescription>
                        </AlertDialogHeader>
                        <AlertDialogFooter>
                            <AlertDialogCancel asChild>
                                <Button variant="outline" onClick={model.close}>
                                    {t("playground.testsets.cancel")}
                                </Button>
                            </AlertDialogCancel>
                            <Button
                                variant="destructive"
                                onClick={() => model.confirmKeepDrafts(false)}
                            >
                                {dialog.chat
                                    ? t("playground.testsets.loadAndReplace")
                                    : t("playground.testsets.discardDrafts")}
                            </Button>
                            {dialog.chat ? null : (
                                <Button onClick={() => model.confirmKeepDrafts(true)}>
                                    {t("playground.testsets.keepAndLoad")}
                                </Button>
                            )}
                        </AlertDialogFooter>
                    </AlertDialogContent>
                </AlertDialog>
            ) : null}
            {dialog?.kind === "unsaved" ? (
                <AlertDialog
                    open
                    onOpenChange={(next) => {
                        if (!next && !model.saving) model.close()
                    }}
                >
                    <AlertDialogContent
                        onEscapeKeyDown={(event) => {
                            if (model.saving) event.preventDefault()
                        }}
                    >
                        <AlertDialogHeader>
                            <AlertDialogTitle>
                                {t(UNSAVED_COPY[dialog.intent].title)}
                            </AlertDialogTitle>
                            <AlertDialogDescription asChild>
                                <div className="flex flex-col gap-2">
                                    <p className="m-0">{t(UNSAVED_COPY[dialog.intent].question)}</p>
                                    <p className="m-0">{t(UNSAVED_COPY[dialog.intent].note)}</p>
                                </div>
                            </AlertDialogDescription>
                        </AlertDialogHeader>
                        <AlertDialogFooter>
                            <AlertDialogCancel asChild>
                                <Button
                                    variant="outline"
                                    onClick={model.close}
                                    disabled={model.saving}
                                >
                                    {t("playground.testsets.cancel")}
                                </Button>
                            </AlertDialogCancel>
                            <Button
                                variant="destructive"
                                onClick={() => void model.resolveUnsaved("discard")}
                                disabled={model.saving}
                            >
                                {t(UNSAVED_COPY[dialog.intent].discard)}
                            </Button>
                            <Button
                                onClick={() => void model.resolveUnsaved("save")}
                                disabled={model.saving}
                            >
                                {t(UNSAVED_COPY[dialog.intent].save)}
                            </Button>
                        </AlertDialogFooter>
                    </AlertDialogContent>
                </AlertDialog>
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
