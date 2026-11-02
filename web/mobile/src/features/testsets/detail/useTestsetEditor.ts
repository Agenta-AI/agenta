import {useCallback, useEffect, useMemo, useState} from "react"

import {testcaseDataController, testcaseMolecule} from "@agenta/entities/testcase"
import type {TestcaseDataConfig} from "@agenta/entities/testcase"
import {
    changesSummaryAtom,
    clearChangesAtom,
    hasUnsavedChangesAtom,
    revisionMolecule,
    saveNewTestsetAtom,
    saveTestsetAtom,
    testsetRevisionHeaderAtomFamily,
    type TestsetRevisionHeader,
    type TestsetRevisionHeaderState,
} from "@agenta/entities/testset"
import {message} from "@agenta/ui/app-message"
import {atom, useAtomValue, useSetAtom} from "jotai"

import {isTestsetRouteId, NEW_TESTSET_ROUTE_ID} from "./testsetRouteId"

const IDLE_HEADER = atom<TestsetRevisionHeaderState>({data: null, isPending: false, isError: false})

const SAVE_FAILED = "Failed to save changes"

/** Why a column name was refused. An unchanged rename is not an error: it changes nothing. */
export type ColumnNameRefusal = "empty" | "duplicate" | "unchanged"
/**
 * Why a column edit waits for a save. Renames stay simple until the next save: a column is
 * renamed at most once, a column added in this session is not renamed, and the old and new
 * names of a pending rename are not used again. The save state supports only these cases.
 */
export type ColumnEditUntilSave = "renamed" | "added" | "pendingRenameName"
export type ColumnEdit =
    | {ok: true}
    | {ok: false; reason: ColumnNameRefusal}
    | {ok: false; reason: ColumnEditUntilSave; message: string}

const RENAMED_MESSAGE = "Save first to rename this column again"
const ADDED_MESSAGE =
    "Save first to rename a new column, or delete it and add it again with the new name"
const pendingRenameNameMessage = (name: string, rename: {oldKey: string; newKey: string}) =>
    `The name "${name}" is part of the unsaved rename of "${rename.oldKey}" to "${rename.newKey}". Save first to use it.`

/**
 * The edit session of one test set page, over the package state.
 *
 * Rows go through `testcaseMolecule` and columns through `revisionMolecule.tableReducers`,
 * because `saveTestsetAtom` reads the first for rows and the second for columns. A column edit
 * made through the testcase store alone is lost on commit.
 *
 * `routeId` is a revision id or `new`. An id that is neither reports `notFound` and touches
 * nothing. The session state lives in global atoms, so it is cleared when the page closes.
 */
export function useTestsetEditor({
    projectId,
    routeId,
    nameFromUrl,
}: {
    projectId: string
    routeId: string
    /** The name of a new test set, from `?name=`. Used only when `routeId` is `new`. */
    nameFromUrl: string | null
}) {
    const isNew = routeId === NEW_TESTSET_ROUTE_ID
    const notFound = !isTestsetRouteId(routeId)
    const revisionId = isNew || notFound ? null : routeId

    const headerState = useAtomValue(
        revisionId ? testsetRevisionHeaderAtomFamily(revisionId) : IDLE_HEADER,
    )
    const header = useMemo<TestsetRevisionHeader | null>(
        () =>
            isNew
                ? {
                      testsetId: "",
                      testsetName: nameFromUrl?.trim() ?? "",
                      testsetSlug: undefined,
                      description: undefined,
                      revisionSlug: undefined,
                      revisionVersion: undefined,
                      commitMessage: undefined,
                      author: undefined,
                      createdAt: undefined,
                      updatedAt: undefined,
                  }
                : headerState.data,
        [headerState.data, isNew, nameFromUrl],
    )

    // The table reads this config; the editor reads the same rows to know which ones exist on
    // the server.
    const tableConfig = useMemo<TestcaseDataConfig>(
        () => ({scopeId: `testset-detail-${routeId}`, revisionId: routeId, includeNewRows: true}),
        [routeId],
    )

    const setRevisionContext = useSetAtom(testcaseMolecule.actions.setRevisionContext)
    const clearChanges = useSetAtom(clearChangesAtom)
    const setServerIds = useSetAtom(testcaseMolecule.ids)
    useEffect(() => {
        if (notFound) return
        setRevisionContext(routeId)
        return () => {
            clearChanges()
            setServerIds([])
            setRevisionContext(null)
        }
    }, [clearChanges, notFound, routeId, setRevisionContext, setServerIds])

    // `saveTestsetAtom` and the changes summary look for edited server rows in this list, and
    // the paginated table does not fill it. Without it an edit to a saved row is never sent.
    const rows = useAtomValue(testcaseDataController.selectors.rows(tableConfig))
    const serverIds = useMemo(
        () => rows.filter((row) => !row.__isNew && !row.__isSkeleton).map((row) => row.id),
        [rows],
    )
    useEffect(() => {
        if (!notFound) setServerIds(serverIds)
    }, [notFound, serverIds, setServerIds])

    const columns = useAtomValue(testcaseDataController.selectors.columns(tableConfig))
    const pendingOps = useAtomValue(revisionMolecule.atoms.pendingColumnOps(routeId))
    const changesSummary = useAtomValue(changesSummaryAtom)
    const hasUnsavedChanges = useAtomValue(hasUnsavedChangesAtom)

    const addRowAtom = useSetAtom(testcaseMolecule.actions.add)
    const deleteRowsAtom = useSetAtom(testcaseMolecule.actions.delete)
    const addColumnReducer = useSetAtom(revisionMolecule.tableReducers.addColumn)
    const renameColumnReducer = useSetAtom(revisionMolecule.tableReducers.renameColumn)
    const removeColumnReducer = useSetAtom(revisionMolecule.tableReducers.removeColumn)
    const discardRevisionDraft = useSetAtom(revisionMolecule.actions.discard)
    const saveSaved = useSetAtom(saveTestsetAtom)
    const saveNew = useSetAtom(saveNewTestsetAtom)
    const [isSaving, setIsSaving] = useState(false)

    const knownColumnKeys = useCallback((): Set<string> => {
        const keys = new Set(columns.map((column) => column.key))
        for (const key of pendingOps.add) keys.add(key)
        return keys
    }, [columns, pendingOps.add])

    const addRow = useCallback(
        (): string | null => addRowAtom({data: {}})?.id ?? null,
        [addRowAtom],
    )

    const deleteRows = useCallback(
        (ids: string[]) => {
            if (ids.length > 0) deleteRowsAtom(ids)
        },
        [deleteRowsAtom],
    )

    /** The pending rename that uses `name` as its old or new name, if any. */
    const renameUsingName = useCallback(
        (name: string) =>
            pendingOps.rename.find((rename) => rename.oldKey === name || rename.newKey === name),
        [pendingOps.rename],
    )

    /** Why the column cannot be renamed before the next save, or null when it can. */
    const renameRefusal = useCallback(
        (columnKey: string): ColumnEdit | null => {
            if (pendingOps.add.includes(columnKey)) {
                return {ok: false, reason: "added", message: ADDED_MESSAGE}
            }
            if (pendingOps.rename.some((rename) => rename.newKey === columnKey)) {
                return {ok: false, reason: "renamed", message: RENAMED_MESSAGE}
            }
            return null
        },
        [pendingOps.add, pendingOps.rename],
    )

    /** The sentence that says why a rename is turned off for the column, or null. */
    const renameBlocked = useCallback(
        (columnKey: string): string | null => {
            const refusal = renameRefusal(columnKey)
            return refusal && "message" in refusal ? refusal.message : null
        },
        [renameRefusal],
    )

    const addColumn = useCallback(
        (name: string): ColumnEdit => {
            const columnKey = name.trim()
            if (!columnKey) return {ok: false, reason: "empty"}
            if (knownColumnKeys().has(columnKey)) return {ok: false, reason: "duplicate"}
            const rename = renameUsingName(columnKey)
            if (rename) {
                return {
                    ok: false,
                    reason: "pendingRenameName",
                    message: pendingRenameNameMessage(columnKey, rename),
                }
            }
            addColumnReducer({revisionId: routeId, columnKey})
            return {ok: true}
        },
        [addColumnReducer, knownColumnKeys, renameUsingName, routeId],
    )

    const renameColumn = useCallback(
        (oldKey: string, name: string): ColumnEdit => {
            const blocked = renameRefusal(oldKey)
            if (blocked) return blocked
            const newKey = name.trim()
            if (!newKey) return {ok: false, reason: "empty"}
            if (newKey === oldKey) return {ok: false, reason: "unchanged"}
            if (knownColumnKeys().has(newKey)) return {ok: false, reason: "duplicate"}
            const rename = renameUsingName(newKey)
            if (rename) {
                return {
                    ok: false,
                    reason: "pendingRenameName",
                    message: pendingRenameNameMessage(newKey, rename),
                }
            }
            renameColumnReducer({revisionId: routeId, oldKey, newKey})
            return {ok: true}
        },
        [knownColumnKeys, renameColumnReducer, renameRefusal, renameUsingName, routeId],
    )

    const deleteColumn = useCallback(
        (columnKey: string) => removeColumnReducer({revisionId: routeId, columnKey}),
        [removeColumnReducer, routeId],
    )

    /** Drops every unsaved row, column and edit, and the draft of the revision itself. */
    const discard = useCallback(() => {
        clearChanges()
        if (revisionId) discardRevisionDraft(revisionId)
    }, [clearChanges, discardRevisionDraft, revisionId])

    /**
     * Saves the changes as a new revision, or creates the test set when it is new.
     * Returns the id of the revision to open, or null when nothing was saved. A failure keeps
     * every change and tells the reader in one fixed sentence; the cause goes to the console.
     */
    const commit = useCallback(
        async (commitMessage: string): Promise<string | null> => {
            if (isSaving) return null
            setIsSaving(true)
            try {
                const note = commitMessage.trim() || undefined
                let savedRevisionId: string | null = null
                let failure: Error | undefined
                if (isNew) {
                    const result = await saveNew({
                        projectId,
                        testsetName: header?.testsetName ?? "",
                        commitMessage: note,
                    })
                    savedRevisionId = result.success ? (result.revisionId ?? null) : null
                    failure = result.error
                } else {
                    const result = await saveSaved({
                        projectId,
                        testsetId: header?.testsetId ?? "",
                        revisionId,
                        commitMessage: note,
                    })
                    savedRevisionId = result.success ? (result.newRevisionId ?? null) : null
                    failure = result.error
                }
                if (!savedRevisionId) {
                    if (failure) console.error("Committing the test set failed", failure)
                    message.error(SAVE_FAILED)
                    return null
                }
                message.success("Changes saved successfully!")
                return savedRevisionId
            } catch (cause) {
                console.error("Committing the test set failed", cause)
                message.error(SAVE_FAILED)
                return null
            } finally {
                setIsSaving(false)
            }
        },
        [
            header?.testsetId,
            header?.testsetName,
            isNew,
            isSaving,
            projectId,
            revisionId,
            saveNew,
            saveSaved,
        ],
    )

    return {
        header,
        isNew,
        notFound,
        isPending: !notFound && !isNew && headerState.isPending,
        isError: !notFound && !isNew && headerState.isError,
        tableConfig,
        hasUnsavedChanges,
        changesSummary,
        addRow,
        deleteRows,
        addColumn,
        renameColumn,
        renameBlocked,
        deleteColumn,
        discard,
        commit,
        isSaving,
    }
}

export type TestsetEditor = ReturnType<typeof useTestsetEditor>
