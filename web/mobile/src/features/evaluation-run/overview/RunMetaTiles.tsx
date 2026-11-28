import type {ReactNode} from "react"

import type {RunTile, RunTileDetail} from "@agenta/entities/evaluationRun"
import {formatNumber, useT} from "@agenta/i18n"
import runOverviewCatalog from "@agenta/i18n/catalogs/evaluations.runOverview"
import {COARSE_POINTER_QUERY, useWindowMatch} from "@agenta/ui/hooks"
import {Button, Popover, PopoverContent, PopoverTrigger, SimpleTooltip} from "@agenta/ui/ui"

/** The run's totals as tiles: test cases, passed, cost, duration, tokens, errors. */
export const RunMetaTiles = ({tiles, online}: {tiles: readonly RunTile[]; online: boolean}) => {
    const t = useT(runOverviewCatalog)
    // A tooltip does not open on a tap, so touch gets a popover (TOUCH-02).
    const touch = useWindowMatch(COARSE_POINTER_QUERY)
    const label = (tile: RunTile) =>
        tile.id === "testCases"
            ? online
                ? t("evaluations.runOverview.traces")
                : t("evaluations.runOverview.testCases")
            : t(`evaluations.runOverview.${tile.id}`)
    const detail = (value: RunTileDetail) => {
        switch (value.kind) {
            case "allFinished":
                return t("evaluations.runOverview.allFinished")
            case "someFailed":
                return t("evaluations.runOverview.someFailed")
            case "perCase":
                return t("evaluations.runOverview.perCaseAverage")
            case "perTrace":
                return t("evaluations.runOverview.perTraceAverage")
            case "total":
                return t("evaluations.runOverview.total")
            case "testCasesPassed":
                return value.thatRan
                    ? t("evaluations.runOverview.testCasesThatRan", {
                          passed: formatNumber(value.passed),
                          total: formatNumber(value.total),
                      })
                    : t("evaluations.runOverview.testCasesPassed", {
                          passed: formatNumber(value.passed),
                          total: formatNumber(value.total),
                      })
            case "notRun":
                return t("evaluations.runOverview.notRun", {count: value.count})
            case "errorsSplit":
                return t("evaluations.runOverview.errorsSplit", {
                    runs: formatNumber(value.runs),
                    evaluator: formatNumber(value.evaluator),
                })
        }
    }

    return (
        <div className="grid grid-cols-2 gap-2 sm:grid-cols-3 @min-[960px]/page:grid-cols-6">
            {tiles.map((tile) => (
                <div
                    key={tile.id}
                    data-testid={`tile-${tile.id}`}
                    className="box-border flex min-w-0 flex-col gap-0.5 rounded-lg border border-solid border-border px-4 py-3"
                >
                    <span className="truncate text-meta text-muted-foreground">{label(tile)}</span>
                    <span className="text-metric tabular-nums text-foreground">
                        {tile.detail?.kind === "notRun"
                            ? t("evaluations.runOverview.testCasesRan", {
                                  // The value of a not run tile is the count that ran.
                                  ran: formatNumber(Number(tile.value)),
                                  total: formatNumber(tile.detail.total),
                              })
                            : tile.value}
                    </span>
                    {tile.detail?.kind === "notRun" ? (
                        // Test cases that did not run are told here, not in an alert over the page.
                        <NotRunLine
                            touch={touch}
                            label={detail(tile.detail)}
                            explanation={
                                <>
                                    <span className="block">
                                        {t("evaluations.runOverview.notRunAlert", {
                                            count: tile.detail.count,
                                            total: tile.detail.total,
                                        })}
                                    </span>
                                    <span className="block">
                                        {t("evaluations.runOverview.notRunCounts")}
                                    </span>
                                </>
                            }
                        />
                    ) : tile.detail ? (
                        <span
                            className={`truncate text-meta ${
                                tile.detail.kind === "errorsSplit"
                                    ? "text-destructive"
                                    : "text-muted-foreground"
                            }`}
                        >
                            {detail(tile.detail)}
                        </span>
                    ) : null}
                    {tile.assertions ? (
                        <span className="text-caption text-muted-foreground">
                            {t("evaluations.runOverview.assertionsTrue", {
                                passed: formatNumber(tile.assertions.passed),
                                total: formatNumber(tile.assertions.total),
                            })}
                        </span>
                    ) : null}
                </div>
            ))}
        </div>
    )
}

const NOT_RUN_LINE =
    "max-w-full cursor-help self-start truncate text-meta text-destructive underline decoration-dotted underline-offset-2"

/** The "N did not run" line: a tooltip with a mouse or the keyboard, a popover on a tap. */
const NotRunLine = ({
    touch,
    label,
    explanation,
}: {
    touch: boolean
    label: string
    explanation: ReactNode
}) =>
    touch ? (
        <Popover>
            <PopoverTrigger asChild>
                <Button
                    type="button"
                    variant="ghost"
                    className={`${NOT_RUN_LINE} block h-auto rounded-none border-0 p-0 text-left font-normal hover:bg-transparent hover:text-destructive`}
                >
                    {label}
                </Button>
            </PopoverTrigger>
            <PopoverContent
                side="bottom"
                align="start"
                collisionPadding={16}
                className="w-auto max-w-[min(280px,calc(100vw-32px))] px-3 py-2 text-body-sm text-foreground"
            >
                {explanation}
            </PopoverContent>
        </Popover>
    ) : (
        <SimpleTooltip title={explanation}>
            <span tabIndex={0} className={NOT_RUN_LINE}>
                {label}
            </span>
        </SimpleTooltip>
    )
