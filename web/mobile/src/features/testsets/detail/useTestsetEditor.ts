import {useCallback, useEffect, useMemo, useRef, useState} from "react"

import {testcaseDataController, testcaseMolecule} from "@agenta/entities/testcase"
import type {TestcaseDataConfig} from "@agenta/entities/testcase"
import {
    changesSummaryAtom,
    clearChangesAtom,
    fetchRevisionWithTestcases,
    hasUnsavedChangesAtom,
    invalidateRevisionsListCache,
    invalidateTestsetCache,
    invalidateTestsetsListCache,
    patchRevision,
    revisionMolecule,
    saveNewTestsetAtom,
    saveTestsetAtom,
    testsetRevisionHeaderAtomFamily,
    type TestsetRevisionDeltaColumns,
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
export type ColumnChangeFailure = "rowChanges" | "saving" | "columnsUnknown" | "noRows" | "failed"
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
const ADD_A_ROW_FIRST = "Add a row first, then add columns"
const SAVE_RUNNING = "Wait for the current save to finish"

type ColumnChange =
    | {kind: "add"; columnKey: string}
    | {kind: "rename"; oldKey: string; newKey: string}
    | {kind: "remove"; columnKeys: string[]}

const columnSavedMessage = (change: ColumnChange) =>
    change.kind === "add"
        ? `Added column "${change.columnKey}" and saved a new version`
        : change.kind === "rename"
          ? `Renamed column "${change.oldKey}" to "${change.newKey}" and saved a new version`
          : change.columnKeys.length === 1
            ? `Deleted column "${change.columnKeys[0]}" and saved a new version`
            : `Deleted ${change.columnKeys.length} columns and saved a new version`

/** The commit delta of one column change, as the server applies it to every row. */
const columnDelta = (change: ColumnChange): TestsetRevisionDeltaColumns =>
    change.kind === "add"
        ? {add: [change.columnKey]}
        : change.kind === "rename"
          ? {replace: [[change.oldKey, change.newKey]]}
          : {remove: change.columnKeys}

const isPlainObject = (value: unknown): value is Record<string, unknown> =>
    typeof value === "object" && value !== null && !Array.isArray(value)

/**
 * Adds every column name a row holds to `keys`: each key, and for a nested object each dotted
 * path, because the table shows `{parent: {child}}` as the column `parent.child`.
 */
const addColumnPaths = (keys: Set<string>, data: Record<string, unknown>, prefix = "") => {
    for (const [key, value] of Object.entries(data)) {
        if (value === undefined) continue
        const path = prefix ? `${prefix}.${key}` : key
        keys.add(path)
        if (isPlainObject(value)) addColumnPaths(keys, value, path)
    }
}

/**
 * Every column name in the saved revision, and whether it has rows. The table reads its
 * columns from the first rows only, so a name used only by later rows is found here and
 * nowhere else.
 */
const savedColumns = async (
    projectId: string,
    revisionId: string,
): Promise<{keys: Set<string>; hasRows: boolean}> => {
    const revision = await fetchRevisionWithTestcases({id: revisionId, projectId})
    if (!revision) throw new Error("The revision was not found")
    const keys = new Set<string>()
    const ids = revision.data?.testcase_ids
    const testcases = revision.data?.testcases
    // A revision with no rows has no names beyond the ones the page knows.
    if (!ids?.length && !testcases?.length) return {keys, hasRows: false}
    // Every row must be here: a missing row could hold the name being checked.
    if (!Array.isArray(testcases) || (ids && ids.length !== testcases.length)) {
        throw new Error("The revision did not return all its testcases")
    }
    for (const testcase of testcases) {
        const data = (testcase as {data?: Record<string, unknown> | null}).data
        if (data) addColumnPaths(keys, data)
    }
    return {keys, hasRows: true}
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
/** Path parts that would write into an object's prototype instead of the row. */
const UNSAFE_PARTS: ReadonlySet<string> = new Set(["__proto__", "constructor", "prototype"])

/**
 * The first row of a new test set, as in the old app: the columns `input` and `correct_answer`,
 * empty. Columns come from row data, so without a row a new test set has no column to fill in.
 */
export const NEW_TESTSET_STARTER_ROW: Readonly<Record<string, string>> = {
    input: "",
    correct_answer: "",
}

/**
 * The data of a new row: "" at each column's path. A column read from row data carries its path
 * (`["meta.lang", "source"]` stays `{"meta.lang": {source: ""}}`). A column with no path (added
 * in the grid) follows its parent: `inputs.question` with the parent `inputs` gives
 * `{inputs: {question: ""}}`, and a top-level `meta.lang` stays one key. A column with an unsafe
 * path part is left out.
 */
export function emptyRowData(
    columns: readonly {key: string; parentKey?: string; path?: string[]}[],
): Record<string, unknown> {
    const data: Record<string, unknown> = {}
    for (const {key, parentKey, path: columnPath} of columns) {
        const path =
            columnPath && columnPath.length > 0
                ? columnPath
                : parentKey
                  ? [...parentKey.split("."), key.slice(parentKey.length + 1)]
                  : [key]
        if (path.some((part) => UNSAFE_PARTS.has(part))) continue
        let node = data
        for (const part of path.slice(0, -1)) {
            const next = Object.hasOwn(node, part) ? node[part] : undefined
            node = (next && typeof next === "object" ? next : (node[part] = {})) as Record<
                string,
                unknown
            >
        }
        node[path[path.length - 1]] = ""
    }
    return data
}

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

    const store = useStore()
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

    // A new test set opens with the starter row. It runs after the effect above, so a change of
    // page, which clears the session first, still ends with the row in place.
    const addRowAtom = useSetAtom(testcaseMolecule.actions.add)
    useEffect(() => {
        if (!isNew || store.get(testcaseMolecule.newIds).length > 0) return
        addRowAtom({data: {...NEW_TESTSET_STARTER_ROW}})
    }, [addRowAtom, isNew, store])

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

    const deleteRowsAtom = useSetAtom(testcaseMolecule.actions.delete)
    const addColumnReducer = useSetAtom(revisionMolecule.tableReducers.addColumn)
    const renameColumnReducer = useSetAtom(revisionMolecule.tableReducers.renameColumn)
    const removeColumnReducer = useSetAtom(revisionMolecule.tableReducers.removeColumn)
    const discardRevisionDraft = useSetAtom(revisionMolecule.actions.discard)
    const saveSaved = useSetAtom(saveTestsetAtom)
    const saveNew = useSetAtom(saveNewTestsetAtom)
    const [isSaving, setIsSaving] = useState(false)
    // One save at a time. The ref, not the state, answers a second click in the same render.
    const savingRef = useRef(false)

    /** Starts a save, or returns false when one is already running. */
    const startSave = useCallback((): boolean => {
        if (savingRef.current) return false
        savingRef.current = true
        setIsSaving(true)
        return true
    }, [])
    const endSave = useCallback(() => {
        savingRef.current = false
        setIsSaving(false)
    }, [])

    // A new row starts with an empty value for each column. The row drawer shows the row data,
    // so a row with no keys would give the user no field to fill in.
    const addRow = useCallback((): string | null => {
        if (savingRef.current) return null
        return addRowAtom({data: emptyRowData(columns)})?.id ?? null
    }, [addRowAtom, columns])

    const deleteRows = useCallback(
        (ids: string[]) => {
            if (!savingRef.current && ids.length > 0) deleteRowsAtom(ids)
        },
        [deleteRowsAtom],
    )

    // A column change on a saved test set is saved at once, alone. Mixed with unsaved row edits
    // in one commit, the server applies it to rows the page has not loaded and the row edits
    // can bring back or drop values. So column changes wait until the rows are saved.
    const columnEditBlocked = isSaving
        ? SAVE_RUNNING
        : !isNew && hasUnsavedChanges
          ? ROW_CHANGES_FIRST
          : null

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

    /**
     * Makes the change on a new test set: in the column list and in every unsaved row.
     * A name that comes back after a delete leaves the delete list first, or the save drops it.
     */
    const changeNewColumns = useCallback(
        (change: ColumnChange) => {
            const ops = store.get(revisionMolecule.atoms.pendingColumnOps(routeId))
            const name = change.kind === "add" ? change.columnKey : null
            const target = change.kind === "rename" ? change.newKey : name
            // On a deleted name the add reducer only takes the name out of the delete list.
            if (target && ops.remove.includes(target)) {
                addColumnReducer({revisionId: routeId, columnKey: target})
            }
            if (change.kind === "add") {
                addColumnReducer({revisionId: routeId, columnKey: change.columnKey})
                return
            }
            if (change.kind === "remove") {
                for (const columnKey of change.columnKeys) {
                    removeColumnReducer({revisionId: routeId, columnKey})
                    rewriteNewRows((data) => (columnKey in data ? {[columnKey]: undefined} : null))
                }
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
     * The commit is built from the change alone, before any request, so no row edit can join
     * it, and nothing is staged in the edit state, so a failure leaves nothing behind.
     */
    const saveColumnChange = useCallback(
        async (change: ColumnChange): Promise<ColumnEdit> => {
            const testsetId = header?.testsetId
            if (!revisionId || !testsetId) {
                return {ok: false, reason: "failed", message: SAVE_FAILED}
            }
            if (store.get(hasUnsavedChangesAtom)) {
                return {ok: false, reason: "rowChanges", message: ROW_CHANGES_FIRST}
            }
            const operations = {columns: columnDelta(change)}
            try {
                // The server applies a column change to existing rows only, so a revision
                // with no rows would report success and save nothing.
                let saved: {keys: Set<string>; hasRows: boolean}
                try {
                    saved = await savedColumns(projectId, revisionId)
                } catch (cause) {
                    console.error("Reading the test set columns failed", cause)
                    return {ok: false, reason: "columnsUnknown", message: COLUMNS_UNKNOWN}
                }
                if (!saved.hasRows) return {ok: false, reason: "noRows", message: ADD_A_ROW_FIRST}
                if (change.kind !== "remove") {
                    const name = change.kind === "add" ? change.columnKey : change.newKey
                    if (saved.keys.has(name)) return {ok: false, reason: "duplicate"}
                }
                // A row edit made while the names were read waits for its own save.
                if (store.get(hasUnsavedChangesAtom)) {
                    return {ok: false, reason: "rowChanges", message: ROW_CHANGES_FIRST}
                }
                const response = await patchRevision({
                    projectId,
                    testsetId,
                    operations,
                    baseRevisionId: revisionId,
                })
                const newRevisionId = response?.testset_revision?.id
                if (typeof newRevisionId !== "string" || !newRevisionId) {
                    throw new Error("No revision returned from the commit")
                }
                invalidateTestsetCache(testsetId)
                invalidateRevisionsListCache(testsetId)
                invalidateTestsetsListCache()
                message.success(columnSavedMessage(change))
                return {ok: true, revisionId: newRevisionId}
            } catch (cause) {
                console.error("Saving the column change failed", cause)
                message.error(SAVE_FAILED)
                return {ok: false, reason: "failed", message: SAVE_FAILED}
            }
        },
        [header?.testsetId, projectId, revisionId, store],
    )

    const applyColumnChange = useCallback(
        async (change: ColumnChange): Promise<ColumnEdit> => {
            if (isNew) {
                if (savingRef.current) return {ok: false, reason: "saving", message: SAVE_RUNNING}
                changeNewColumns(change)
                return {ok: true, revisionId: null}
            }
            if (!startSave()) return {ok: false, reason: "saving", message: SAVE_RUNNING}
            try {
                return await saveColumnChange(change)
            } finally {
                endSave()
            }
        },
        [changeNewColumns, endSave, isNew, saveColumnChange, startSave],
    )

    /**
     * The column names the page knows without a request: the loaded columns, new columns and
     * every unsaved row. On a new test set the unsaved rows are all the rows.
     */
    const loadedColumnKeys = useCallback((): Set<string> => {
        const keys = new Set(columns.map((column) => column.key))
        for (const key of store.get(revisionMolecule.atoms.pendingColumnOps(routeId)).add) {
            keys.add(key)
        }
        for (const id of store.get(testcaseMolecule.newIds)) {
            const data = store.get(testcaseMolecule.atoms.draft(id))?.data
            if (data) addColumnPaths(keys, data)
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

    /**
     * Deletes columns in one change. The keys are top-level row keys: the server removes those
     * only, so a group of nested values is deleted by its top-level key.
     */
    const deleteColumns = useCallback(
        (columnKeys: string[]): Promise<ColumnEdit> =>
            applyColumnChange({kind: "remove", columnKeys}),
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
            if (!startSave()) return null
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
                endSave()
            }
        },
        [
            endSave,
            header?.testsetId,
            header?.testsetName,
            isNew,
            projectId,
            revisionId,
            saveNew,
            saveSaved,
            startSave,
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
        deleteColumns,
        columnEditBlocked,
        discard,
        commit,
        isSaving,
        /** True while a save runs: rows, columns and every action stay as they are. */
        readOnly: isSaving,
    }
}

export type TestsetEditor = ReturnType<typeof useTestsetEditor>
