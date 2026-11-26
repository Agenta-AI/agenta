import {MetricCellContent, SmartCellContent} from "@agenta/ui/cell-renderers"

import {StatusTag} from "@/components/StatusTag"

import type {ScenarioCell} from "./scenarioColumns"

const EMPTY = <span className="text-muted-foreground">—</span>

/**
 * One value of a scenario. Text is cut to a few lines, flags are chips, objects and chat messages
 * are a short preview, scores and run metrics use the metric renderer. No value shows a dash.
 */
export const ScenarioCellValue = ({cell, lines = 3}: {cell: ScenarioCell; lines?: number}) => {
    const {value} = cell
    if (value === undefined || value === null || value === "") return EMPTY
    if (cell.kind === "metrics") {
        return <MetricCellContent value={value} metricKey={cell.path} className="text-xs" />
    }
    if (typeof value === "boolean") {
        return <StatusTag tone={value ? "live" : "muted"}>{String(value)}</StatusTag>
    }
    if (typeof value === "string" || typeof value === "number") {
        return (
            <p
                className="m-0 break-words text-sm"
                style={{
                    display: "-webkit-box",
                    WebkitBoxOrient: "vertical",
                    WebkitLineClamp: lines,
                    overflow: "hidden",
                }}
            >
                {String(value)}
            </p>
        )
    }
    if (cell.kind === "evaluator") {
        return <MetricCellContent value={value} metricKey={cell.path} className="text-xs" />
    }
    return <SmartCellContent value={value} maxLines={lines} showPopover={false} />
}
