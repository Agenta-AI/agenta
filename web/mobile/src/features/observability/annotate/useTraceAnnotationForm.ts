import {useCallback, useMemo, useRef, useState} from "react"

import {createAnnotation, updateAnnotation} from "@agenta/entities/annotation"
import type {AnnotationDto} from "@agenta/entities/annotation/dto"
import {
    evaluatorsListQueryAtom,
    workflowLatestRevisionQueryAtomFamily,
} from "@agenta/entities/workflow"
import type {Workflow} from "@agenta/entities/workflow"
import {getHostQueryClient} from "@agenta/shared/api"
import {activeUserIdAtom, projectIdAtom} from "@agenta/shared/state"
import {message} from "@agenta/ui/app-message"
import {atom, useAtomValue} from "jotai"

import {
    buildTraceAnnotationSections,
    buildTraceAnnotationWrites,
    pickEditableAnnotations,
    type TraceAnnotationSection,
    type TraceAnnotationValues,
    type TraceAnnotationWrites,
} from "./traceAnnotationForm"
import {useHumanEvaluators} from "./useHumanEvaluators"

/** The one failure text a reader sees; the cause goes to the console. */
export const SAVE_FAILURE_TEXT = "Failed to update annotations"
const SAVE_SUCCESS_TEXT = "Annotations updated successfully"
const REQUIRED_TEXT = "Required"

// The drawer annotations, the drawer trace and the traces table annotations.
const REFRESHED_KEYS = [["trace-drawer-annotations"], ["trace-drawer"], ["annotations"]]

const EMPTY_REVISIONS = atom(() => [])

/**
 * The trace annotate form: the sections for the user's own annotations, the evaluators others
 * annotated with and the picked evaluators; the edited values; and the save, which sends the
 * create and update requests and refreshes the trace drawer.
 */
export const useTraceAnnotationForm = ({
    traceId,
    spanId,
    annotations,
    selectedSlugs,
    onSaved,
}: {
    traceId: string | undefined
    spanId: string | undefined
    annotations: readonly AnnotationDto[]
    selectedSlugs: readonly string[]
    onSaved: () => void
}) => {
    const projectId = useAtomValue(projectIdAtom)
    const userId = useAtomValue(activeUserIdAtom)
    const {evaluators: humanEvaluators} = useHumanEvaluators()
    const allEvaluators = useAtomValue(evaluatorsListQueryAtom)

    const picked = useMemo(
        () => pickEditableAnnotations({annotations, userId}),
        [annotations, userId],
    )

    // Evaluator order (human evaluator list first), and each slug's workflow id: from the
    // evaluator list, else from the annotation that names it.
    const targets = useMemo(() => {
        const order = new Map(humanEvaluators.map((item, index) => [item.slug, index]))
        const ids = new Map<string, string>()
        for (const ref of allEvaluators.data?.refs ?? []) {
            if (ref.slug && ref.id) ids.set(ref.slug, ref.id)
        }
        for (const annotation of annotations) {
            const ref = annotation.references?.evaluator
            if (ref?.slug && ref.id && !ids.has(ref.slug)) ids.set(ref.slug, ref.id)
        }
        const slugs = [
            ...new Set([
                ...picked.own.map((item) => item.references?.evaluator?.slug ?? ""),
                ...picked.otherSlugs,
                ...selectedSlugs,
            ]),
        ].filter(Boolean)
        const ordered = slugs
            .map((slug, index) => ({slug, rank: order.get(slug) ?? order.size + index}))
            .sort((a, b) => a.rank - b.rank)
            .map((item) => item.slug)
        return ordered.map((slug) => ({slug, workflowId: ids.get(slug) ?? null}))
    }, [humanEvaluators, allEvaluators.data, annotations, picked, selectedSlugs])

    const revisionsAtom = useMemo(
        () =>
            targets.length === 0
                ? EMPTY_REVISIONS
                : atom((get) =>
                      targets.map((item) => ({
                          ...item,
                          query: item.workflowId
                              ? get(workflowLatestRevisionQueryAtomFamily(item.workflowId))
                              : null,
                      })),
                  ),
        [targets],
    )
    const revisions = useAtomValue(revisionsAtom)
    const listPending = allEvaluators.isPending ?? false

    const {resolved, isLoading, hasError} = useMemo(() => {
        const result = {
            resolved: new Map<string, {workflowId: string; revision: Workflow}>(),
            isLoading: false,
            hasError: false,
        }
        for (const item of revisions) {
            if (!item.workflowId || !item.query) {
                if (listPending) result.isLoading = true
                else result.hasError = true
                continue
            }
            const {data, isPending, isError} = item.query
            if (data) result.resolved.set(item.slug, {workflowId: item.workflowId, revision: data})
            else if (isPending && !isError) result.isLoading = true
            else result.hasError = true
        }
        return result
    }, [revisions, listPending])

    const sections = useMemo(
        () =>
            buildTraceAnnotationSections({
                slugs: targets.map((item) => item.slug),
                evaluators: resolved,
                own: picked.own,
            }),
        [targets, resolved, picked],
    )

    const [values, setValues] = useState<TraceAnnotationValues>({})
    const [showErrors, setShowErrors] = useState(false)
    const [isSaving, setIsSaving] = useState(false)
    const savingRef = useRef(false)

    const writes = useMemo<TraceAnnotationWrites | null>(() => {
        try {
            return buildTraceAnnotationWrites({sections, values, traceId, spanId})
        } catch {
            // No span to link a new annotation to; the Annotate button is disabled then.
            return null
        }
    }, [sections, values, traceId, spanId])

    const errors = useMemo(() => {
        const result: Record<string, Record<string, string>> = {}
        if (!showErrors || !writes) return result
        for (const [slug, keys] of Object.entries(writes.missingRequired)) {
            result[slug] = Object.fromEntries(keys.map((key) => [key, REQUIRED_TEXT]))
        }
        return result
    }, [showErrors, writes])

    const setValue = useCallback((slug: string, fieldKey: string, value: unknown) => {
        setValues((previous) => ({...previous, [slug]: {...previous[slug], [fieldKey]: value}}))
    }, [])

    const shownSections = useMemo<TraceAnnotationSection[]>(
        () =>
            sections.map((section) => {
                const edits = values[section.slug]
                if (!edits) return section
                const fields = {...section.fields}
                for (const [key, value] of Object.entries(edits)) {
                    if (fields[key]) fields[key] = {...fields[key], value}
                }
                return {...section, fields}
            }),
        [sections, values],
    )

    const hasChanges = Boolean(
        writes &&
        writes.creates.length + writes.updates.length + Object.keys(writes.missingRequired).length >
            0,
    )

    const save = useCallback(async () => {
        if (savingRef.current || !writes || !projectId) return
        if (Object.keys(writes.missingRequired).length > 0) {
            setShowErrors(true)
            return
        }
        if (writes.creates.length === 0 && writes.updates.length === 0) return

        savingRef.current = true
        setIsSaving(true)
        const results = await Promise.allSettled([
            ...writes.creates.map((payload) => createAnnotation(projectId, payload)),
            ...writes.updates.map((update) =>
                updateAnnotation(projectId, update.traceId, update.spanId, {
                    annotation: update.annotation,
                }),
            ),
        ])
        // Refresh even after a failure: the writes that did land become the user's own
        // annotations, so a retry updates them instead of creating them again.
        const queryClient = getHostQueryClient()
        await Promise.allSettled(
            REFRESHED_KEYS.map((queryKey) => queryClient.invalidateQueries({queryKey})),
        )
        savingRef.current = false
        setIsSaving(false)

        const failures = results.flatMap((result) =>
            result.status === "rejected" ? [result.reason] : [],
        )
        if (failures.length > 0) {
            console.error("Saving the trace annotations failed", failures)
            message.error(SAVE_FAILURE_TEXT)
            return
        }
        message.success(SAVE_SUCCESS_TEXT)
        onSaved()
    }, [writes, projectId, onSaved])

    return {
        sections: shownSections,
        ownSlugs: picked.own.map((item) => item.references?.evaluator?.slug ?? ""),
        setValue,
        errors,
        hasChanges,
        isLoading,
        hasError,
        isSaving,
        save,
    }
}
