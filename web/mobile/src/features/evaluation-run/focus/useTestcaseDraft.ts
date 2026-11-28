import {createContext, useCallback, useContext, useMemo, useState} from "react"

import {testcaseMolecule} from "@agenta/entities/testcase"
import {
    invalidateRevisionsListCache,
    invalidateTestsetCache,
    invalidateTestsetsListCache,
    patchRevision,
} from "@agenta/entities/testset"
import {projectIdAtom} from "@agenta/shared/state"
import {useAtomValue} from "jotai"

/** Test case values are JSON: two values are the same when their JSON is. */
const sameValue = (a: unknown, b: unknown) => JSON.stringify(a) === JSON.stringify(b)

/** A new revision of the test set, made by "Save to test set". */
export interface SavedTestcase {
    revisionId: string | null
    version: number | null
}

interface DraftState {
    /** The scenario the draft belongs to; a draft of another scenario is no draft. */
    scenarioId: string
    editing: boolean
    edits: Record<string, unknown>
    /** "Use as reference" is on: the output is written to the expected column. */
    reference: boolean
}

/**
 * The test case part of the drawer's Annotate panel: a draft of the open scenario's test case
 * (edited fields and the output as the reference), and "Save to test set", which commits the
 * draft as a new revision of the run's test set (`patchRevision`, `rows.replace`). The run keeps
 * its own revision.
 */
export function useTestcaseDraft({
    scenarioId,
    testcaseId,
    testset,
    expectedKey,
    output,
}: {
    scenarioId: string
    testcaseId: string | null
    /** The run's test set and the revision it ran on; null for a run on traces. */
    testset: {testsetId: string; revisionId: string | null} | null
    /** The column an evaluator compares the output with; null hides "Use as reference". */
    expectedKey: string | null
    /** The app output of the test case. */
    output: unknown
}) {
    const projectId = useAtomValue(projectIdAtom) ?? ""
    const testcase = useAtomValue(
        useMemo(() => testcaseMolecule.query(testcaseId ?? ""), [testcaseId]),
    )
    const [state, setState] = useState<DraftState | null>(null)
    const [saving, setSaving] = useState(false)
    // What "Save to test set" made in this drawer, by scenario. The next save starts from the
    // newest of these revisions, so it keeps the corrections saved before it. A saved test case
    // has a new id in that revision (ids follow the content), so it is not edited again here.
    const [saved, setSaved] = useState<Record<string, SavedTestcase>>({})
    const [headRevisionId, setHeadRevisionId] = useState<string | null>(null)
    const savedHere = saved[scenarioId] ?? null
    const draft = state?.scenarioId === scenarioId ? state : null
    const base = (testcase.data?.data ?? null) as Record<string, unknown> | null

    const editedFields = useMemo(
        () =>
            Object.entries(draft?.edits ?? {})
                .filter(([key, value]) => !sameValue(value, base?.[key]))
                .map(([key]) => key),
        [draft?.edits, base],
    )
    const reference = Boolean(draft?.reference && expectedKey)
    const dirty = editedFields.length > 0 || reference

    const update = useCallback(
        (change: (prev: DraftState) => DraftState) => {
            setState((prev) =>
                change(
                    prev?.scenarioId === scenarioId
                        ? prev
                        : {scenarioId, editing: false, edits: {}, reference: false},
                ),
            )
        },
        [scenarioId],
    )

    const values = useMemo(() => {
        const next = {...(base ?? {}), ...(draft?.edits ?? {})}
        if (reference && expectedKey) next[expectedKey] = output
        return next
    }, [base, draft?.edits, reference, expectedKey, output])

    const save = async () => {
        if (!testset || !testcaseId || !base || saving || savedHere) return
        setSaving(true)
        try {
            const response = await patchRevision({
                projectId,
                testsetId: testset.testsetId,
                baseRevisionId: headRevisionId ?? testset.revisionId ?? undefined,
                operations: {rows: {replace: [{id: testcaseId, data: values}]}},
            })
            const revision = response?.testset_revision
            invalidateTestsetsListCache()
            invalidateTestsetCache(testset.testsetId)
            invalidateRevisionsListCache(testset.testsetId)
            const revisionId = typeof revision?.id === "string" ? revision.id : null
            setState(null)
            setHeadRevisionId(revisionId)
            setSaved((prev) => ({
                ...prev,
                [scenarioId]: {
                    revisionId,
                    version: revision?.version == null ? null : Number(revision.version),
                },
            }))
        } finally {
            setSaving(false)
        }
    }

    return {
        /** The test case is loaded and can be edited (not after it was saved here). */
        ready: Boolean(base && testcaseId && testset && !savedHere),
        editing: Boolean(draft?.editing),
        /** The column "Use as reference" writes to; null hides it. */
        expectedKey,
        values,
        editedFields,
        reference,
        dirty,
        saving,
        saved: savedHere,
        toggleEditing: () => update((prev) => ({...prev, editing: !prev.editing})),
        setField: (key: string, value: unknown) =>
            update((prev) => ({...prev, edits: {...prev.edits, [key]: value}})),
        setReference: (on: boolean) => update((prev) => ({...prev, reference: on})),
        discard: () => setState(null),
        save,
    }
}

export type TestcaseDraft = ReturnType<typeof useTestcaseDraft>

/** The open drawer's test case draft, for the inputs table and the output while the panel is open. */
export const TestcaseDraftContext = createContext<TestcaseDraft | null>(null)

export const useTestcaseDraftContext = () => useContext(TestcaseDraftContext)
