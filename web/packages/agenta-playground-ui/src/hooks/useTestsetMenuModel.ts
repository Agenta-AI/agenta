import {useCallback, useMemo, useState} from "react"

import {loadableController} from "@agenta/entities/loadable"
import {testcaseMolecule} from "@agenta/entities/testcase"
import {revisionMolecule} from "@agenta/entities/testset"
import type {CommitSubmitParams, CommitSubmitResult} from "@agenta/entity-ui/modals"
import {playgroundController, type ConnectToTestsetPayload} from "@agenta/playground"
import {
    executionByMessageIdAtomFamily,
    isChatModeAtom,
    resultsByKeyAtomFamily,
    type MessageExecution,
} from "@agenta/playground/state"
import {message} from "@agenta/ui/app-message"
import {atom, useAtomValue, useStore} from "jotai"

/** What "Manage test cases" hands over: rows of the connected revision, or of another one. */
export interface TestsetEditPayload {
    revisionId: string
    testcaseIds: string[]
}

/** The rows the load dialog hands over, with the test set they come from. */
export interface TestsetLoadPayload extends TestsetEditPayload {
    testsetName: string | null
    testsetId: string | null
    revisionVersion: number | null
}

/** The one dialog the test set menu has open, if any. */
export type TestsetMenuDialog =
    | {
          kind: "load"
          /** "Discard & Load": the edits go only once a new test set is confirmed. */
          discardEdits?: boolean
      }
    | {kind: "edit"}
    | {kind: "sync"}
    | {kind: "unsaved"; intent: "disconnect" | "change"}
    | {
          kind: "keep-drafts"
          draftCount: number
          testsetName: string | null
          /** A chat playground loads one test case, so its drafts cannot be kept. */
          chat: boolean
          payload: ConnectToTestsetPayload
          /** Switching the chat test case of the connected test set: its edits go first. */
          discardEdits?: boolean
      }

export interface TestsetMenuModel {
    loadableId: string | null
    /** False until the playground has rows to connect. */
    visible: boolean
    /** The connected test set with its version, else "Test set". */
    label: string
    isConnected: boolean
    hasLocalChanges: boolean
    /** A run has a trace to add to a test set. */
    hasSuccessfulResults: boolean
    isChat: boolean
    connectedRevisionId: string | null
    connectedTestsetId: string | null
    dialog: TestsetMenuDialog | null
    /** A save is in flight: the open dialog must not close. */
    saving: boolean
    connect: () => void
    sync: () => void
    manage: () => void
    change: () => void
    disconnect: () => void
    close: () => void
    confirmLoad: (payload: TestsetLoadPayload) => void
    confirmEdit: (payload: TestsetEditPayload) => void
    confirmKeepDrafts: (keep: boolean) => void
    resolveUnsaved: (choice: "save" | "discard") => Promise<void>
    syncSubmit: (params: CommitSubmitParams) => Promise<CommitSubmitResult>
    canSyncSubmit: (params: {mode?: string; entityName?: string}) => boolean
}

const SAVE_FAILED = "Couldn't save the test set"

const noLoadableAtom = atom(() => null)
const falseAtom = atom(() => false)

const testcaseData = (ids: string[]) =>
    ids.map((id) => {
        const data = testcaseMolecule.get.data(id)
        return data ? {...data} : {id}
    })

/**
 * The test set menu of the playground run pane: what it shows, the one dialog it has open, and
 * every action behind it (connect, manage, change, sync, disconnect). The host renders the menu
 * and the dialog this model asks for.
 */
export const useTestsetMenuModel = (): TestsetMenuModel => {
    const store = useStore()
    const loadableId = useAtomValue(
        useMemo(() => playgroundController.selectors.loadableId(), []),
    ) as string | null

    const connectedSource = useAtomValue(
        useMemo(
            () =>
                loadableId
                    ? loadableController.selectors.connectedSource(loadableId)
                    : noLoadableAtom,
            [loadableId],
        ),
    ) as {id: string | null; name: string | null} | null
    const connectedTestset = useAtomValue(
        useMemo(() => playgroundController.selectors.connectedTestset(), []),
    ) as {id: string | null; name: string | null} | null
    const mode = useAtomValue(
        useMemo(
            () => (loadableId ? loadableController.selectors.mode(loadableId) : noLoadableAtom),
            [loadableId],
        ),
    )
    const hasLocalChanges = useAtomValue(
        useMemo(
            () =>
                loadableId ? loadableController.selectors.hasLocalChanges(loadableId) : falseAtom,
            [loadableId],
        ),
    ) as boolean
    const isChat = useAtomValue(isChatModeAtom) === true
    // "Add to test set" needs a run with a trace. One read of the results, not one per row.
    const hasSuccessfulResults = useAtomValue(
        useMemo(
            () =>
                atom((get) => {
                    if (!loadableId) return false
                    const results = Object.values(get(resultsByKeyAtomFamily(loadableId)))
                    if (results.some((result) => result?.status === "success" && result.traceId)) {
                        return true
                    }
                    if (!get(isChatModeAtom)) return false
                    const executions = get(executionByMessageIdAtomFamily(loadableId)) as Record<
                        string,
                        MessageExecution
                    >
                    return Object.values(executions).some(
                        (execution) => execution?.status === "complete" && !!execution.traceId,
                    )
                }),
            [loadableId],
        ),
    )

    const [dialog, setDialog] = useState<TestsetMenuDialog | null>(null)
    const [saving, setSaving] = useState(false)

    const isConnected = mode === "connected"
    const connectedRevisionId = isConnected ? (connectedSource?.id ?? null) : null
    const label = isConnected && connectedSource?.name ? connectedSource.name : "Test set"
    // A commit reads the test set id from the connected revision: keep that revision loaded.
    useAtomValue(
        useMemo(() => revisionMolecule.queryOptional(connectedRevisionId), [connectedRevisionId]),
    )

    const open = useCallback((next: TestsetMenuDialog) => setDialog(next), [])
    const close = useCallback(() => setDialog(null), [])

    const connect = useCallback(() => open({kind: "load"}), [open])
    const sync = useCallback(() => open({kind: "sync"}), [open])

    const manage = useCallback(() => {
        if (!loadableId || !connectedRevisionId) return
        const shown = store.get(loadableController.selectors.displayRowIds(loadableId))
        store.set(testcaseMolecule.actions.initSelectionDraft, connectedRevisionId, shown)
        open({kind: "edit"})
    }, [connectedRevisionId, loadableId, open, store])

    const change = useCallback(() => {
        open(hasLocalChanges ? {kind: "unsaved", intent: "change"} : {kind: "load"})
    }, [hasLocalChanges, open])

    const disconnect = useCallback(() => {
        if (!loadableId) return
        if (hasLocalChanges) {
            open({kind: "unsaved", intent: "disconnect"})
            return
        }
        store.set(playgroundController.actions.disconnectAndResetToLocal, loadableId)
        close()
    }, [close, hasLocalChanges, loadableId, open, store])

    const confirmLoad = useCallback(
        (payload: TestsetLoadPayload) => {
            if (!loadableId) return
            const connectPayload: ConnectToTestsetPayload = {
                loadableId,
                revisionId: payload.revisionId,
                testcases: testcaseData(payload.testcaseIds),
                testsetName: payload.testsetName ?? "",
                testsetId: payload.testsetId,
                revisionVersion: payload.revisionVersion,
            }
            if (dialog?.kind === "load" && dialog.discardEdits) {
                store.set(loadableController.actions.discardChanges, loadableId)
            }
            // In local mode the server ids must be empty, or stale ids count as draft rows below.
            if (!isConnected) store.set(testcaseMolecule.ids, [])
            const drafts = store.get(loadableController.selectors.meaningfulLocalRows(loadableId))
            if (drafts.length > 0) {
                open({
                    kind: "keep-drafts",
                    draftCount: drafts.length,
                    testsetName: payload.testsetName,
                    chat: isChat,
                    payload: connectPayload,
                })
                return
            }
            store.set(playgroundController.actions.connectToTestset, connectPayload)
            close()
        },
        [close, dialog, isChat, isConnected, loadableId, open, store],
    )

    /** Drops the unsaved edits, then loads the picked chat test case as saved. */
    const switchChatCase = useCallback(
        (payload: ConnectToTestsetPayload) => {
            store.set(loadableController.actions.discardChanges, payload.loadableId)
            store.set(playgroundController.actions.connectToTestset, {
                ...payload,
                testcases: testcaseData(payload.testcases.flatMap(({id}) => (id ? [id] : []))),
            })
        },
        [store],
    )

    const confirmEdit = useCallback(
        (payload: TestsetEditPayload) => {
            if (!loadableId) return
            const shown = store.get(loadableController.selectors.displayRowIds(loadableId))
            const unchanged =
                payload.revisionId === connectedRevisionId &&
                payload.testcaseIds.join() === shown.join()
            // Nothing to change: a reload would drop the chat turns run since the load.
            if (unchanged) {
                close()
                return
            }
            if (payload.revisionId === connectedRevisionId && isChat) {
                // A chat playground holds one test case and its conversation: load the new pick
                // the way a connect does, so the conversation follows it. Unsaved edits would be
                // replaced, so that asks first.
                const switchPayload: ConnectToTestsetPayload = {
                    loadableId,
                    revisionId: payload.revisionId,
                    testcases: payload.testcaseIds.map((id) => ({id})),
                    testsetName: connectedSource?.name ?? "",
                    testsetId: connectedTestset?.id ?? null,
                }
                if (hasLocalChanges) {
                    open({
                        kind: "keep-drafts",
                        draftCount: 1,
                        testsetName: connectedSource?.name ?? null,
                        chat: true,
                        payload: switchPayload,
                        discardEdits: true,
                    })
                    return
                }
                switchChatCase(switchPayload)
            } else if (payload.revisionId === connectedRevisionId) {
                store.set(
                    loadableController.actions.updateTestcaseSelection,
                    loadableId,
                    payload.testcaseIds,
                )
            } else {
                store.set(playgroundController.actions.importTestcases, {
                    loadableId,
                    testcases: testcaseData(payload.testcaseIds),
                })
            }
            close()
        },
        [
            close,
            connectedRevisionId,
            connectedSource?.name,
            connectedTestset?.id,
            hasLocalChanges,
            isChat,
            loadableId,
            open,
            store,
            switchChatCase,
        ],
    )

    const confirmKeepDrafts = useCallback(
        (keep: boolean) => {
            if (dialog?.kind !== "keep-drafts") return
            if (dialog.discardEdits) {
                switchChatCase(dialog.payload)
                close()
                return
            }
            store.set(
                keep && !dialog.chat
                    ? playgroundController.actions.connectToTestsetKeepingLocalRows
                    : playgroundController.actions.connectToTestset,
                dialog.payload,
            )
            close()
        },
        [close, dialog, store, switchChatCase],
    )

    const resolveUnsaved = useCallback(
        async (choice: "save" | "discard") => {
            if (!loadableId || dialog?.kind !== "unsaved" || saving) return
            const changing = dialog.intent === "change"
            if (choice === "discard") {
                if (changing) {
                    open({kind: "load", discardEdits: true})
                    return
                }
                // The edits go first: a disconnect leaves them in the shared test case store.
                store.set(loadableController.actions.discardChanges, loadableId)
                store.set(playgroundController.actions.disconnectAndResetToLocal, loadableId)
                close()
                return
            }
            setSaving(true)
            try {
                await store.set(loadableController.actions.commitChanges, loadableId)
            } catch (error) {
                console.error("Saving the test set failed", error)
                message.error(SAVE_FAILED)
                setSaving(false)
                return
            }
            setSaving(false)
            message.success("Test set updated")
            // Changing the test set keeps the saved one connected until a new one is confirmed.
            if (changing) {
                open({kind: "load"})
                return
            }
            store.set(playgroundController.actions.disconnectAndResetToLocal, loadableId, {
                preserveRows: true,
            })
            close()
        },
        [close, dialog, loadableId, open, saving, store],
    )

    const syncSubmit = useCallback(
        async ({
            message: commitMessage,
            mode: submitMode,
            entityName,
            entitySlug,
        }: CommitSubmitParams) => {
            if (!loadableId) return {success: false, error: SAVE_FAILED}
            if (submitMode !== "save-new") {
                try {
                    await store.set(
                        loadableController.actions.commitChanges,
                        loadableId,
                        commitMessage ?? undefined,
                    )
                    return {success: true}
                } catch (error) {
                    console.error("Committing the test set failed", error)
                    return {success: false, error: SAVE_FAILED}
                }
            }

            const name = entityName?.trim()
            if (!name) return {success: false, error: "Test set name is required"}
            // The rows as shown: the save clears the edits from the store.
            const shownRows = store
                .get(loadableController.selectors.rows(loadableId))
                .map(({data}) => ({...data}))
            store.set(loadableController.actions.setName, loadableId, name)
            const result = await store.set(
                loadableController.actions.saveAsNewTestset,
                loadableId,
                {
                    commitMessage: commitMessage ?? undefined,
                    slug: entitySlug,
                },
            )
            if (!result.success || !result.revisionId) {
                console.error("Saving as a new test set failed", result.error)
                store.set(loadableController.actions.setName, loadableId, null)
                const status = (result.error as {response?: {status?: number}} | undefined)
                    ?.response?.status
                return {success: false, error: SAVE_FAILED, errorStatus: status}
            }
            store.set(loadableController.actions.setName, loadableId, null)
            // The playground moves to the new test set. If its rows do not all load, they stay in
            // the playground as local rows instead: the new test set is saved either way.
            await store.set(playgroundController.actions.restoreLoadableConnection, {
                revisionId: result.revisionId,
                sourceName: name,
                testsetId: result.testsetId ?? null,
            })
            const loaded = store.get(loadableController.selectors.displayRowIds(loadableId))
            // A chat playground loads one test case.
            const expected = isChat ? Math.min(shownRows.length, 1) : shownRows.length
            if (loaded.length !== expected) {
                console.error("Loading the new test set into the playground failed")
                store.set(loadableController.actions.disconnect, loadableId)
                store.set(playgroundController.actions.importTestcases, {
                    loadableId,
                    testcases: shownRows,
                })
            }
            return {success: true}
        },
        [isChat, loadableId, store],
    )

    const canSyncSubmit = useCallback(
        ({mode: submitMode, entityName}: {mode?: string; entityName?: string}) =>
            submitMode !== "save-new" || Boolean(entityName?.trim()),
        [],
    )

    return {
        loadableId,
        visible: !!loadableId,
        label,
        isConnected,
        hasLocalChanges,
        hasSuccessfulResults,
        isChat,
        connectedRevisionId,
        connectedTestsetId: isConnected ? (connectedTestset?.id ?? null) : null,
        dialog,
        saving,
        connect,
        sync,
        manage,
        change,
        disconnect,
        close,
        confirmLoad,
        confirmEdit,
        confirmKeepDrafts,
        resolveUnsaved,
        syncSubmit,
        canSyncSubmit,
    }
}
