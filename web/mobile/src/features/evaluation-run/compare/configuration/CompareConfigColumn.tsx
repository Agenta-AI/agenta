import {
    runConfigDiff,
    runHeaderAtomFamily,
    runReferencesAtomFamily,
    type RunConfigIdentity,
    type RunReferences,
} from "@agenta/entities/evaluationRun"
import {useAtomValue} from "jotai"

import {ApplicationConfigSection} from "../../configuration/ApplicationConfigSection"
import {ConfigSection} from "../../configuration/ConfigSection"
import {EvaluatorsConfigSection} from "../../configuration/EvaluatorsConfigSection"
import {RunSummaryCard} from "../../configuration/RunSummaryCard"
import {ConfigurationSkeleton} from "../../configuration/states/ConfigurationSkeleton"
import {TestsetConfigSection} from "../../configuration/TestsetConfigSection"
import {useApplicationConfig} from "../../configuration/useApplicationConfig"
import {useEvaluatorConfigs, type EvaluatorConfig} from "../../configuration/useEvaluatorConfigs"
import {CompareRowRun} from "../scenarios/CompareRowRun"

/** What identifies a run's configuration, for the compare rule. */
const identityOf = (
    references: RunReferences | null,
    evaluators: readonly EvaluatorConfig[],
): RunConfigIdentity => ({
    testsets: (references?.testsets ?? []).map(({testsetId, revisionId}) => ({
        testsetId,
        revisionId: revisionId ?? null,
    })),
    applicationId: references?.applicationId ?? null,
    revisionId: references?.revisionId ?? null,
    revisionVersion: references?.revisionVersion ?? null,
    evaluators: evaluators.map(({evaluatorId, version}) => ({id: evaluatorId, version})),
})

/**
 * One run's configuration in the compared Configuration tab, as the old app lays it out: the run
 * name in its color, its summary card, then its test set, application and evaluators. A section
 * the run lacks stays, with a note, so an absence reads as a difference. A compared run marks the
 * fields that differ from the base run's with "Differs", as the old app does.
 */
export const CompareConfigColumn = ({
    projectId,
    runId,
    baseRunId,
    slot,
}: {
    projectId: string
    runId: string
    baseRunId: string
    slot: number
}) => {
    const header = useAtomValue(runHeaderAtomFamily(runId))
    const references = useAtomValue(runReferencesAtomFamily(runId))
    const application = useApplicationConfig(runId)
    const evaluators = useEvaluatorConfigs(runId)
    const baseReferences = useAtomValue(runReferencesAtomFamily(baseRunId))
    const baseEvaluators = useEvaluatorConfigs(baseRunId)
    const diff =
        runId === baseRunId || !references || !baseReferences
            ? null
            : runConfigDiff(
                  identityOf(references, evaluators),
                  identityOf(baseReferences, baseEvaluators),
              )
    const testsets = references?.testsets ?? []
    const suffix = `-${runId}`

    return (
        <section aria-label={header?.name ?? runId} className="flex min-w-0 flex-col gap-4">
            <div className="box-border rounded-lg border border-solid border-border bg-card px-3 py-2">
                <CompareRowRun slot={slot} name={header?.name ?? "…"} />
            </div>
            {header ? (
                <>
                    <RunSummaryCard runId={runId} header={header} />
                    {testsets.length > 0 ? (
                        <TestsetConfigSection
                            projectId={projectId}
                            testsets={testsets}
                            idSuffix={suffix}
                            differs={diff?.testset}
                        />
                    ) : (
                        <ConfigSection
                            id={`config-testset${suffix}`}
                            title="Test set"
                            differs={diff?.testset}
                        >
                            <p className="m-0 text-sm text-muted-foreground">
                                No linked test sets.
                            </p>
                        </ConfigSection>
                    )}
                    {application ? (
                        <ApplicationConfigSection
                            application={application}
                            idSuffix={suffix}
                            diff={diff ?? undefined}
                        />
                    ) : (
                        <ConfigSection id={`config-application${suffix}`} title="Application">
                            <p className="m-0 text-sm text-muted-foreground">
                                Application metadata unavailable.
                            </p>
                        </ConfigSection>
                    )}
                    <EvaluatorsConfigSection
                        evaluators={evaluators}
                        idSuffix={suffix}
                        diff={
                            diff
                                ? {evaluators: diff.evaluators, missing: diff.evaluatorsMissing}
                                : undefined
                        }
                    />
                </>
            ) : (
                <ConfigurationSkeleton />
            )}
        </section>
    )
}
