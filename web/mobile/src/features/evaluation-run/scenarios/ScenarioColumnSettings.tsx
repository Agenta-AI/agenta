import {columnGroupCheck, setColumnsVisible} from "@agenta/entities/evaluationRun"
import {Button, Checkbox, Popover, PopoverContent, PopoverTrigger} from "@agenta/ui/ui"
import {GearSix} from "@phosphor-icons/react"
import {useAtom} from "jotai"

import type {ScenarioColumnOption} from "./scenarioTableColumns"
import {hiddenScenarioColumnsAtomFamily} from "./scenarioTableState"

/**
 * The table settings: show or hide each column, or a whole group at once. A group's box is half
 * checked when only some of its columns show.
 */
export const ScenarioColumnSettings = ({
    runId,
    options,
}: {
    runId: string
    options: ScenarioColumnOption[]
}) => {
    const [hidden, setHidden] = useAtom(hiddenScenarioColumnsAtomFamily(runId))
    const hiddenCount = options
        .flatMap((option) => option.columns)
        .filter((column) => hidden.has(column.key)).length

    return (
        <Popover>
            <PopoverTrigger asChild>
                <Button size="sm" variant="outline" aria-label="Columns">
                    <GearSix aria-hidden size={14} />
                    <span className="hidden sm:inline">
                        {hiddenCount > 0 ? `Columns (${hiddenCount} hidden)` : "Columns"}
                    </span>
                </Button>
            </PopoverTrigger>
            <PopoverContent align="end" className="max-h-[420px] w-[260px] overflow-y-auto p-2">
                <div className="flex items-center justify-between px-1 pb-2">
                    <span className="text-xs font-medium text-muted-foreground">Columns</span>
                    {hiddenCount > 0 ? (
                        <Button size="sm" variant="ghost" onClick={() => setHidden(new Set())}>
                            Show all
                        </Button>
                    ) : null}
                </div>
                <ul className="m-0 flex list-none flex-col gap-1 p-0">
                    {options.map((option) => {
                        const keys = option.columns.map((column) => column.key)
                        const check = columnGroupCheck(keys, hidden)
                        return (
                            <li key={option.key} className="flex flex-col gap-1">
                                <label className="flex cursor-pointer items-center gap-2 rounded px-1 py-1 text-sm font-medium hover:bg-accent/60">
                                    <Checkbox
                                        checked={check}
                                        onCheckedChange={() =>
                                            setHidden(
                                                setColumnsVisible(hidden, keys, check !== true),
                                            )
                                        }
                                    />
                                    <span className="min-w-0 truncate">{option.label}</span>
                                </label>
                                <ul className="m-0 flex list-none flex-col p-0 pl-6">
                                    {option.columns.map((column) => (
                                        <li key={column.key}>
                                            <label className="flex cursor-pointer items-center gap-2 rounded px-1 py-1 text-sm hover:bg-accent/60">
                                                <Checkbox
                                                    aria-label={`${option.label}: ${column.label}`}
                                                    checked={!hidden.has(column.key)}
                                                    onCheckedChange={(checked) =>
                                                        setHidden(
                                                            setColumnsVisible(
                                                                hidden,
                                                                [column.key],
                                                                checked === true,
                                                            ),
                                                        )
                                                    }
                                                />
                                                <span className="min-w-0 truncate">
                                                    {column.label}
                                                </span>
                                            </label>
                                        </li>
                                    ))}
                                </ul>
                            </li>
                        )
                    })}
                </ul>
            </PopoverContent>
        </Popover>
    )
}
