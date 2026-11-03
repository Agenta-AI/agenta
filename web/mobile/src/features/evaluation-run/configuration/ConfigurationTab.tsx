import {runReferencesAtomFamily, type RunHeader} from "@agenta/entities/evaluationRun"
import {useAtomValue} from "jotai"

import {ApplicationConfigSection} from "./ApplicationConfigSection"
import {ConfigSectionNav, type ConfigNavItem} from "./ConfigSectionNav"
import {EvaluatorsConfigSection} from "./EvaluatorsConfigSection"
import {RunSummaryCard} from "./RunSummaryCard"
import {TestsetConfigSection} from "./TestsetConfigSection"
import {useApplicationConfig} from "./useApplicationConfig"
import {useEvaluatorConfigs} from "./useEvaluatorConfigs"

/**
 * The Configuration tab: what the run was set up with. On a wide screen the summary card and the
 * section links sit in a rail that stays in view; on a phone the card comes first, then the
 * sections. Opening the tab only reads.
 */
export const ConfigurationTab = ({
    projectId,
    runId,
    header,
}: {
    projectId: string
    runId: string
    header: RunHeader
}) => {
    const references = useAtomValue(runReferencesAtomFamily(runId))
    const application = useApplicationConfig(references)
    const evaluators = useEvaluatorConfigs(references)
    const testsets = references?.testsets ?? []

    const nav: ConfigNavItem[] = [
        ...(testsets.length > 0
            ? [{id: "config-testset", label: "Test set", count: testsets.length}]
            : []),
        ...(application ? [{id: "config-application", label: "Application", count: 1}] : []),
        {id: "config-evaluators", label: "Evaluators", count: evaluators.length},
    ]

    return (
        <div className="grid min-w-0 grid-cols-1 gap-4 lg:grid-cols-[264px_minmax(0,1fr)]">
            <div className="flex min-w-0 flex-col gap-4 lg:sticky lg:top-4 lg:self-start">
                <RunSummaryCard projectId={projectId} runId={runId} header={header} />
                <ConfigSectionNav items={nav} />
            </div>
            <div className="flex min-w-0 flex-col gap-4">
                <TestsetConfigSection projectId={projectId} testsets={testsets} />
                {application ? <ApplicationConfigSection application={application} /> : null}
                <EvaluatorsConfigSection evaluators={evaluators} />
            </div>
        </div>
    )
}
