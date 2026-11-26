import {formatMetricValue, METRIC_PLACEHOLDER} from "@agenta/entities/evaluationRun"
import {openTraceDrawerAtom} from "@agenta/observability/traceDrawer"
import {Badge, Button} from "@agenta/ui/ui"
import {Coins, Hash, Timer, TreeView} from "@phosphor-icons/react"
import {useSetAtom} from "jotai"

import {STEP_METRICS, type ScenarioStep} from "../scenarios/scenarioColumns"

const ICONS: Record<string, typeof Timer> = {duration: Timer, tokens: Hash, cost: Coins}

/**
 * What one step left behind, beside its section title: a button that opens the step's trace in
 * the trace drawer, then the time, tokens and cost of the step's own call.
 */
export const ScenarioStepTools = ({title, step}: {title: string; step: ScenarioStep}) => {
    const openTrace = useSetAtom(openTraceDrawerAtom)
    const {traceId} = step
    const badges = STEP_METRICS.flatMap(({id, metricKey, label}) => {
        const text = formatMetricValue(metricKey, step.metrics[metricKey])
        return text === METRIC_PLACEHOLDER ? [] : [{id, label, text}]
    })

    return (
        <div className="ml-auto flex flex-wrap items-center justify-end gap-1.5">
            {traceId ? (
                <Button
                    variant="outline"
                    size="icon-sm"
                    aria-label={`Open ${title} trace`}
                    title="Open trace"
                    onClick={() => openTrace({traceId})}
                >
                    <TreeView />
                </Button>
            ) : null}
            {badges.map(({id, label, text}) => {
                const Icon = ICONS[id]
                return (
                    <Badge
                        key={id}
                        variant="outlined"
                        className="tabular-nums"
                        title={label}
                        aria-label={`${label} ${text}`}
                        icon={<Icon size={12} aria-hidden />}
                    >
                        {text}
                    </Badge>
                )
            })}
        </div>
    )
}
