import type {RunHeader} from "@agenta/entities/evaluationRun"

import {RunOverviewView} from "./RunOverviewView"
import {useRunOverview} from "./useRunOverview"

/** The Overview tab: the run's overview data, laid out by `RunOverviewView`. */
export const OverviewTab = ({runId, header}: {runId: string; header: RunHeader}) => {
    const overview = useRunOverview(runId)
    return <RunOverviewView runId={runId} header={header} {...overview} />
}
