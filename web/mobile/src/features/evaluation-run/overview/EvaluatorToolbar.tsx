import {useMemo} from "react"

import type {
    EvaluatorRow,
    EvaluatorRowSort,
    EvaluatorRowsView,
} from "@agenta/entities/evaluationRun"
import {useT} from "@agenta/i18n"
import runOverviewCatalog from "@agenta/i18n/catalogs/evaluations.runOverview"
import {FilterMenu, GroupMenu, type FilterMenuItem} from "@agenta/ui/filter-menu"
import {
    Button,
    DropdownMenu,
    DropdownMenuContent,
    DropdownMenuRadioGroup,
    DropdownMenuRadioItem,
    DropdownMenuTrigger,
    PageToolbar,
} from "@agenta/ui/ui"
import {ArrowsDownUpIcon} from "@phosphor-icons/react"

const SORTS: EvaluatorRowSort[] = ["lowest", "name"]

/**
 * Search, filter by evaluator, group and sort over the evaluator table (decision 11). It changes
 * the table only: the chart above it keeps every metric.
 */
export const EvaluatorToolbar = ({
    rows,
    view,
    onChange,
}: {
    /** Every row of the run, before the toolbar: the filter lists them all. */
    rows: readonly EvaluatorRow[]
    view: EvaluatorRowsView
    onChange: (view: EvaluatorRowsView) => void
}) => {
    const t = useT(runOverviewCatalog)
    const sortOption = (sort: EvaluatorRowSort) =>
        sort === "name"
            ? t("evaluations.runOverview.sortOptionName")
            : t("evaluations.runOverview.sortOptionLowestFirst")

    const allKeys = useMemo(() => rows.map((row) => row.stepKey), [rows])
    const shownKeys = allKeys.filter((key) => !view.hidden.includes(key))
    const sections: FilterMenuItem[] = [
        {
            key: "evaluator",
            label: t("evaluations.runOverview.evaluator"),
            multi: true,
            searchable: true,
            value: shownKeys,
            defaultValue: allKeys,
            valueLabel:
                shownKeys.length === allKeys.length
                    ? t("evaluations.runOverview.filterAllEvaluators")
                    : t("evaluations.runOverview.filterSomeEvaluators", {
                          shown: shownKeys.length,
                          total: allKeys.length,
                      }),
            options: rows.map((row) => ({value: row.stepKey, label: row.name})),
            onChange: (key) =>
                onChange({
                    ...view,
                    hidden: view.hidden.includes(key)
                        ? view.hidden.filter((hidden) => hidden !== key)
                        : [...view.hidden, key],
                }),
        },
    ]

    return (
        <PageToolbar
            className="mb-0"
            search={view.search}
            onSearchChange={(search) => onChange({...view, search})}
            searchPlaceholder={t("evaluations.runOverview.searchEvaluators")}
            actions={
                <>
                    <FilterMenu
                        sections={sections}
                        onReset={() => onChange({...view, hidden: []})}
                        resetDisabled={view.hidden.length === 0}
                    />
                    <GroupMenu
                        options={[
                            {value: "evaluator", label: t("evaluations.runOverview.evaluator")},
                        ]}
                        value="evaluator"
                        onChange={() => undefined}
                        label={t("evaluations.runOverview.groupByEvaluator")}
                    />
                    <DropdownMenu>
                        <DropdownMenuTrigger asChild>
                            <Button variant="outline" size="sm">
                                <ArrowsDownUpIcon size={14} aria-hidden />
                                {view.sort === "name"
                                    ? t("evaluations.runOverview.sortByName")
                                    : t("evaluations.runOverview.sortLowestFirst")}
                            </Button>
                        </DropdownMenuTrigger>
                        <DropdownMenuContent align="start">
                            <DropdownMenuRadioGroup
                                value={view.sort}
                                onValueChange={(sort) =>
                                    onChange({...view, sort: sort as EvaluatorRowSort})
                                }
                            >
                                {SORTS.map((sort) => (
                                    <DropdownMenuRadioItem key={sort} value={sort}>
                                        {sortOption(sort)}
                                    </DropdownMenuRadioItem>
                                ))}
                            </DropdownMenuRadioGroup>
                        </DropdownMenuContent>
                    </DropdownMenu>
                </>
            }
        />
    )
}
