import {memo, useCallback, useMemo} from "react"

import {Table, Typography} from "antd"

import EvaluatorMetricsSpiderChart from "../EvaluatorMetircsSpiderChart"

import clsx from "clsx"

import {useAtomValue} from "jotai"
import {evaluationRunStateAtom} from "@/oss/lib/hooks/useEvaluationRunData/assets/atoms"

import {runMetricsStatsAtom} from "@/oss/lib/hooks/useEvaluationRunData/assets/atoms/runMetricsCache"
import VariantTag from "../../assets/VariantTag"
import EvalNameTag from "../../assets/EvalNameTag"
import {formatColumnTitle} from "@/oss/components/Filters/EditColumns/assets/helper"
import {FIXED_COLUMNS} from "./assets/constants"
import {formatCurrency, formatLatency, formatTokenUsage} from "@/oss/lib/helpers/formatters"
import TagWithLink from "../../assets/TagWithLink"

const EvalRunScoreTable = ({className}: {className?: string}) => {
    const evaluation = useAtomValue(evaluationRunStateAtom)
    const enrichedRun = evaluation?.enrichedRun

    const metrics = useAtomValue(runMetricsStatsAtom)

    const getFrequencyData = useCallback(
        (metric: any, returnPercentage = true) => {
            const trueEntry = (metric as any)?.frequency?.find((f: any) => f?.value === true)
            const total = (metric as any)?.count ?? 0
            return returnPercentage
                ? `${(((trueEntry?.count ?? 0) / total) * 100).toFixed(2)}%`
                : ((trueEntry?.count ?? 0) / total) * 100
        },
        [metrics],
    )

    const chartMetrics = useMemo(() => {
        const data: Array<{name: string; value: any}> = []
        const evaluators = enrichedRun?.evaluators

        if (Object.keys(metrics).length > 0) {
            Object.entries(metrics).forEach(([key, metric]) => {
                if (key.includes(".")) {
                    const [evalSlug, metricKey] = key.split(".")
                    const evaluator = evaluators?.find((e) => e.slug === evalSlug)

                    data.push({
                        name: `${evaluator?.name} - ${formatColumnTitle(metricKey)}`,
                        value:
                            "frequency" in metric
                                ? getFrequencyData(metric, false)
                                : metric.mean || "",
                    })
                }
            })
        }

        if (metrics) {
            if (data.length > 2) return data

            Object.entries(metrics).forEach(([key, metric]) => {
                if (!key.includes(".")) {
                    switch (data.length) {
                        case 1:
                            if (key === "duration" || key === "totalCost") {
                                data.push({
                                    name: `${formatColumnTitle(key)}`,
                                    value: metric.mean,
                                })
                            }
                            break
                        case 2:
                            if (key === "duration") {
                                data.push({
                                    name: `${formatColumnTitle(key)}`,
                                    value: metric.mean,
                                })
                            }
                            break
                        default:
                            return data
                    }
                }
            })
        }

        return data
    }, [metrics, enrichedRun])

    // Calculate the maximum score from chart metrics for the spider chart
    const maxScore = useMemo(() => {
        if (!chartMetrics || chartMetrics.length === 0) return 100

        const values = chartMetrics
            ?.map((metric) => (typeof metric.value === "number" ? metric.value : 0))
            .filter((value) => !isNaN(value) && isFinite(value))

        return values.length > 0 ? Math.max(...values) * 1.2 : 100 // Add 20% padding
    }, [chartMetrics])

    const dataSource = useMemo(() => {
        const data = []

        if (enrichedRun?.testsets) {
            const vars = {key: "testsets", title: "Test Sets"}
            enrichedRun?.testsets.forEach((t) => {
                vars["id"] = t.id
                vars["label"] = <TagWithLink name={t.name} href={`/testsets/${t.id}`} />
            })

            data.push(vars)
        }

        if (enrichedRun) {
            data.push({
                key: "evaluations",
                title: "Evaluations",
                id: enrichedRun.id,
                label: <EvalNameTag id={enrichedRun.id} name={enrichedRun.name} color="blue" />,
            })
        }

        if (enrichedRun?.variants) {
            const vars = {key: "variants", title: "Variants"}
            enrichedRun?.variants.forEach((v) => {
                vars["id"] = v.id
                vars["label"] = (
                    <VariantTag id={v.id} variantName={v.variantName} revision={v.revision} />
                )
            })

            data.push(vars)
        }

        const evaluatorMetircs = []
        if (metrics) {
            Object.entries(metrics).forEach(([key, metric]) => {
                const _metric = metric.mean
                    ? key === "totalCost"
                        ? formatCurrency(metric.mean)
                        : key === "tokens"
                          ? formatTokenUsage(metric.mean)
                          : key === "duration"
                            ? formatLatency(metric.mean)
                            : metric.mean
                    : typeof metric.unique?.[0] === "boolean"
                      ? getFrequencyData(metric)
                      : ""

                if (_metric) {
                    const label = key.split(".")

                    if (label.length < 2) {
                        data.push({
                            title: (
                                <div className="flex items-center gap-2">
                                    {formatColumnTitle(key)}{" "}
                                    {metric.mean && <span className="text-[#586673]">(mean)</span>}
                                </div>
                            ),
                            key: key,
                            id: key,
                            label: _metric,
                        })
                    } else {
                        const evaluator = enrichedRun?.evaluators?.find((e) => e.slug === label[0])
                        evaluatorMetircs.push({
                            title: (
                                <div className="flex flex-col gap-0.5">
                                    <span className="text-[#586673]">
                                        {evaluator?.name ?? formatColumnTitle(label[0] ?? "")}
                                    </span>
                                    <div className="flex items-center gap-2">
                                        {formatColumnTitle(label[1] ?? "")}{" "}
                                        {metric.mean && (
                                            <span className="text-[#586673]">(mean)</span>
                                        )}
                                    </div>
                                </div>
                            ),
                            key: key,
                            id: key,
                            label: _metric,
                        })
                    }
                }
            })
        }

        return [...data, ...evaluatorMetircs]
    }, [metrics, enrichedRun])

    return (
        <div className={clsx("border border-solid border-[#EAEFF5] rounded h-full", className)}>
            <div className="py-2 px-3 flex flex-col justify-center h-[60px] border-0 border-b border-solid border-[#EAEFF5]">
                <Typography.Text className="font-medium">Evaluator Scores Overview</Typography.Text>
                <Typography.Text className="text-[#758391]">
                    Average evaluator score across evaluations
                </Typography.Text>
            </div>

            <div className="p-2 w-full h-[calc(100%-60px)] flex gap-2 shrink-0">
                <div className="w-[50%]">
                    <Table
                        dataSource={dataSource}
                        columns={FIXED_COLUMNS}
                        pagination={false}
                        showHeader={false}
                        bordered
                        scroll={{x: "max-content"}}
                    />
                </div>
                <EvaluatorMetricsSpiderChart
                    className="w-[50%] h-full"
                    metrics={chartMetrics}
                    maxScore={maxScore}
                />
            </div>
        </div>
    )
}

export default memo(EvalRunScoreTable)
