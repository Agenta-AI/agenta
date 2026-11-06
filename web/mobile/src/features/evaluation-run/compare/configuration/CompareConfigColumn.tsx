import {runHeaderAtomFamily, runReferencesAtomFamily} from "@agenta/entities/evaluationRun"
import {useAtomValue} from "jotai"

import {ApplicationConfigSection} from "../../configuration/ApplicationConfigSection"
import {ConfigSection} from "../../configuration/ConfigSection"
import {EvaluatorsConfigSection} from "../../configuration/EvaluatorsConfigSection"
import {RunSummaryCard} from "../../configuration/RunSummaryCard"
import {ConfigurationSkeleton} from "../../configuration/states/ConfigurationSkeleton"
import {TestsetConfigSection} from "../../configuration/TestsetConfigSection"
import {useApplicationConfig} from "../../configuration/useApplicationConfig"
import {useEvaluatorConfigs} from "../../configuration/useEvaluatorConfigs"
import {CompareRowRun} from "../scenarios/CompareRowRun"

/**
 * One run's configuration in the compared Configuration tab, as the old app lays it out: the run
 * name in its color, its summary card, then its test set, application and evaluators. A section
 * the run lacks stays, with a note, so an absence reads as a difference.
 */
export const CompareConfigColumn = ({
    projectId,
    runId,
    slot,
}: {
    projectId: string
    runId: string
    slot: number
}) => {
    const header = useAtomValue(runHeaderAtomFamily(runId))
    const references = useAtomValue(runReferencesAtomFamily(runId))
    const application = useApplicationConfig(runId)
    const evaluators = useEvaluatorConfigs(runId)
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
                        />
                    ) : (
                        <ConfigSection id={`config-testset${suffix}`} title="Test set">
                            <p className="m-0 text-sm text-muted-foreground">
                                No linked test sets.
                            </p>
                        </ConfigSection>
                    )}
                    {application ? (
                        <ApplicationConfigSection application={application} idSuffix={suffix} />
                    ) : (
                        <ConfigSection id={`config-application${suffix}`} title="Application">
                            <p className="m-0 text-sm text-muted-foreground">
                                Application metadata unavailable.
                            </p>
                        </ConfigSection>
                    )}
                    <EvaluatorsConfigSection evaluators={evaluators} idSuffix={suffix} />
                </>
            ) : (
                <ConfigurationSkeleton />
            )}
        </section>
    )
}
