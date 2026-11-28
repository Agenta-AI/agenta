import {CopyValueButton, ValueCompareRows, ValueField} from "@agenta/chat/value-view"
import {useT} from "@agenta/i18n"
import valueViewCatalog from "@agenta/i18n/catalogs/chat.valueView"
import focusCatalog from "@agenta/i18n/catalogs/evaluations.scenarioFocus"
import {compareWithExpected, detectValueShape} from "@agenta/shared/utils"
import {Button, SkeletonBlock} from "@agenta/ui/ui"

import type {ScenarioCell, ScenarioStep} from "../scenarios/scenarioColumns"

import {ScenarioStepTools} from "./ScenarioStepTools"
import type {useScenarioTrace} from "./useScenarioTrace"

type ScenarioTrace = ReturnType<typeof useScenarioTrace>

/** The output to draw: one cell's value, or the cells by name when the app has several. */
const outputValue = (cells: ScenarioCell[]) =>
    cells.length === 1
        ? cells[0].value
        : Object.fromEntries(cells.map((cell) => [cell.name, cell.value]))

/** The line a trace that did not load leaves above the output, with Try again. */
const ToolCallsError = ({onRetry}: {onRetry: () => void}) => {
    const t = useT(focusCatalog)
    return (
        <div className="flex items-center gap-2 text-body-sm text-muted-foreground">
            <span>{t("evaluations.scenarioFocus.toolCallsFailed")}</span>
            <Button variant="outline" size="xs" onClick={onRetry}>
                {t("evaluations.scenarioFocus.tryAgain")}
            </Button>
        </div>
    )
}

/**
 * The app output, drawn by its shape; a chat shows the tool calls of each turn from its trace. An object output
 * shows next to the test case's expected value when an evaluator compares with a column. A failed
 * app call shows its error; a call still running shows a placeholder; a human run's test case
 * that nobody ran yet says so.
 */
export const ScenarioFocusOutput = ({
    cells,
    step,
    failed,
    error,
    running,
    awaitingRun,
    trace,
    expected,
}: {
    cells: ScenarioCell[]
    step: ScenarioStep | null
    failed: boolean
    error: string | null
    running: boolean
    awaitingRun: boolean
    /** Absent in the Annotate tab, which reads no trace. */
    trace?: ScenarioTrace
    /** The compared column and its value in this test case. */
    expected?: {key: string; value: unknown} | null
}) => {
    const t = useT(focusCatalog, valueViewCatalog)
    const value = outputValue(cells)
    const empty = cells.every((cell) => cell.value === undefined)
    const shape = failed || empty ? null : detectValueShape(value)
    const subtitle = failed
        ? t("evaluations.scenarioFocus.outputFailed")
        : shape?.shape === "messages"
          ? t("evaluations.scenarioFocus.outputMessages", {
                count: Array.isArray(shape.value) ? shape.value.length : 0,
            })
          : shape?.shape === "object-flat" || shape?.shape === "object-nested"
            ? t("evaluations.scenarioFocus.outputJson")
            : null
    const comparison = expected && !failed ? compareWithExpected(value, expected.value) : null

    const body = failed ? (
        <div role="alert" className="flex flex-col gap-1 rounded-lg bg-destructive/10 px-3 py-2.5">
            <span className="text-label text-destructive">
                {t("evaluations.scenarioFocus.appCallFailed")}
            </span>
            <span className="whitespace-pre-wrap break-words font-mono text-code-sm text-foreground">
                {error ?? t("evaluations.scenarioFocus.noOutputProduced")}
            </span>
        </div>
    ) : empty && awaitingRun ? (
        <p className="m-0 text-body text-muted-foreground">
            {t("evaluations.scenarioFocus.noOutputYet")}
        </p>
    ) : empty && running ? (
        <SkeletonBlock
            active
            aria-label={t("chat.valueView.running")}
            className="h-16 w-full rounded-md"
        />
    ) : (
        <div className="flex min-w-0 flex-col gap-3">
            {trace?.failed ? <ToolCallsError onRetry={trace.retry} /> : null}
            {comparison && expected ? (
                <ValueCompareRows comparison={comparison} expectedKey={expected.key} />
            ) : (
                <ValueField
                    value={value}
                    label={t("evaluations.scenarioFocus.output")}
                    turnActivity={trace?.turns}
                />
            )}
        </div>
    )

    return (
        <section aria-label={t("evaluations.scenarioFocus.output")} className="flex flex-col gap-2">
            <div className="flex min-h-7 flex-wrap items-center justify-between gap-2">
                <h3 className="m-0 flex items-baseline gap-2 text-label">
                    {t("evaluations.scenarioFocus.output")}
                    {subtitle ? (
                        <span className="text-meta font-normal text-muted-foreground">
                            {subtitle}
                        </span>
                    ) : null}
                </h3>
                <div className="flex items-center gap-1">
                    {step ? (
                        <ScenarioStepTools
                            title={t("evaluations.scenarioFocus.output")}
                            step={step}
                        />
                    ) : null}
                    {failed || empty ? null : (
                        <CopyValueButton
                            value={value}
                            label={t("evaluations.scenarioFocus.copyOutput")}
                        />
                    )}
                </div>
            </div>
            {body}
        </section>
    )
}
