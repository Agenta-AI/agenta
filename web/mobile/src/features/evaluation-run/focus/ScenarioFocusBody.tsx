import type {RunColumnGroup} from "@agenta/entities/evaluationRun/etl"
import {openTraceDrawerAtom} from "@agenta/observability/traceDrawer"
import {Button, SkeletonBlock} from "@agenta/ui/ui"
import {useSetAtom} from "jotai"

import {isTerminalScenarioStatus, type ScenarioRow} from "../scenarios/scenarioColumns"
import {ScenarioValuesError} from "../scenarios/states/ScenarioValuesError"

import {ScenarioFieldCard} from "./ScenarioFieldCard"
import {ScenarioFieldValue} from "./ScenarioFieldValue"
import {ScenarioMetricsBlock} from "./ScenarioMetricsBlock"

const FAILED_STATUSES = new Set(["failure", "failed", "error", "errors"])
const isFailed = (status: string | null | undefined) =>
    typeof status === "string" && FAILED_STATUSES.has(status.toLowerCase())

/**
 * What the scenario holds, read only: its inputs, the output of the app, then the metrics of each
 * evaluator. A step still running shows a placeholder; a failed one says so.
 */
export const ScenarioFocusBody = ({
    row,
    groups,
    labels,
    onRetry,
}: {
    row: ScenarioRow
    groups: RunColumnGroup[]
    labels: Record<string, string>
    onRetry: () => void
}) => {
    const openTrace = useSetAtom(openTraceDrawerAtom)
    const cellsOf = (kind: string) =>
        groups
            .filter(({group}) => group.kind === kind)
            .flatMap(({group}) => row.cells[group.key] ?? [])
    const inputs = cellsOf("testset")
    const outputs = cellsOf("application")
    const evaluators = groups.filter(({group}) => group.kind === "evaluator")
    const open = !isTerminalScenarioStatus(row.scenario.status)
    const failed = isFailed(row.invocation?.status) || isFailed(row.scenario.status)
    const traceId = row.invocation?.traceId ?? null

    return (
        <div className="flex min-h-0 flex-1 flex-col gap-5 overflow-y-auto p-4 pt-2">
            {row.valuesFailed ? <ScenarioValuesError onRetry={onRetry} /> : null}
            {inputs.length > 0 ? (
                <section aria-label="Inputs" className="flex flex-col gap-2">
                    {inputs.map((cell) => (
                        <ScenarioFieldCard key={cell.path || cell.name} label={cell.name}>
                            <ScenarioFieldValue value={cell.value} />
                        </ScenarioFieldCard>
                    ))}
                </section>
            ) : null}
            {outputs.length > 0 || traceId ? (
                <section aria-label="Outputs" className="flex flex-col gap-2">
                    <div className="flex items-center justify-between gap-2">
                        <h4 className="m-0 text-sm font-medium">Outputs</h4>
                        {traceId ? (
                            <Button
                                variant="outline"
                                size="sm"
                                onClick={() => openTrace({traceId})}
                            >
                                Open trace
                            </Button>
                        ) : null}
                    </div>
                    {failed ? (
                        <p role="alert" className="m-0 text-sm text-destructive">
                            This run did not produce an output
                        </p>
                    ) : (
                        outputs.map((cell) =>
                            cell.value === undefined && open ? (
                                <SkeletonBlock
                                    key={cell.path || cell.name}
                                    active
                                    aria-label="Running"
                                    className="h-16 w-full rounded-md"
                                />
                            ) : (
                                <ScenarioFieldCard key={cell.path || cell.name} label={cell.name}>
                                    <ScenarioFieldValue value={cell.value} />
                                </ScenarioFieldCard>
                            ),
                        )
                    )}
                </section>
            ) : null}
            {evaluators.map(({group}) => {
                const cells = row.cells[group.key] ?? []
                if (cells.length === 0) return null
                return (
                    <ScenarioMetricsBlock
                        key={group.key}
                        evaluatorName={labels[group.key] ?? group.label}
                        cells={cells}
                    />
                )
            })}
        </div>
    )
}
