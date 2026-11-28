import type {RunColumnGroup} from "@agenta/entities/evaluationRun/etl"

import {
    isFailedStatus,
    isTerminalScenarioStatus,
    type ScenarioRow,
} from "../scenarios/scenarioColumns"
import {ScenarioValuesError} from "../scenarios/states/ScenarioValuesError"

import {ScenarioFocusInputsTable} from "./ScenarioFocusInputsTable"
import {ScenarioFocusOutput} from "./ScenarioFocusOutput"
import type {useScenarioTrace} from "./useScenarioTrace"

/**
 * What the test case holds, read only: its inputs as one table, then the app output by its
 * shape. In the drawer this is the "Inputs and output" tab, with the tool calls of the app call
 * and the expected value; the Annotate tab shows it without them.
 */
export const ScenarioFocusBody = ({
    row,
    groups,
    onRetry,
    awaitingRun = false,
    trace,
    expectedKey = null,
}: {
    row: ScenarioRow
    groups: RunColumnGroup[]
    onRetry: () => void
    /** A human run's scenario whose app nobody ran yet: no output, and nothing is running. */
    awaitingRun?: boolean
    trace?: ReturnType<typeof useScenarioTrace>
    /** The test case column an evaluator compares the output with. */
    expectedKey?: string | null
}) => {
    const cellsOf = (kind: string) =>
        groups
            .filter(({group}) => group.kind === kind)
            .flatMap(({group}) => row.cells[group.key] ?? [])
    const inputs = cellsOf("testset")
    const outputs = cellsOf("application")
    const outputGroups = groups.filter(({group}) => group.kind === "application")
    // A scenario can fail in its evaluators while the app answered: only the app's own result counts.
    const failed = row.invocation
        ? isFailedStatus(row.invocation.status)
        : isFailedStatus(row.scenario.status)
    const outputError = outputGroups.map(({group}) => row.errors[group.key]).find(Boolean) ?? null
    const outputKey = outputGroups.find(({group}) => row.steps[group.key])?.group.key
    const expectedCell = expectedKey ? inputs.find((cell) => cell.name === expectedKey) : undefined

    return (
        <div className="flex flex-col gap-6">
            {row.valuesFailed ? <ScenarioValuesError onRetry={onRetry} /> : null}
            {row.otherErrors.map((message, index) => (
                <p key={index} role="alert" className="m-0 break-words text-body text-destructive">
                    {message}
                </p>
            ))}
            {inputs.length > 0 ? <ScenarioFocusInputsTable cells={inputs} /> : null}
            {outputs.length > 0 || row.invocation?.traceId ? (
                <ScenarioFocusOutput
                    cells={outputs}
                    step={outputKey ? row.steps[outputKey] : null}
                    failed={failed}
                    error={outputError}
                    running={!isTerminalScenarioStatus(row.scenario.status)}
                    awaitingRun={awaitingRun}
                    trace={trace}
                    expected={
                        expectedCell && expectedKey
                            ? {key: expectedKey, value: expectedCell.value}
                            : null
                    }
                />
            ) : null}
        </div>
    )
}
