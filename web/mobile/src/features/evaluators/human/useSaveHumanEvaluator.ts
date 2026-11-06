import {useCallback, useState} from "react"

import {
    createHumanEvaluatorAtom,
    updateHumanEvaluatorAtom,
    type EvaluatorEntry,
} from "@agenta/entities/workflow"
import {useQueryClient} from "@tanstack/react-query"
import {useSetAtom} from "jotai"

import {draftToMetrics, type HumanEvaluatorDraft} from "./humanEvaluatorForm"

export type SaveHumanEvaluatorResult = {ok: true} | {ok: false; field?: "slug"; message: string}

const statusOf = (error: unknown): number | undefined =>
    (error as {response?: {status?: number}} | null)?.response?.status

/**
 * Creates a human evaluator, or saves an edit of one as a new revision. The evaluator lists load
 * again after a save. A failure comes back as a short message; the detail goes to the console.
 */
export const useSaveHumanEvaluator = () => {
    const create = useSetAtom(createHumanEvaluatorAtom)
    const update = useSetAtom(updateHumanEvaluatorAtom)
    const queryClient = useQueryClient()
    const [saving, setSaving] = useState(false)

    const save = useCallback(
        async (
            draft: HumanEvaluatorDraft,
            editing: EvaluatorEntry | null,
        ): Promise<SaveHumanEvaluatorResult> => {
            setSaving(true)
            try {
                const metrics = draftToMetrics(draft)
                const description = draft.description.trim()
                if (editing) {
                    await update({
                        id: editing.workflow.id,
                        variantId: editing.latestRevision.workflow_variant_id ?? undefined,
                        name: editing.workflow.name ?? draft.name.trim(),
                        description,
                        metrics,
                        meta: editing.workflow.meta ?? undefined,
                        // The tag map as stored: the edit replaces it.
                        tags: editing.workflow.tags,
                    })
                } else {
                    await create({
                        name: draft.name.trim(),
                        slug: draft.slug.trim(),
                        description: description || undefined,
                        metrics,
                    })
                }
                await queryClient.invalidateQueries({queryKey: ["workflows"]})
                return {ok: true}
            } catch (error) {
                console.error("Save human evaluator failed", error)
                if (!editing && statusOf(error) === 409) {
                    return {
                        ok: false,
                        field: "slug",
                        message: "An evaluator with this slug exists.",
                    }
                }
                return {ok: false, message: "Couldn't save the evaluator. Try again."}
            } finally {
                setSaving(false)
            }
        },
        [create, update, queryClient],
    )

    return {save, saving}
}
