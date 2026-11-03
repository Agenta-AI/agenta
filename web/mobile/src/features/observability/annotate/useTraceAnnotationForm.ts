import {useCallback, useMemo, useRef, useState} from "react"

import {createAnnotation, updateAnnotation} from "@agenta/entities/annotation"
import {queryAllAnnotations, type AnnotationDto} from "@agenta/entities/annotation/dto"
import {
    evaluatorsListQueryAtom,
    workflowLatestRevisionQueryAtomFamily,
} from "@agenta/entities/workflow"
import type {Workflow} from "@agenta/entities/workflow"
import {getHostQueryClient} from "@agenta/shared/api"
import {activeUserIdAtom, projectIdAtom} from "@agenta/shared/state"
import {message} from "@agenta/ui/app-message"
import {useQuery} from "@tanstack/react-query"
import {atom, useAtomValue} from "jotai"

import {
    buildTraceAnnotationSections,
    currentFields,
    buildTraceAnnotationWrites,
    pickEditableAnnotations,
    type TraceAnnotationSection,
    type TraceAnnotationValues,
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
    traceId: string
    spanId: string
    annotations: readonly AnnotationDto[]
    selectedSlugs: readonly string[]
    onSaved: () => void
}) => {
    const projectId = useAtomValue(projectIdAtom)
    const userId = useAtomValue(activeUserIdAtom)
    const {evaluators: humanEvaluators} = useHumanEvaluators()
    const allEvaluators = useAtomValue(evaluatorsListQueryAtom)
    // What this sheet saved, by annotation trace id. It stands in for the drawer's copy for the
    // life of the sheet, so a retry after a partly failed save updates a landed create instead of
    // creating it again, and compares with the values just sent.
    const [savedHere, setSavedHere] = useState<Record<string, AnnotationDto>>({})

    // The drawer drops `null` outputs when it groups them, so an update read from it would erase
    // a saved "none of the above". The user's own annotations are read again as the API stores them.
    const hasOwn = Boolean(userId) && annotations.some((item) => item.createdById === userId)
    // The same request the drawer sends, without its grouping.
    const stored = useQuery({
        queryKey: ["trace-annotate-stored", projectId, traceId, spanId],
        queryFn: () =>
            queryAllAnnotations({
                projectId: projectId ?? undefined,
                queries: {annotation: {links: [{trace_id: traceId, span_id: spanId}]}},
            }),
        enabled: Boolean(projectId) && hasOwn,
        staleTime: 0,
        gcTime: 0,
        retry: false,
    })

    const storedOutputs = useMemo(
        () =>
            new Map(
                (stored.data?.annotations ?? []).map((item) => [item.trace_id, item.data?.outputs]),
            ),
        [stored.data],
    )
    const picked = useMemo(() => {
        const current = annotations
            .filter((item) => !(item.trace_id && savedHere[item.trace_id]))
            .map((item) => {
                const outputs = item.trace_id ? storedOutputs.get(item.trace_id) : undefined
                return outputs ? ({...item, data: {outputs}} as AnnotationDto) : item
            })
        return pickEditableAnnotations({
            annotations: [...current, ...Object.values(savedHere)],
            userId,
        })
    }, [annotations, storedOutputs, savedHere, userId])

    // An update replaces the whole outputs object, so it waits until each own annotation it may
    // update is known as stored (or was saved by this sheet). A failed read blocks it.
    const storedPending = hasOwn && stored.isPending
    const storedMissing =
        hasOwn &&
        !stored.isPending &&
        picked.own.some(
            (item) =>
                item.trace_id && !savedHere[item.trace_id] && !storedOutputs.has(item.trace_id),
        )
    const storedBlocked = storedPending || storedMissing

    // Evaluator order (human evaluator list first), and each slug's workflow: from the evaluator
    // list, else the id from the annotation that names it. A picked slug whose evaluator is gone
    // (deleted or archived) is left out once the list is known.
    const listKnown = !allEvaluators.isPending && !allEvaluators.isError
    const targets = useMemo(() => {
        const order = new Map(humanEvaluators.map((item, index) => [item.slug, index]))
        const refs = new Map<
            string,
            {workflowId: string; name?: string | null; description?: string | null}
        >()
        for (const ref of allEvaluators.data?.refs ?? []) {
            if (ref.slug && ref.id && !ref.deleted_at) {
                refs.set(ref.slug, {
                    workflowId: ref.id,
                    name: ref.name,
                    description: ref.description,
                })
            }
        }
        for (const annotation of annotations) {
            const ref = annotation.references?.evaluator
            if (ref?.slug && ref.id && !refs.has(ref.slug)) refs.set(ref.slug, {workflowId: ref.id})
        }
        const annotated = new Set([
            ...picked.own.map((item) => item.references?.evaluator?.slug ?? ""),
            ...picked.otherSlugs,
        ])
        const picks = selectedSlugs.filter(
            (slug) => !annotated.has(slug) && (!listKnown || refs.has(slug)),
        )
        return [...annotated, ...picks]
            .filter(Boolean)
            .map((slug, index) => ({slug, rank: order.get(slug) ?? order.size + index}))
            .sort((a, b) => a.rank - b.rank)
            .map(({slug}) => ({
                slug,
                pickedOnly: !annotated.has(slug),
                ...(refs.get(slug) ?? {workflowId: null}),
            }))
    }, [humanEvaluators, listKnown, allEvaluators.data, annotations, picked, selectedSlugs])

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
            resolved: new Map<
                string,
                {
                    workflowId: string
                    name?: string | null
                    description?: string | null
                    revision: Workflow
                }
            >(),
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
            // A picked evaluator that is no longer a human evaluator is dropped quietly.
            if (data && item.pickedOnly && !data.flags?.is_feedback) continue
            if (data) {
                result.resolved.set(item.slug, {
                    workflowId: item.workflowId,
                    name: item.name,
                    description: item.description,
                    revision: data,
                })
            } else if (isPending && !isError) result.isLoading = true
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

    const writes = useMemo(
        () => buildTraceAnnotationWrites({sections, values, traceId, spanId}),
        [sections, values, traceId, spanId],
    )

    const errors = useMemo(() => {
        const result: Record<string, Record<string, string>> = {}
        if (!showErrors) return result
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
            sections.map((section) => ({
                ...section,
                fields: currentFields(section, values[section.slug]),
            })),
        [sections, values],
    )

    const hasChanges =
        !storedBlocked &&
        writes.creates.length + writes.updates.length + Object.keys(writes.missingRequired).length >
            0

    const save = useCallback(async () => {
        if (savingRef.current || !projectId || storedBlocked) return
        if (Object.keys(writes.missingRequired).length > 0) {
            setShowErrors(true)
            return
        }
        if (writes.creates.length === 0 && writes.updates.length === 0) return

        savingRef.current = true
        setIsSaving(true)
        const [created, updated] = await Promise.all([
            Promise.allSettled(
                writes.creates.map((payload) => createAnnotation(projectId, payload)),
            ),
            Promise.allSettled(
                writes.updates.map((update) =>
                    updateAnnotation(projectId, update.traceId, update.spanId, {
                        annotation: update.annotation,
                    }),
                ),
            ),
        ])
        const now = new Date().toISOString()
        const landed: Record<string, AnnotationDto> = {}
        created.forEach((result, index) => {
            const traceIdOfAnnotation = result.status === "fulfilled" && result.value?.trace_id
            if (!traceIdOfAnnotation || result.status !== "fulfilled") return
            landed[traceIdOfAnnotation] = {
                ...writes.creates[index],
                trace_id: traceIdOfAnnotation,
                span_id: result.value?.span_id,
                createdById: userId ?? undefined,
                created_at: now,
            } as AnnotationDto
        })
        updated.forEach((result, index) => {
            const update = writes.updates[index]
            const own = picked.own.find((item) => item.trace_id === update.traceId)
            if (result.status !== "fulfilled" || !own) return
            landed[update.traceId] = {...own, data: update.annotation.data} as AnnotationDto
        })
        if (Object.keys(landed).length > 0) setSavedHere((previous) => ({...previous, ...landed}))
        const results = [...created, ...updated]
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
    }, [writes, projectId, storedBlocked, userId, picked, onSaved])

    return {
        sections: shownSections,
        ownSlugs: picked.own.map((item) => item.references?.evaluator?.slug ?? ""),
        setValue,
        errors,
        hasChanges,
        isLoading: isLoading || storedPending,
        hasError,
        /** The user's saved annotations could not be read; their updates wait for a retry. */
        storedFailed: storedMissing,
        retryStored: () => void stored.refetch(),
        isSaving,
        save,
    }
}
