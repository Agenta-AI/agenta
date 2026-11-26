import {metricCellText} from "@agenta/entities/evaluationRun"
import {unwrapStatsForCompare} from "@agenta/entities/evaluationRun/etl"

import {StatusTag} from "@/components/StatusTag"

import {ScenarioCellValue} from "./ScenarioCellValue"
import type {ScenarioCell} from "./scenarioColumns"

/**
 * A metric value as the old app prints it: a flag as a chip, a number or a stat blob as text
 * (cost in dollars, duration in ms or s, tokens with K and M), no value as a dash. A value that
 * is not a metric (an object) is drawn as data.
 */
export const ScenarioMetricText = ({metricKey, value}: {metricKey: string; value: unknown}) => {
    const flag = unwrapStatsForCompare(value)
    if (typeof flag === "boolean") {
        // A grid cell stretches its child: the span keeps the chip as wide as its text.
        return (
            <span className="flex">
                <StatusTag tone={flag ? "live" : "muted"}>{String(flag)}</StatusTag>
            </span>
        )
    }
    const text = metricCellText(metricKey, value)
    if (text === null) {
        const cell: ScenarioCell = {name: metricKey, kind: "evaluator", path: metricKey, value}
        return <ScenarioCellValue cell={cell} />
    }
    return (
        <p
            className="m-0 break-words text-sm tabular-nums"
            title={text}
            style={{
                display: "-webkit-box",
                WebkitBoxOrient: "vertical",
                WebkitLineClamp: 3,
                overflow: "hidden",
            }}
        >
            {text === "—" ? <span className="text-muted-foreground">{text}</span> : text}
        </p>
    )
}
