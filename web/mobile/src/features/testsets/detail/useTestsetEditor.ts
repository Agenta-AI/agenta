import {useCallback, useEffect, useMemo, useState} from "react"

import {testcaseDataController, testcaseMolecule} from "@agenta/entities/testcase"
import type {TestcaseDataConfig} from "@agenta/entities/testcase"
import {
    changesSummaryAtom,
    clearChangesAtom,
    fetchRevisionWithTestcases,
    hasUnsavedChangesAtom,
    revisionMolecule,
    saveNewTestsetAtom,
    saveTestsetAtom,
    testsetRevisionHeaderAtomFamily,
    type TestsetRevisionHeader,
    type TestsetRevisionHeaderState,
} from "@agenta/entities/testset"
import {message} from "@agenta/ui/app-message"
import {atom, useAtomValue, useSetAtom, useStore} from "jotai"

import {isTestsetRouteId, NEW_TESTSET_ROUTE_ID} from "./testsetRouteId"

const IDLE_HEADER = atom<TestsetRevisionHeaderState>({data: null, isPending: false, isError: false})

const SAVE_FAILED = "Failed to save changes"

/** Why a column name was refused. An unchanged rename is not an error: it changes nothing. */
export type ColumnNameRefusal = "empty" | "duplicate" | "unchanged"
/** Why a column change was not made, with the sentence that tells the reader. */
export type ColumnChangeFailure = "rowChanges" | "columnsUnknown" | "failed"
/**
 * The result of a column change. On a saved test set the change is saved at once as a new
 * version, and `revisionId` is that version, for the page to open. On a new test set nothing is
 * saved yet and `revisionId` is null.
 */
export type ColumnEdit =
    | {ok: true; revisionId: string | null}
    | {ok: false; reason: ColumnNameRefusal}
    | {ok: false; reason: ColumnChangeFailure; message: string}

const ROW_CHANGES_FIRST = "Save or discard your row changes first"
const COLUMNS_UNKNOWN = "Could not check the column names. Try again."

type ColumnChange =
    | {kind: "add"; columnKey: string}
    | {kind: "rename"; oldKey: string; newKey: string}
    | {kind: "remove"; columnKey: string}

const columnSavedMessage = (change: ColumnChange) =>
    change.kind === "add"
        ? `Added column "${change.columnKey}" and saved a new version`
        : change.kind === "rename"
          ? `Renamed column "${change.oldKey}" to "${change.newKey}" and saved a new version`
          : `Deleted column "${change.columnKey}" and saved a new version`

/**
 * Every column name in the saved revision. The table reads its columns from the first rows
 * only, so a name used only by later rows is found here and nowhere else.
 */
const savedColumnKeys = async (projectId: string, revisionId: string): Promise<Set<string>> => {
    const revision = await fetchRevisionWithTestcases({id: revisionId, projectId})
    if (!revision) throw new Error("The revision was not found")
    const ids = revision.data?.testcase_ids
    const testcases = revision.data?.testcases ?? (ids?.length === 0 ? [] : null)
    // Every row must be here: a missing row could hold the name being checked.
    if (!Array.isArray(testcases) || (ids && ids.length !== testcases.length)) {
        throw new Error("The revision did not return all its testcases")
    }
    const keys = new Set<string>()
    for (const testcase of testcases) {
        const data = (testcase as {data?: Record<string, unknown> | null}).data
        if (data) for (const key of Object.keys(data)) keys.add(key)
    }
    return keys
}

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
    const store = useStore()
    const [isSaving, setIsSaving] = useState(false)

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

    // A column change on a saved test set is saved at once, alone. Mixed with unsaved row edits
    // in one commit, the server applies it to rows the page has not loaded and the row edits
    // can bring back or drop values. So column changes wait until the rows are saved.
    const columnEditBlocked = !isNew && hasUnsavedChanges ? ROW_CHANGES_FIRST : null

    /**
     * Rewrites the unsaved rows of a new test set for a column change. A new test set has no
     * saved rows, so its rows hold every value and the change is made in them directly.
     */
    const rewriteNewRows = useCallback(
        (rewrite: (data: Record<string, unknown>) => Record<string, unknown> | null) => {
            for (const id of store.get(testcaseMolecule.newIds)) {
                const data = store.get(testcaseMolecule.atoms.draft(id))?.data
                const updates = data ? rewrite(data) : null
                if (updates) store.set(testcaseMolecule.actions.update, id, {data: updates})
            }
        },
        [store],
    )

    /** Makes the change on a new test set: in the column list and in every unsaved row. */
    const changeNewColumns = useCallback(
        (change: ColumnChange) => {
            const ops = store.get(revisionMolecule.atoms.pendingColumnOps(routeId))
            if (change.kind === "add") {
                addColumnReducer({revisionId: routeId, columnKey: change.columnKey})
                return
            }
            if (change.kind === "remove") {
                removeColumnReducer({revisionId: routeId, columnKey: change.columnKey})
                rewriteNewRows((data) =>
                    change.columnKey in data ? {[change.columnKey]: undefined} : null,
                )
                return
            }
            const {oldKey, newKey} = change
            if (ops.add.includes(oldKey)) {
                renameColumnReducer({revisionId: routeId, oldKey, newKey})
            } else {
                addColumnReducer({revisionId: routeId, columnKey: newKey})
            }
            rewriteNewRows((data) =>
                oldKey in data ? {[oldKey]: undefined, [newKey]: data[oldKey]} : null,
            )
        },
        [
            addColumnReducer,
            removeColumnReducer,
            renameColumnReducer,
            rewriteNewRows,
            routeId,
            store,
        ],
    )

    /**
     * Saves one column change on a saved test set as a new version, with no row in it.
     * A failure drops the change, so it is never sent later with row edits.
     */
    const saveColumnChange = useCallback(
        async (change: ColumnChange): Promise<ColumnEdit> => {
            if (!revisionId) return {ok: false, reason: "failed", message: SAVE_FAILED}
            if (store.get(hasUnsavedChangesAtom)) {
                return {ok: false, reason: "rowChanges", message: ROW_CHANGES_FIRST}
            }
            setIsSaving(true)
            try {
                if (change.kind !== "remove") {
                    let saved: Set<string>
                    try {
                        saved = await savedColumnKeys(projectId, revisionId)
                    } catch (cause) {
                        console.error("Reading the test set columns failed", cause)
                        return {ok: false, reason: "columnsUnknown", message: COLUMNS_UNKNOWN}
                    }
                    const name = change.kind === "add" ? change.columnKey : change.newKey
                    if (saved.has(name)) return {ok: false, reason: "duplicate"}
                }
                // A row edit made while the names were read waits for its own save.
                if (store.get(hasUnsavedChangesAtom)) {
                    return {ok: false, reason: "rowChanges", message: ROW_CHANGES_FIRST}
                }
                if (change.kind === "add") {
                    addColumnReducer({revisionId, columnKey: change.columnKey})
                } else if (change.kind === "rename") {
                    renameColumnReducer({revisionId, oldKey: change.oldKey, newKey: change.newKey})
                } else {
                    removeColumnReducer({revisionId, columnKey: change.columnKey})
                }
                const result = await saveSaved({
                    projectId,
                    testsetId: header?.testsetId ?? "",
                    revisionId,
                })
                if (!result.success || !result.newRevisionId) {
                    clearChanges()
                    if (result.error) console.error("Saving the column change failed", result.error)
                    message.error(SAVE_FAILED)
                    return {ok: false, reason: "failed", message: SAVE_FAILED}
                }
                message.success(columnSavedMessage(change))
                return {ok: true, revisionId: result.newRevisionId}
            } catch (cause) {
                clearChanges()
                console.error("Saving the column change failed", cause)
                message.error(SAVE_FAILED)
                return {ok: false, reason: "failed", message: SAVE_FAILED}
            } finally {
                setIsSaving(false)
            }
        },
        [
            addColumnReducer,
            clearChanges,
            header?.testsetId,
            projectId,
            removeColumnReducer,
            renameColumnReducer,
            revisionId,
            saveSaved,
            store,
        ],
    )

    const applyColumnChange = useCallback(
        async (change: ColumnChange): Promise<ColumnEdit> => {
            if (isNew) {
                changeNewColumns(change)
                return {ok: true, revisionId: null}
            }
            return saveColumnChange(change)
        },
        [changeNewColumns, isNew, saveColumnChange],
    )

    /** The column names the page knows without a request: the loaded rows and new columns. */
    const loadedColumnKeys = useCallback((): Set<string> => {
        const keys = new Set(columns.map((column) => column.key))
        for (const key of store.get(revisionMolecule.atoms.pendingColumnOps(routeId)).add) {
            keys.add(key)
        }
        return keys
    }, [columns, routeId, store])

    const addColumn = useCallback(
        async (name: string): Promise<ColumnEdit> => {
            const columnKey = name.trim()
            if (!columnKey) return {ok: false, reason: "empty"}
            if (loadedColumnKeys().has(columnKey)) return {ok: false, reason: "duplicate"}
            return applyColumnChange({kind: "add", columnKey})
        },
        [applyColumnChange, loadedColumnKeys],
    )

    const renameColumn = useCallback(
        async (oldKey: string, name: string): Promise<ColumnEdit> => {
            const newKey = name.trim()
            if (!newKey) return {ok: false, reason: "empty"}
            if (newKey === oldKey) return {ok: false, reason: "unchanged"}
            if (loadedColumnKeys().has(newKey)) return {ok: false, reason: "duplicate"}
            return applyColumnChange({kind: "rename", oldKey, newKey})
        },
        [applyColumnChange, loadedColumnKeys],
    )

    const deleteColumn = useCallback(
        (columnKey: string): Promise<ColumnEdit> => applyColumnChange({kind: "remove", columnKey}),
        [applyColumnChange],
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
        deleteColumn,
        columnEditBlocked,
        discard,
        commit,
        isSaving,
    }
}

export type TestsetEditor = ReturnType<typeof useTestsetEditor>
