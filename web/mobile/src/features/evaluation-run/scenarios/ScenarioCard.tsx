import type {RunColumnGroup} from "@agenta/entities/evaluationRun/etl"

import {StatusTag} from "@/components/StatusTag"

import {RunStatusTag} from "../overview/RunStatusTag"

import {ScenarioCellValue} from "./ScenarioCellValue"
import {scoreText, type ScenarioRow} from "./scenarioColumns"

/** A scenario on a phone: its number and status, the first input and output, and its scores. */
export const ScenarioCard = ({
    row,
    groups,
    labels,
}: {
    row: ScenarioRow
    groups: RunColumnGroup[]
    labels: Record<string, string>
}) => {
    const firstOf = (kind: string) => {
        const group = groups.find((entry) => entry.group.kind === kind)
        return group ? row.cells[group.group.key]?.[0] : undefined
    }
    const input = firstOf("testset")
    const output = firstOf("application")
    const scores = groups.flatMap(({group}) => {
        if (group.kind !== "evaluator") return []
        const text = scoreText(row.cells[group.key]?.[0]?.value)
        return text ? [{key: group.key, label: labels[group.key] ?? group.label, text}] : []
    })

    return (
        <div className="flex min-w-0 flex-col gap-2">
            <div className="flex items-center justify-between gap-2">
                <span className="text-sm font-medium tabular-nums">#{row.index}</span>
                <RunStatusTag status={row.scenario.status ?? null} />
            </div>
            {input ? <ScenarioCellValue cell={input} lines={1} /> : null}
            {output ? <ScenarioCellValue cell={output} lines={2} /> : null}
            {scores.length > 0 ? (
                <div className="flex flex-wrap gap-1.5">
                    {scores.map((score) => (
                        <StatusTag key={score.key} tone="muted" className="max-w-full">
                            <span className="truncate">
                                {score.label}: {score.text}
                            </span>
                        </StatusTag>
                    ))}
                </div>
            ) : null}
        </div>
    )
}
