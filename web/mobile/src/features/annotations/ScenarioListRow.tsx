import type {ReactNode} from "react"

import {scenarioStatusLabel, scenarioStatusTone, type StatusTone} from "@agenta/annotation"
import {Checkbox, SimpleTooltip} from "@agenta/ui/ui"
import {CheckCircle} from "@phosphor-icons/react"

import {ScenarioEvaluatorCell} from "./ScenarioEvaluatorCell"
import {ScenarioItemCell} from "./ScenarioItemCell"
import type {EvaluatorColumn} from "./scenarioListColumns"
import {ScenarioRowMenu} from "./ScenarioRowMenu"
import {ScenarioStatusBadge} from "./ScenarioStatusBadge"
import type {ScenarioRow} from "./useScenarioRows"

const DOT_COLOR: Record<StatusTone, string> = {
    default: "text-muted-foreground",
    processing: "text-info",
    success: "text-success",
    warning: "text-warning",
    error: "text-error",
}

/** Clicks and keys inside this cell belong to its control, not to the row. */
const OwnClicks = ({children, className}: {children: ReactNode; className?: string}) => (
    <span
        className={className}
        onClick={(event) => event.stopPropagation()}
        onKeyDown={(event) => event.stopPropagation()}
    >
        {children}
    </span>
)

/**
 * One item's cells, in column order: the checkbox, the position with a status mark, the item, one
 * cell per evaluator, the status and the menu.
 */
export const ScenarioListRow = ({
    row,
    columns,
    selected,
    onSelectedChange,
    onAnnotate,
    onOpenInFocus,
}: {
    row: ScenarioRow
    columns: EvaluatorColumn[]
    selected: boolean
    onSelectedChange: (selected: boolean) => void
    onAnnotate: () => void
    onOpenInFocus: () => void
}) => (
    <>
        <OwnClicks className="flex items-center">
            <Checkbox
                aria-label={`Select item ${row.index + 1}`}
                checked={selected}
                onCheckedChange={(checked) => onSelectedChange(checked === true)}
            />
        </OwnClicks>
        <SimpleTooltip title={scenarioStatusLabel(row.status)}>
            <span className="flex items-center gap-1.5 text-[13px] tabular-nums text-muted-foreground">
                {row.status === "success" ? (
                    <CheckCircle aria-hidden size={14} weight="fill" className="text-success" />
                ) : (
                    <span
                        aria-hidden
                        className={`size-1.5 rounded-full bg-current ${DOT_COLOR[scenarioStatusTone(row.status)]}`}
                    />
                )}
                {row.index + 1}
            </span>
        </SimpleTooltip>
        <ScenarioItemCell scenarioId={row.scenarioId} />
        {columns.map((column) => (
            <ScenarioEvaluatorCell
                key={column.key}
                scenarioId={row.scenarioId}
                metrics={column.metrics}
            />
        ))}
        <span className="flex">
            <ScenarioStatusBadge status={row.status} />
        </span>
        <OwnClicks className="flex justify-end">
            <ScenarioRowMenu onAnnotate={onAnnotate} onOpenInFocus={onOpenInFocus} />
        </OwnClicks>
    </>
)
