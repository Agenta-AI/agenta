import {useCallback, useEffect, useMemo, useReducer, useRef, useState} from "react"

import {
    createTestset,
    fetchLatestRevision,
    fetchRevisionColumnKeys,
    fetchRevisionsList,
    invalidateRevisionsListCache,
    invalidateTestsetCache,
    invalidateTestsetsListCache,
    patchRevision,
} from "@agenta/entities/testset"
import {
    buildTestsetRowsFromTraces,
    findDuplicateMappingColumns,
    getTraceMappingPathOptions,
    hasDifferentStructure,
    newColumnsOf,
    suggestTraceMappings,
} from "@agenta/entities/trace"
import {projectIdAtom} from "@agenta/shared/state"
import {message as toast} from "@agenta/ui/app-message"
import {useQuery} from "@tanstack/react-query"
import {useAtomValue} from "jotai"

import {useSelectedSpansData} from "./useSelectedSpansData"

/** `revisionId` null means the latest revision, read again right before the save. */
export type AddToTestsetTarget =
    | {kind: "new"}
    | {kind: "existing"; testsetId: string; name: string; revisionId: string | null}
    | null

/** One revision the user can add rows to, newest first. */
export interface TestsetRevisionOption {
    id: string
    version: number
    createdAt: string | null
}

/** One mapping row. `isNewColumn` says the column field is a name input, not a pick. */
export interface MappingRow {
    id: string
    path: string
    column: string
    isNewColumn: boolean
}

export type ColumnsStatus = "idle" | "loading" | "error" | "ready"

export const PREVIEW_ROW_LIMIT = 5

/** The option value of "Create New" in the test set and column pickers. */
export const CREATE_NEW = "__create_new__"

const SAVE_FAILED = "Couldn't add the spans to the test set"
const NAME_TAKEN = "A test set with this name already exists"

type Action =
    | {type: "target"; target: AddToTestsetTarget}
    | {type: "autoMap"; key: string; mappings: MappingRow[]}
    | {type: "edit"; id: string; patch: Partial<Omit<MappingRow, "id">>}
    | {type: "add"; id: string; isNewColumn: boolean}
    | {type: "remove"; id: string}

interface State {
    target: AddToTestsetTarget
    mappings: MappingRow[]
    /** The target the current mappings were auto mapped for. */
    mappedFor: string | null
}

const targetKey = (target: AddToTestsetTarget) =>
    target
        ? target.kind === "new"
            ? "new"
            : `${target.testsetId}:${target.revisionId ?? "latest"}`
        : null

const reducer = (state: State, action: Action): State => {
    switch (action.type) {
        case "target":
            return {target: action.target, mappings: [], mappedFor: null}
        case "autoMap":
            return {...state, mappings: action.mappings, mappedFor: action.key}
        case "edit":
            return {
                ...state,
                mappings: state.mappings.map((row) =>
                    row.id === action.id ? {...row, ...action.patch} : row,
                ),
            }
        case "add":
            return {
                ...state,
                mappings: [
                    ...state.mappings,
                    {id: action.id, path: "", column: "", isNewColumn: action.isNewColumn},
                ],
            }
        case "remove":
            return {...state, mappings: state.mappings.filter((row) => row.id !== action.id)}
    }
}

let mappingCount = 0
const makeId = () => `mapping-${(mappingCount += 1)}`

const isConflict = (cause: unknown) =>
    (cause as {response?: {status?: number}} | null)?.response?.status === 409

/**
 * The state of the add-to-test-set sheet and its save.
 *
 * The rows go to the revision the user picked, the latest by default. For the latest the save
 * reads the latest revision id again right before the commit, so a commit made while the sheet
 * was open is not dropped. Nothing is written until `submit`.
 */
export const useAddToTestsetForm = ({
    spanIds,
    onSaved,
}: {
    spanIds: readonly string[]
    onSaved: () => void
}) => {
    const projectId = useAtomValue(projectIdAtom) ?? ""
    const spans = useSelectedSpansData(spanIds)
    const [state, dispatch] = useReducer(reducer, {target: null, mappings: [], mappedFor: null})
    const [newName, setNewName] = useState("")
    const [message, setMessage] = useState("")
    const [saving, setSaving] = useState(false)
    const savingRef = useRef(false)

    const {target} = state
    const testsetId = target?.kind === "existing" ? target.testsetId : null
    const pickedRevisionId = target?.kind === "existing" ? target.revisionId : null

    const revisionsQuery = useQuery({
        queryKey: ["add-to-testset-revisions", projectId, testsetId],
        queryFn: async (): Promise<TestsetRevisionOption[]> => {
            const response = await fetchRevisionsList({projectId, testsetId: testsetId ?? ""})
            const revisions = response.testset_revisions.map((raw) => ({
                id: raw.id,
                version: Number(raw.version ?? 0),
                createdAt: raw.created_at ?? raw.date ?? null,
            }))
            // v0 is the empty start of a test set; the picker lists it only when it is alone.
            const committed = revisions.filter((revision) => revision.version > 0)
            return (committed.length ? committed : revisions).sort((a, b) => b.version - a.version)
        },
        enabled: Boolean(projectId && testsetId),
        staleTime: Infinity,
        gcTime: 0,
        retry: false,
    })

    const columnsQuery = useQuery({
        queryKey: ["add-to-testset-columns", projectId, testsetId, pickedRevisionId],
        queryFn: async () => {
            const revisionId =
                pickedRevisionId ??
                (await fetchLatestRevision({projectId, testsetId: testsetId ?? ""}))?.id
            if (!revisionId) throw new Error("The test set has no revision")
            return fetchRevisionColumnKeys({projectId, revisionId})
        },
        enabled: Boolean(projectId && testsetId),
        // Read once per pick: a background refresh could only fail and hide the mappings. The
        // save reads the latest revision again anyway, and closing the sheet drops the entry.
        staleTime: Infinity,
        gcTime: 0,
        retry: false,
    })

    // Columns already read stay usable even if a later refresh fails.
    const columnsStatus: ColumnsStatus = !testsetId
        ? "idle"
        : columnsQuery.data
          ? "ready"
          : columnsQuery.isError
            ? "error"
            : "loading"
    const columnKeys = useMemo(() => columnsQuery.data?.keys ?? [], [columnsQuery.data])

    // Auto mapping runs once per target, as soon as the spans and the columns are known.
    const key = targetKey(target)
    const canAutoMap =
        key !== null &&
        key !== state.mappedFor &&
        spans.status === "ready" &&
        (target?.kind === "new" || columnsStatus === "ready")
    useEffect(() => {
        if (!canAutoMap || key === null) return
        const existing = target?.kind === "existing" ? columnKeys : []
        const mappings = suggestTraceMappings({
            spansData: spans.spansData,
            existingColumns: existing,
        }).map(({path, column, isNew}) => ({id: makeId(), path, column, isNewColumn: isNew}))
        dispatch({type: "autoMap", key, mappings})
    }, [canAutoMap, columnKeys, key, spans.spansData, target?.kind])

    const pathOptions = useMemo(
        () => getTraceMappingPathOptions(spans.spansData),
        [spans.spansData],
    )
    const differentStructure = useMemo(
        () => hasDifferentStructure(spans.spansData),
        [spans.spansData],
    )
    const duplicates = useMemo(() => findDuplicateMappingColumns(state.mappings), [state.mappings])
    const newColumns = useMemo(
        () => (target?.kind === "existing" ? newColumnsOf(state.mappings, columnKeys) : []),
        [columnKeys, state.mappings, target?.kind],
    )
    const previewRows = useMemo(
        () =>
            buildTestsetRowsFromTraces({
                spansData: spans.spansData.slice(0, PREVIEW_ROW_LIMIT),
                mappings: state.mappings,
            }),
        [spans.spansData, state.mappings],
    )
    // An existing test set shows its own columns too, so the preview reads as the rows to come.
    const previewColumns = useMemo(() => {
        const mapped = Object.keys(previewRows[0] ?? {})
        if (target?.kind !== "existing" || mapped.length === 0) return mapped
        return [...new Set([...columnKeys, ...mapped])]
    }, [columnKeys, previewRows, target?.kind])

    const hasCompleteMapping = state.mappings.some((row) => row.path.trim() && row.column.trim())
    const targetReady = target?.kind === "new" ? Boolean(newName.trim()) : columnsStatus === "ready"
    const canSubmit =
        spans.status === "ready" &&
        targetReady &&
        hasCompleteMapping &&
        duplicates.length === 0 &&
        !saving
    const needsConfirm =
        target?.kind === "existing" && Boolean(columnsQuery.data?.hasRows) && newColumns.length > 0

    const submit = useCallback(async (): Promise<boolean> => {
        if (!canSubmit || savingRef.current || !target) return false
        savingRef.current = true
        setSaving(true)
        const rows = buildTestsetRowsFromTraces({
            spansData: spans.spansData,
            mappings: state.mappings,
        })
        const note = message.trim()
        try {
            if (target.kind === "new") {
                await createTestset({
                    projectId,
                    name: newName.trim(),
                    testcases: rows,
                    commitMessage: note || undefined,
                })
                invalidateTestsetsListCache()
                toast.success(
                    note
                        ? `Test set created with message: "${note}"`
                        : "Test set created successfully",
                )
            } else {
                const baseRevisionId =
                    target.revisionId ??
                    (await fetchLatestRevision({projectId, testsetId: target.testsetId}))?.id
                if (!baseRevisionId) throw new Error("The test set has no revision")
                await patchRevision({
                    projectId,
                    testsetId: target.testsetId,
                    baseRevisionId,
                    message: note || undefined,
                    operations: {
                        rows: {add: rows.map((data) => ({data}))},
                        ...(newColumns.length ? {columns: {add: newColumns}} : {}),
                    },
                })
                invalidateTestsetsListCache()
                invalidateTestsetCache(target.testsetId)
                invalidateRevisionsListCache(target.testsetId)
                toast.success(
                    note ? `Saved with message: "${note}"` : "Test set updated successfully",
                )
            }
            onSaved()
            return true
        } catch (cause) {
            console.error("Adding the spans to the test set failed", cause)
            toast.error(target.kind === "new" && isConflict(cause) ? NAME_TAKEN : SAVE_FAILED)
            return false
        } finally {
            savingRef.current = false
            setSaving(false)
        }
    }, [
        canSubmit,
        message,
        newColumns,
        newName,
        onSaved,
        projectId,
        spans.spansData,
        state.mappings,
        target,
    ])

    return {
        status: spans.status,
        retrySpans: spans.retry,
        spanCount: spanIds.length,
        differentStructure,
        pathOptions,
        target,
        setTarget: (next: AddToTestsetTarget) => dispatch({type: "target", target: next}),
        revisions: {
            status: !testsetId
                ? ("idle" as const)
                : revisionsQuery.data
                  ? ("ready" as const)
                  : revisionsQuery.isError
                    ? ("error" as const)
                    : ("loading" as const),
            options: revisionsQuery.data ?? [],
            retry: () => void revisionsQuery.refetch(),
        },
        newName,
        setNewName,
        columns: {
            status: columnsStatus,
            keys: columnKeys,
            retry: () => void columnsQuery.refetch(),
        },
        mappings: state.mappings,
        editMapping: (id: string, patch: Partial<Omit<MappingRow, "id">>) =>
            dispatch({type: "edit", id, patch}),
        addMapping: () =>
            dispatch({type: "add", id: makeId(), isNewColumn: target?.kind !== "existing"}),
        removeMapping: (id: string) => dispatch({type: "remove", id}),
        previewRows,
        previewColumns,
        newColumns,
        duplicates,
        canSubmit,
        needsConfirm,
        message,
        setMessage,
        saving,
        submit,
    }
}
