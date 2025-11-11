import {useCallback} from "react"

import {useOrgData} from "@/oss/contexts/org.context"
import {formatDay} from "@/oss/lib/helpers/dateTimeHelper"
import dayjs from "@/oss/lib/helpers/dateTimeHelper/dayjs"
import {RunIndex, StepMeta} from "@/oss/lib/hooks/useEvaluationRunData/assets/helpers/buildRunIndex"
import {IStepResponse, StepResponseStep} from "@/oss/lib/hooks/useEvaluationRunScenarioSteps/types"
import useEvaluators from "@/oss/lib/hooks/useEvaluators"
import {EvaluatorDto} from "@/oss/lib/hooks/useEvaluators/types"
import {
    EnrichedEvaluationRun,
    EvaluationRun,
    IEvaluationRunDataStep,
} from "@/oss/lib/hooks/usePreviewEvaluations/types"
import {useVariants} from "@/oss/lib/hooks/useVariants"
import {EnhancedObjectConfig} from "@/oss/lib/shared/variant/genericTransformer/types"
import {AgentaConfigPrompt, EnhancedVariant} from "@/oss/lib/shared/variant/transformer/types"
import {WorkspaceMember, SnakeToCamelCaseKeys, PreviewTestSet} from "@/oss/lib/Types"

export const isAnnotationStep = ({
    step,
    evaluators,
}: {
    step: IStepResponse | IEvaluationRunDataStep
    evaluators: EvaluatorDto[]
}) => {
    // Prefer explicit evaluator reference if present (backend-generated runs)
    if ((step as IEvaluationRunDataStep).references?.evaluator) {
        return true
    }
    // Fallback for legacy runs where the step key equals the evaluator slug
    const allEvaluatorSlugs = evaluators.map((evaluator) => evaluator.slug)
    const evaluatorSlug = step.key.split(".")[1]
    return allEvaluatorSlugs.includes(evaluatorSlug) || allEvaluatorSlugs.includes(step.key)
}

export const getAnnotationSteps = ({
    steps,
    evaluators,
}: {
    steps: (SnakeToCamelCaseKeys<StepResponseStep> | IEvaluationRunDataStep)[]
    evaluators: EvaluatorDto[]
}) => {
    return steps.filter((step) =>
        isAnnotationStep({
            step,
            evaluators,
        }),
    )
}

export const enrichEvaluationRun = ({
    run: _run,
    testsets,
    variantsData,
    evaluators,
    members,
    runIndex,
}: {
    run: SnakeToCamelCaseKeys<EvaluationRun>
    testsets: PreviewTestSet[]
    variantsData: any
    evaluators: EvaluatorDto[]
    members: WorkspaceMember[]
    runIndex?: RunIndex
}) => {
    const run: Partial<EnrichedEvaluationRun> = _run
    // Convert snake_case keys to camelCase recursively
    run.createdAtTimestamp = dayjs(run.createdAt, "YYYY/MM/DD H:mm:ssAZ").valueOf()
    // Format creation date for display
    run.createdAt = formatDay({date: run.createdAt, outputFormat: "DD MMM YYYY | h:mm a"})
    // Derive potential ids via runIndex – allow multiple
    const testsetIds: string[] = []
    const revisionIds: string[] = []

    if (runIndex) {
        for (const meta of Object.values(runIndex.steps) as StepMeta[]) {
            if (meta.refs?.testset) {
                testsetIds.push(meta.refs.testset.id)
            }
            if (meta.refs?.applicationRevision) {
                revisionIds.push(meta.refs.applicationRevision.id)
            }
        }
    }

    const uniqueTestsetIds = Array.from(new Set(testsetIds))
    const uniqueRevisionIds = Array.from(new Set(revisionIds))

    // Resolve testset objects
    const resolvedTestsets = testsets
        ? (uniqueTestsetIds
              .flatMap((id) =>
                  testsets
                      ?.filter((ts) => ts.id === id)
                      .map((ts) => ({
                          ...ts,
                          name: ts.name,
                          createdAt: ts.created_at,
                          createdAtTimestamp: dayjs(
                              ts.created_at,
                              "YYYY/MM/DD H:mm:ssAZ",
                          ).valueOf(),
                          //   updatedAt: ts.updated_at,
                          //   updatedAtTimestamp: dayjs(
                          //       ts.updated_at,
                          //       "YYYY/MM/DD H:mm:ssAZ",
                          //   ).valueOf(),
                      })),
              )
              .filter(Boolean) as PreviewTestSet[])
        : []

    // Resolve the revision from the variants list
    const revisions = (
        (variantsData?.variants || []) as EnhancedVariant<
            EnhancedObjectConfig<AgentaConfigPrompt>
        >[]
    )?.filter((rev) => uniqueRevisionIds.includes(rev.id))

    const returnValue = {
        ...run,
        variants: revisions,
        testsets: resolvedTestsets,
        createdBy: members.find((member) => member.user.id === run.createdById),
    }
    if (runIndex) {
        // Find all annotation steps via index if available
        const annotationSteps = Array.from(runIndex.annotationKeys)
            .map((k) => {
                // locate original step for richer data
                return (run.data?.steps || []).find((s) => s.key === k) as
                    | IEvaluationRunDataStep
                    | undefined
            })
            .filter(Boolean)

        // Extract all evaluator slugs or IDs from those steps
        const evaluatorRefs = annotationSteps
            .map((step) => step?.references?.evaluator?.id)
            .filter((id): id is string => !!id)
        // Match evaluator objects using slug or id
        const matchedEvaluators = evaluatorRefs
            .map((id: string) => evaluators?.find((e) => e.slug === id || e.id === id))
            .filter(Boolean)
        returnValue.evaluators = matchedEvaluators as EvaluatorDto[]
    }

    return returnValue as EnrichedEvaluationRun
}

const useEnrichEvaluationRun = ({debug = false}: {debug?: boolean} = {}) => {
    const {selectedOrg} = useOrgData()
    const members = selectedOrg?.default_workspace?.members || []

    const {data: evaluators} = useEvaluators({preview: true})
    // @ts-ignore
    const {data: variantsData} = useVariants()()

    const enrichRun = useCallback(
        (
            run: SnakeToCamelCaseKeys<EvaluationRun>,
            testsetData?: PreviewTestSet[],
            runIndex?: RunIndex,
        ) => {
            return enrichEvaluationRun({
                run,
                testsets: testsetData || [],
                variantsData,
                evaluators: evaluators as EvaluatorDto[],
                members,
                runIndex,
            }) as EnrichedEvaluationRun
        },
        [variantsData, evaluators, members],
    )

    return !evaluators || !variantsData?.variants?.length ? null : enrichRun
}

export default useEnrichEvaluationRun
