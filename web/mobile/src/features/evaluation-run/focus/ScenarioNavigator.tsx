import {useMemo, useState} from "react"

import type {EvaluationRunKind} from "@agenta/entities/evaluationRun"
import {Button, Combobox} from "@agenta/ui/ui"
import {copyToClipboard} from "@agenta/ui/utils"
import {CaretLeft, CaretRight, Check, Copy} from "@phosphor-icons/react"

import type {ScenarioRow} from "../scenarios/scenarioColumns"

import {scenarioNoun} from "./scenarioNoun"

/**
 * Moves between the loaded scenarios: Previous and Next, a searchable list of them, and a button
 * that copies the scenario id.
 */
export const ScenarioNavigator = ({
    kind,
    rows,
    current,
    nextLoading,
    hasNext,
    onSelect,
    onNext,
}: {
    kind: EvaluationRunKind
    rows: ScenarioRow[]
    current: ScenarioRow
    nextLoading: boolean
    hasNext: boolean
    onSelect: (scenarioId: string) => void
    onNext: () => void
}) => {
    const noun = scenarioNoun(kind)
    const [copied, setCopied] = useState(false)
    const position = rows.findIndex((row) => row.scenario.id === current.scenario.id)
    const options = useMemo(
        () =>
            rows.map((row) => ({
                value: row.scenario.id,
                label: `${noun} #${row.index}`,
                searchValue: `${noun} #${row.index} ${row.scenario.id}`,
            })),
        [rows, noun],
    )

    return (
        <div className="flex min-w-0 items-center gap-1.5">
            <Button
                variant="outline"
                size="icon-sm"
                aria-label="Previous"
                disabled={position <= 0}
                onClick={() => onSelect(rows[position - 1].scenario.id)}
            >
                <CaretLeft />
            </Button>
            <Button
                variant="outline"
                size="icon-sm"
                aria-label="Next"
                disabled={nextLoading || (position >= rows.length - 1 && !hasNext)}
                onClick={onNext}
            >
                <CaretRight />
            </Button>
            <Combobox
                aria-label={`Go to ${noun.toLowerCase()}`}
                className="min-w-0 flex-1"
                options={options}
                value={current.scenario.id}
                onChange={(next) => next && onSelect(next)}
            />
            <Button
                variant="outline"
                size="icon-sm"
                aria-label={`Copy ${noun.toLowerCase()} id`}
                onClick={async () => {
                    setCopied(await copyToClipboard(current.scenario.id))
                }}
            >
                {copied ? <Check /> : <Copy />}
            </Button>
        </div>
    )
}
