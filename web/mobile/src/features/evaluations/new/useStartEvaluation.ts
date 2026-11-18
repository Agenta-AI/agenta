import {useCallback, useRef, useState} from "react"

import {
    buildHumanRunConfig,
    createAutoEvaluationRuns,
    createHumanEvaluationRun,
    fetchAllTestcaseIds,
} from "@agenta/entities/evaluationRun"
import {message} from "@agenta/ui/app-message"
import {useQueryClient} from "@tanstack/react-query"
import {useRouter} from "next/router"

import {RUNS_LIST_KEY} from "../list/runsListKey"

import {readHumanRunInputs} from "./humanRunInputs"
import {
    runNameFor,
    validateDraft,
    type DraftTestset,
    type NewEvaluationDraft,
    type NewEvaluationSection,
} from "./newEvaluationDraft"
import {needsProviderKey, showProviderKeyMissing} from "./providerKey"

export type StartEvaluationResult =
    | {status: "started"; kind: "auto" | "human"}
    | {status: "invalid"; section: NewEvaluationSection; message: string}
    | {status: "blocked"}
    | {status: "failed"}
    | {status: "busy"}

/** Start the draft as an auto or human evaluation; an invalid draft comes back for inline errors. */
export const useStartEvaluation = ({
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
    const [isStarting, setIsStarting] = useState(false)

    const resultsUrl = useCallback(
        (runId: string) => `${base}/evaluations/results/${runId}`,
        [base],
    )

    const startAuto = useCallback(
        async (
            draft: NewEvaluationDraft,
            testset: DraftTestset,
        ): Promise<StartEvaluationResult> => {
            try {
                if (await needsProviderKey(draft.evaluators.map((e) => e.revisionId))) {
                    showProviderKeyMissing()
                    void router.push(`${base}/settings?tab=llms`)
                    return {status: "blocked"}
                }
                // One request per revision, so each run carries its own name.
                const settled = await Promise.allSettled(
                    draft.revisions.map((revision) =>
                        createAutoEvaluationRuns({
                            projectId,
                            name: runNameFor(draft, revision),
                            testsetRevisionId: testset.revisionId,
                            applicationRevisionIds: [revision.id],
                            evaluatorRevisionIds: draft.evaluators.map(
                                (evaluator) => evaluator.revisionId,
                            ),
                            concurrency: {
                                batch_size: draft.concurrency.batch_size ?? 1,
                                max_retries: draft.concurrency.max_retries ?? 0,
                                retry_delay: draft.concurrency.retry_delay ?? 0,
                            },
                        }),
                    ),
                )
                const runIds = settled.flatMap((entry) =>
                    entry.status === "fulfilled" ? entry.value.runIds : [],
                )
                const failedRevisionIds = draft.revisions
                    .filter((_, index) => settled[index].status === "rejected")
                    .map((revision) => revision.id)
                if (runIds.length === 0) {
                    throw (
                        settled.find(
                            (entry) => entry.status === "rejected",
                        ) as PromiseRejectedResult
                    ).reason
                }
                const total = runIds.length + failedRevisionIds.length
                const content =
                    failedRevisionIds.length > 0
                        ? `${runIds.length} of ${total} evaluations started`
                        : runIds.length === 1
                          ? "Evaluation started."
                          : `${runIds.length} evaluations started.`
                const options = {
                    content,
                    linkText: "View progress",
                    onNavigate: () => void router.push(resultsUrl(runIds[0])),
                }
                if (failedRevisionIds.length > 0) message.warning(options)
                else message.success(options)
                return {status: "started", kind: "auto"}
            } catch (error) {
                console.error("Could not start the evaluation", error)
                message.error("Couldn't start the evaluation")
                return {status: "failed"}
            }
        },
        [base, projectId, resultsUrl, router],
    )

    const startHuman = useCallback(
        async (
            draft: NewEvaluationDraft,
            testset: DraftTestset,
        ): Promise<StartEvaluationResult> => {
            const [revision] = draft.revisions
            try {
                const input = await readHumanRunInputs({
                    projectId,
                    name: draft.name.trim(),
                    revision,
                    testset,
                    evaluators: draft.evaluators,
                })
                const testcaseIds = await fetchAllTestcaseIds({
                    projectId,
                    testsetRevisionId: testset.revisionId,
                })
                const {runs} = buildHumanRunConfig(input)
                const {runId} = await createHumanEvaluationRun({
                    projectId,
                    spec: runs[0],
                    testcaseIds,
                })
                void router.push(`${resultsUrl(runId)}?view=focus`)
                return {status: "started", kind: "human"}
            } catch (error) {
                console.error("Could not start the evaluation", error)
                message.error("Couldn't start the evaluation")
                return {status: "failed"}
            }
        },
        [projectId, resultsUrl, router],
    )

    const start = useCallback(
        async (draft: NewEvaluationDraft): Promise<StartEvaluationResult> => {
            if (busyRef.current) return {status: "busy"}
            const problem = validateDraft(draft)
            if (problem) return {status: "invalid", ...problem}
            // `validateDraft` has checked the test set, which narrows the type for the starters.
            const {testset} = draft
            if (!testset)
                return {status: "invalid", section: "testset", message: "Select a test set"}
            busyRef.current = true
            setIsStarting(true)
            try {
                const result =
                    draft.kind === "auto"
                        ? await startAuto(draft, testset)
                        : await startHuman(draft, testset)
                if (result.status === "started") {
                    void queryClient.invalidateQueries({queryKey: RUNS_LIST_KEY})
                }
                return result
            } finally {
                busyRef.current = false
                setIsStarting(false)
            }
        },
        [queryClient, startAuto, startHuman],
    )

    return {start, isStarting}
}
