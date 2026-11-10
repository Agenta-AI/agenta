import type {ReactNode} from "react"

import type {RunColumnGroup} from "@agenta/entities/evaluationRun/etl"
import {openTraceDrawerAtom} from "@agenta/observability/traceDrawer"
import {Button, SkeletonBlock} from "@agenta/ui/ui"
import {useSetAtom} from "jotai"

import {
    isFailedStatus,
    isTerminalScenarioStatus,
    type ScenarioRow,
} from "../scenarios/scenarioColumns"
import {ScenarioValuesError} from "../scenarios/states/ScenarioValuesError"

import {ScenarioFieldCard} from "./ScenarioFieldCard"
import {ScenarioFieldValue} from "./ScenarioFieldValue"
import {ScenarioMetricsBlock} from "./ScenarioMetricsBlock"
import {ScenarioSection} from "./ScenarioSection"
import {ScenarioStepTools} from "./ScenarioStepTools"

/** The sections of the drawer: which are folded, by section key. */
export interface ScenarioSectionsView {
    collapsed: ReadonlySet<string>
    onToggle: (key: string) => void
}

export const INPUTS_SECTION = "inputs"
export const OUTPUTS_SECTION = "outputs"

/**
 * What the scenario holds, read only: its inputs, the output of the app, then the metrics of each
 * evaluator. A step still running shows a placeholder; a failed one shows its error.
 *
 * With `view` (the scenario drawer), each part folds, and each step shows its trace button and
 * the time, tokens and cost of its own call. Without it (the Annotate tab) the parts are plain.
 */
export const ScenarioFocusBody = ({
    row,
    groups,
    labels,
    onRetry,
    view,
}: {
    row: ScenarioRow
    groups: RunColumnGroup[]
    labels: Record<string, string>
    onRetry: () => void
    view?: ScenarioSectionsView
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
    // A scenario can fail in its evaluators while the app answered: only the app's own result counts.
    const failed = row.invocation
        ? isFailedStatus(row.invocation.status)
        : isFailedStatus(row.scenario.status)
    const outputGroups = groups.filter(({group}) => group.kind === "application")
    const outputError = outputGroups.map(({group}) => row.errors[group.key]).find(Boolean)
    const traceId = row.invocation?.traceId ?? null

    /** A part of the scenario: foldable with step tools in the drawer, plain in the Annotate tab. */
    const part = ({
        key,
        label,
        title,
        stepKey,
        heading,
        children,
    }: {
        key: string
        label: string
        title: string
        stepKey?: string
        heading?: ReactNode
        children: ReactNode
    }) => {
        if (!view) {
            return (
                <section key={key} aria-label={label} className="flex flex-col gap-2">
                    {heading}
                    {children}
                </section>
            )
        }
        const step = stepKey ? row.steps[stepKey] : undefined
        return (
            <ScenarioSection
                key={key}
                label={label}
                title={title}
                collapsed={view.collapsed.has(key)}
                onToggle={() => view.onToggle(key)}
                tools={step ? <ScenarioStepTools title={title} step={step} /> : null}
            >
                {children}
            </ScenarioSection>
        )
    }

    const outputKey = outputGroups.find(({group}) => row.steps[group.key])?.group.key

    return (
        <div className="flex min-h-0 flex-1 flex-col gap-5 overflow-y-auto p-4 pt-2">
            {row.valuesFailed ? <ScenarioValuesError onRetry={onRetry} /> : null}
            {row.otherErrors.map((message, index) => (
                <p key={index} role="alert" className="m-0 break-words text-sm text-destructive">
                    {message}
                </p>
            ))}
            {inputs.length > 0
                ? part({
                      key: INPUTS_SECTION,
                      label: "Inputs",
                      title: "Inputs",
                      children: (
                          <div className="flex flex-col gap-2">
                              {inputs.map((cell) => (
                                  <ScenarioFieldCard key={cell.path || cell.name} label={cell.name}>
                                      <ScenarioFieldValue value={cell.value} />
                                  </ScenarioFieldCard>
                              ))}
                          </div>
                      ),
                  })
                : null}
            {outputs.length > 0 || traceId
                ? part({
                      key: OUTPUTS_SECTION,
                      label: "Outputs",
                      title: "Outputs",
                      stepKey: outputKey,
                      heading: (
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
                      ),
                      children: failed ? (
                          <p role="alert" className="m-0 text-sm text-destructive">
                              {outputError ?? "This run did not produce an output"}
                          </p>
                      ) : (
                          <div className="flex flex-col gap-2">
                              {outputs.map((cell) =>
                                  cell.value === undefined && open ? (
                                      <SkeletonBlock
                                          key={cell.path || cell.name}
                                          active
                                          aria-label="Running"
                                          className="h-16 w-full rounded-md"
                                      />
                                  ) : (
                                      <ScenarioFieldCard
                                          key={cell.path || cell.name}
                                          label={cell.name}
                                      >
                                          <ScenarioFieldValue value={cell.value} />
                                      </ScenarioFieldCard>
                                  ),
                              )}
                          </div>
                      ),
                  })
                : null}
            {evaluators.map(({group}) => {
                const cells = row.cells[group.key] ?? []
                const error = row.errors[group.key]
                if (cells.length === 0 && !error) return null
                const name = labels[group.key] ?? group.label
                return part({
                    key: group.key,
                    label: `${name} metrics`,
                    title: name,
                    stepKey: group.key,
                    heading: <h4 className="m-0 text-sm font-medium">{name}</h4>,
                    children: <ScenarioMetricsBlock cells={cells} error={error} />,
                })
            })}
        </div>
    )
}
