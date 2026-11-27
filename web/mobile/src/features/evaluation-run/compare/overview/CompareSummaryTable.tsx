import {
    formatTileAmount,
    TILE_MISSING,
    type CompareSummaryRow,
    type RunTileId,
} from "@agenta/entities/evaluationRun"
import {useT} from "@agenta/i18n"
import runOverviewCatalog from "@agenta/i18n/catalogs/evaluations.runOverview"

import {isFailureDetail, useRunTileText} from "../../overview/RunMetaTiles"
import {compareColor} from "../compareColor"

import {useChangeText} from "./useChangeText"

/** A compared run's column: its color, its name, and its part in the change, if any. */
export interface CompareColumn {
    runId: string
    slot: number
    name: string
    role: "newest" | "before" | null
}

const LABEL_KEY = {
    testCases: "evaluations.runOverview.testCases",
    passed: "evaluations.runOverview.passed",
    cost: "evaluations.runOverview.costPerTestCase",
    duration: "evaluations.runOverview.durationPerTestCase",
    tokens: "evaluations.runOverview.tokensPerTestCase",
    errors: "evaluations.runOverview.errors",
} as const satisfies Record<RunTileId, string>

/** The color square of a run, before its name or its line. */
export const RunSwatch = ({slot}: {slot: number}) => (
    <span
        aria-hidden
        className="size-2 shrink-0 rounded-xs"
        style={{backgroundColor: compareColor(slot)}}
    />
)

/**
 * The tiles of every compared run side by side: one column per run with the tile's value and
 * lines, and the change of the newest run against the run before it.
 */
export const CompareSummaryTable = ({
    columns,
    rows,
}: {
    columns: readonly CompareColumn[]
    rows: readonly CompareSummaryRow[]
}) => {
    const t = useT(runOverviewCatalog)
    const {detail, assertions} = useRunTileText(false)
    const changeText = useChangeText()

    return (
        <section className="flex flex-col gap-2">
            <div className="box-border min-w-0 overflow-x-auto rounded-lg border border-solid border-border">
                <table className="w-full border-collapse text-left text-body">
                    <thead>
                        <tr className="bg-muted text-meta text-muted-foreground">
                            <th scope="col" className="px-3 py-2 font-normal">
                                {t("evaluations.runOverview.summary")}
                            </th>
                            {columns.map((column) => (
                                <th
                                    key={column.runId}
                                    scope="col"
                                    className="px-3 py-2 font-normal"
                                >
                                    <span className="flex min-w-0 items-center gap-1.5">
                                        <RunSwatch slot={column.slot} />
                                        <span className="truncate text-foreground">
                                            {column.name}
                                        </span>
                                        {column.role ? (
                                            <span className="shrink-0">
                                                {t(`evaluations.runOverview.${column.role}`)}
                                            </span>
                                        ) : null}
                                    </span>
                                </th>
                            ))}
                            <th scope="col" className="px-3 py-2 text-right font-normal">
                                {t("evaluations.runOverview.change")}
                            </th>
                        </tr>
                    </thead>
                    <tbody>
                        {rows.map((row) => (
                            <tr
                                key={row.id}
                                data-testid={`compare-summary-${row.id}`}
                                className="border-0 border-t border-solid border-border-muted"
                            >
                                <th
                                    scope="row"
                                    className="min-w-35 px-3 py-2 align-top text-label font-normal text-foreground"
                                >
                                    {t(LABEL_KEY[row.id])}
                                </th>
                                {row.tiles.map((cell, index) => {
                                    const tile = cell === "loading" ? null : cell
                                    return (
                                        <td
                                            key={columns[index]?.runId ?? index}
                                            className="min-w-30 px-3 py-2 align-top"
                                        >
                                            <span className="flex flex-col">
                                                <span className="tabular-nums text-foreground">
                                                    {cell === "loading"
                                                        ? "…"
                                                        : (tile?.value ?? TILE_MISSING)}
                                                </span>
                                                {tile?.detail ? (
                                                    <span
                                                        className={`text-meta ${
                                                            isFailureDetail(tile.detail)
                                                                ? "text-destructive"
                                                                : "text-muted-foreground"
                                                        }`}
                                                    >
                                                        {detail(tile.detail)}
                                                    </span>
                                                ) : null}
                                                {tile?.assertions ? (
                                                    <span className="text-caption text-muted-foreground">
                                                        {assertions(tile)}
                                                    </span>
                                                ) : null}
                                            </span>
                                        </td>
                                    )
                                })}
                                <td
                                    data-testid="compare-change"
                                    className="px-3 py-2 text-right align-top tabular-nums text-muted-foreground"
                                >
                                    {changeText(row.change, (value) =>
                                        formatTileAmount(row.id, value),
                                    )}
                                </td>
                            </tr>
                        ))}
                    </tbody>
                </table>
            </div>
            <p className="m-0 text-meta text-muted-foreground">
                {t("evaluations.runOverview.changeNote")}
            </p>
        </section>
    )
}
