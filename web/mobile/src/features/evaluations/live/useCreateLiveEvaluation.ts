import {useCallback, useRef, useState} from "react"

import {createLiveEvaluation, LIVE_INVOCATION_FILTER} from "@agenta/entities/evaluationRun"
import {message} from "@agenta/ui/app-message"
import {useQueryClient} from "@tanstack/react-query"
import {useRouter} from "next/router"

import {newId} from "@/lib/ids"

import {RUNS_LIST_KEY} from "../list/runsListKey"
import {needsProviderKey, showProviderKeyMissing} from "../new/providerKey"

import type {LiveEvaluationDraft} from "./useLiveEvaluationForm"

export type CreateLiveEvaluationResult = "created" | "blocked" | "failed" | "busy"

/**
 * Create a live evaluation from a valid draft. A second call while one runs does nothing.
 * Errors show as toasts; the caller keeps the sheet open unless the result is `created`.
 */
export const useCreateLiveEvaluation = ({
    projectId,
    base,
}: {
    projectId: string
    /** `/w/{workspace}/p/{project}` */
    base: string
}) => {
    const router = useRouter()
    const queryClient = useQueryClient()
    // The ref blocks a second click in the same tick; the state redraws the button.
    const busyRef = useRef(false)
    const [isCreating, setIsCreating] = useState(false)

    const create = useCallback(
        async (
            draft: LiveEvaluationDraft,
            evaluatorRevisionId: string,
        ): Promise<CreateLiveEvaluationResult> => {
            if (busyRef.current) return "busy"
            busyRef.current = true
            setIsCreating(true)
            try {
                if (await needsProviderKey([evaluatorRevisionId])) {
                    showProviderKeyMissing()
                    void router.push(`${base}/settings?tab=llms`)
                    return "blocked"
                }
                await createLiveEvaluation({
                    projectId,
                    name: draft.name.trim(),
                    description: draft.description.trim(),
                    filters: [LIVE_INVOCATION_FILTER, ...draft.userFilters],
                    samplingRate: draft.samplingRate,
                    evaluatorRevisionId,
                    slugSuffix: newId().slice(0, 8),
                })
                message.success("Live evaluation created")
                void queryClient.invalidateQueries({queryKey: RUNS_LIST_KEY})
                return "created"
            } catch (error) {
                console.error("Could not create the live evaluation", error)
                message.error("Couldn't create the live evaluation")
                return "failed"
            } finally {
                busyRef.current = false
                setIsCreating(false)
            }
        },
        [base, projectId, queryClient, router],
    )

    return {create, isCreating}
}
