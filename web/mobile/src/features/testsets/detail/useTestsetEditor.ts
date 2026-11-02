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
export type ColumnEdit = {ok: true} | {ok: false; reason: ColumnNameRefusal}

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
    const serverIdsKey = rows
        .filter((row) => !row.__isNew && !row.__isSkeleton)
        .map((row) => row.id)
        .join("\n")
    useEffect(() => {
        if (notFound) return
        setServerIds(serverIdsKey ? serverIdsKey.split("\n") : [])
    }, [notFound, serverIdsKey, setServerIds])

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

    const addColumn = useCallback(
        (name: string): ColumnEdit => {
            const columnKey = name.trim()
            if (!columnKey) return {ok: false, reason: "empty"}
            if (knownColumnKeys().has(columnKey)) return {ok: false, reason: "duplicate"}
            addColumnReducer({revisionId: routeId, columnKey})
            return {ok: true}
        },
        [addColumnReducer, knownColumnKeys, routeId],
    )

    const renameColumn = useCallback(
        (oldKey: string, name: string): ColumnEdit => {
            const newKey = name.trim()
            if (!newKey) return {ok: false, reason: "empty"}
            if (newKey === oldKey) return {ok: false, reason: "unchanged"}
            if (knownColumnKeys().has(newKey)) return {ok: false, reason: "duplicate"}
            renameColumnReducer({revisionId: routeId, oldKey, newKey})
            return {ok: true}
        },
        [knownColumnKeys, renameColumnReducer, routeId],
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
        deleteColumn,
        discard,
        commit,
        isSaving,
    }
}

export type TestsetEditor = ReturnType<typeof useTestsetEditor>
