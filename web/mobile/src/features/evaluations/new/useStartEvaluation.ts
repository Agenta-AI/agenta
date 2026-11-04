import {useCallback, useRef, useState} from "react"

import {
    buildHumanRunConfig,
    createAutoEvaluationRuns,
    createHumanEvaluationRun,
    fetchAllTestcaseIds,
} from "@agenta/entities/evaluationRun"
import {toProviderConnections, vaultSecretsQueryAtom} from "@agenta/entities/secret"
import {normalizeWorkflowTypeKey, workflowMolecule} from "@agenta/entities/workflow"
import {isEE} from "@agenta/shared/api"
import {message, notification} from "@agenta/ui/app-message"
import {useQueryClient} from "@tanstack/react-query"
import {getDefaultStore} from "jotai"
import {useRouter} from "next/router"

import {RUNS_LIST_KEY} from "../list/runsListKey"

import {readHumanRunInputs} from "./humanRunInputs"
import {
    validateDraft,
    type DraftTestset,
    type NewEvaluationDraft,
    type NewEvaluationSection,
} from "./newEvaluationDraft"

const LEGACY_AI_CRITIQUE_KEYS = new Set(["auto_ai_critique", "ai_critique"])

export type StartEvaluationResult =
    | {status: "started"; kind: "auto" | "human"}
    | {status: "invalid"; section: NewEvaluationSection}
    | {status: "blocked"}
    | {status: "failed"}
    | {status: "busy"}

/** An AI critique runs a model, so it needs a provider key. Older evaluators carry a legacy key. */
const isAiCritique = (revisionId: string): boolean => {
    if (workflowMolecule.get.isLlm(revisionId)) return true
    const uri = workflowMolecule.get.data(revisionId)?.data?.uri
    const key = normalizeWorkflowTypeKey(uri)
    return key !== null && LEGACY_AI_CRITIQUE_KEYS.has(key)
}

/** True when the project has no provider key. An EE deployment serves built-in models, so it never blocks. */
const lacksProviderKey = async (): Promise<boolean> => {
    if (isEE()) return false
    // The vault query is not mounted on this page, so read the answer of a fresh request.
    const {data} = await getDefaultStore().get(vaultSecretsQueryAtom).refetch({throwOnError: true})
    return toProviderConnections(data ?? []).length === 0
}

/**
 * Start the draft as an auto or a human evaluation. A second call while one runs does nothing.
 * Errors show as toasts; the caller keeps the sheet open unless the result is `started`.
 */
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
                if (
                    draft.evaluators.some((e) => isAiCritique(e.revisionId)) &&
                    (await lacksProviderKey())
                ) {
                    notification.error({
                        message: "LLM Key Missing",
                        description: "Please provide at least one LLM key to access this feature.",
                    })
                    message.error("LLM keys are required for AI Critique configuration")
                    void router.push(`${base}/settings?tab=llms`)
                    return {status: "blocked"}
                }
                const {runIds, failedRevisionIds} = await createAutoEvaluationRuns({
                    projectId,
                    name: draft.name.trim(),
                    testsetRevisionId: testset.revisionId,
                    applicationRevisionIds: draft.revisions.map((revision) => revision.id),
                    evaluatorRevisionIds: draft.evaluators.map((evaluator) => evaluator.revisionId),
                    concurrency: {
                        batch_size: draft.concurrency.batch_size ?? 0,
                        max_retries: draft.concurrency.max_retries ?? 0,
                        retry_delay: draft.concurrency.retry_delay ?? 0,
                    },
                })
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
            if (problem) {
                message.error(problem.message)
                return {status: "invalid", section: problem.section}
            }
            // `validateDraft` has checked the test set, which narrows the type for the starters.
            const {testset} = draft
            if (!testset) return {status: "invalid", section: "testset"}
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
