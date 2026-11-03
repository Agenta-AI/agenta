import {useCallback, useEffect, useMemo} from "react"

import {loadableController} from "@agenta/entities/loadable"
import {
    testcaseDataController,
    testcaseMolecule,
    type TestcaseDataConfig,
} from "@agenta/entities/testcase"
import {useAtomValue, useStore} from "jotai"

import type {TestsetLoadPayload} from "./useTestsetMenuModel"
import {useTestsetSelection} from "./useTestsetSelection"

export interface UseTestsetLoadSelectionParams {
    loadableId: string
    /** "load" connects a test set; "edit" changes the rows of the connected one. */
    mode: "load" | "edit"
    connectedRevisionId: string | null
    connectedTestsetId: string | null
    /** A chat playground loads one test case: a new pick replaces the old one. */
    singleSelect: boolean
    /** Filters the rows the table shows. */
    searchTerm: string
}

const EMPTY: string[] = []

/**
 * The state of the load dialog without its layout: the picked test set and revision, the picked
 * rows, the table config, the footer count and the confirm rules. The picks live in a selection
 * draft that is dropped on confirm and on cancel; the playground changes only through the
 * payload the caller acts on.
 */
export const useTestsetLoadSelection = ({
    loadableId,
    mode,
    connectedRevisionId,
    connectedTestsetId,
    singleSelect,
    searchTerm,
}: UseTestsetLoadSelectionParams) => {
    const store = useStore()
    const isEdit = mode === "edit"
    // Edit mode starts from the rows the playground shows; "Manage" seeded that draft.
    const shownIds = useAtomValue(
        useMemo(() => loadableController.selectors.displayRowIds(loadableId), [loadableId]),
    )
    const {selectedRevisionId, selectedTestsetId, setSelection, revisionInfo} = useTestsetSelection(
        isEdit ? (connectedRevisionId ?? undefined) : undefined,
        isEdit ? (connectedTestsetId ?? undefined) : undefined,
        isEdit ? shownIds : EMPTY,
    )

    const draftKey = selectedRevisionId ?? "local"
    const selectedIds = useAtomValue(
        useMemo(() => testcaseMolecule.atoms.currentSelection(draftKey), [draftKey]),
    )
    const viewingConnected = !!selectedRevisionId && selectedRevisionId === connectedRevisionId
    // Load mode cannot pick the revision that is already connected.
    const selectionDisabled = !isEdit && viewingConnected

    // One scope for the table and the footer count, so "{n} of {m}" counts the rows shown.
    const baseConfig = useMemo<TestcaseDataConfig>(
        () => ({
            scopeId: `playground-testset-${mode}-${draftKey}`,
            revisionId: selectedRevisionId,
            // Managing the connected test set also lists the rows added in the playground.
            includeNewRows: isEdit && viewingConnected,
        }),
        [draftKey, isEdit, mode, selectedRevisionId, viewingConnected],
    )
    const tableConfig = useMemo<TestcaseDataConfig>(
        () => (searchTerm.trim() ? {...baseConfig, searchTerm} : baseConfig),
        [baseConfig, searchTerm],
    )
    // The rows the table lists. The store's own count also takes the playground's unsaved rows.
    const tableRows = useAtomValue(
        useMemo(() => testcaseDataController.selectors.rows(baseConfig), [baseConfig]),
    )
    const hasMore = useAtomValue(
        useMemo(() => testcaseDataController.selectors.hasMore(baseConfig), [baseConfig]),
    )
    const totalLabel = `${tableRows.length}${hasMore ? "+" : ""}`

    const setSelectedIds = useCallback(
        (ids: string[]) => {
            const next = singleSelect ? ids.slice(-1) : ids
            store.set(testcaseMolecule.actions.setSelectionDraft, draftKey, next)
        },
        [draftKey, singleSelect, store],
    )

    const confirmLabel = isEdit
        ? viewingConnected
            ? "Update Selection"
            : "Import Selected"
        : "Load Selected"
    const canConfirm = !selectionDisabled && !!selectedRevisionId && selectedIds.length > 0

    /** The payload to act on. The draft goes first, uncommitted: the caller decides. */
    const confirm = useCallback((): TestsetLoadPayload => {
        store.set(testcaseMolecule.actions.discardSelectionDraft, draftKey)
        return {
            revisionId: draftKey,
            testcaseIds: selectedIds,
            testsetName: revisionInfo?.testsetName ?? null,
            testsetId: revisionInfo?.testsetId ?? null,
            revisionVersion: revisionInfo?.version ?? null,
        }
    }, [draftKey, revisionInfo, selectedIds, store])

    const cancel = useCallback(() => {
        store.set(testcaseMolecule.actions.discardSelectionDraft, draftKey)
    }, [draftKey, store])

    // Browsing points the shared test case context at the picked revision: point it back at the
    // connected one when the dialog goes.
    useEffect(
        () => () => {
            const connected = store.get(loadableController.selectors.connectedSource(loadableId))
            store.set(testcaseMolecule.actions.setRevisionContext, connected?.id ?? null)
        },
        [loadableId, store],
    )

    return {
        selectedRevisionId,
        selectedTestsetId,
        setSelection,
        selectedIds,
        setSelectedIds,
        tableConfig,
        totalLabel,
        confirmLabel,
        selectionDisabled,
        canConfirm,
        confirm,
        cancel,
    }
}
