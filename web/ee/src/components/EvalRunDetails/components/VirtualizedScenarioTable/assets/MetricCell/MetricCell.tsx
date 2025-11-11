import {memo, useMemo} from "react"

import {Tag, Tooltip} from "antd"
import {useAtomValue} from "jotai"

import MetricDetailsPopover from "@/oss/components/HumanEvaluations/assets/MetricDetailsPopover" // adjust path if necessary
import {formatMetricValue} from "@/oss/components/HumanEvaluations/assets/MetricDetailsPopover/assets/utils" // same util used elsewhere
import {metricDataFamily} from "@/oss/lib/hooks/useEvaluationRunData/assets/atoms/runMetricsCache"

import {CellWrapper, Expandable} from "../CellComponents" // CellWrapper is default export? need to check.

import {AnnotationValueCellProps, MetricCellProps, MetricValueCellProps} from "./types"
import {loadableScenarioStepFamily} from "@/oss/lib/hooks/useEvaluationRunData/assets/atoms/scenarios"
import {STATUS_COLOR_TEXT} from "../../../EvalRunScenarioStatusTag/assets"
import clsx from "clsx"
import {getStatusLabel} from "@/oss/lib/constants/statusLabels"
import {EvaluationStatus} from "@/oss/lib/Types"

/*
 * MetricCell – common renderer for metric columns (scenario-level or evaluator-level).
 * Props:
 *  - metricKey: base metric name (without evaluator slug)
 *  - fullKey: full metric path as used in maps (e.g. "evaluator.slug.score")
 *  - value: value for current scenario row
 *  - distInfo: pre-computed distribution / stats for popover (optional)
 *  - metricType: primitive type from evaluator schema ("number", "boolean", "array", etc.)
 */

const MetricCell = memo<MetricCellProps>(
    ({hidePrimitiveTable = true, scenarioId, metricKey, fullKey, value, distInfo, metricType}) => {
        if (
            value === undefined ||
            value === null ||
            (typeof value === "object" && Object.keys(value).length === 0)
        ) {
            return (
                <CellWrapper>
                    <span className="text-gray-500">N/A</span>
                </CellWrapper>
            )
        }

        // Non-numeric arrays rendered as Tag list
        let formatted: React.ReactNode = formatMetricValue(metricKey, value)

        if (metricType === "boolean" && Array.isArray(value as any)) {
            const trueEntry = (distInfo as any).frequency.find((f: any) => f.value === true)
            const total = (distInfo as any).count ?? 0
            if (total) {
                return (
                    <div className="flex w-full gap-4">
                        <div className="flex flex-col text-xs leading-snug w-full grow">
                            <div className="flex flex-col w-full gap-1">
                                <div className="flex justify-between text-xs gap-2">
                                    <span className="text-[#95DE64] font-medium">true</span>
                                    <span className="text-[#97A4B0] font-medium">false</span>
                                </div>
                                <div className="h-2 bg-gray-200 rounded-full overflow-hidden">
                                    <div className="flex h-full">
                                        <div
                                            className="h-full bg-[#95DE64]"
                                            style={{
                                                width: `${((trueEntry?.count ?? 0) / total) * 100}%`,
                                            }}
                                        />
                                        <div
                                            className="h-full bg-[#97A4B0] text-xs"
                                            style={{
                                                width: `${((total - (trueEntry?.count ?? 0)) / total) * 100}%`,
                                            }}
                                        />
                                    </div>
                                </div>
                            </div>
                        </div>
                        <div className="self-stretch flex items-center justify-center">
                            {(((trueEntry?.count ?? 0) / total) * 100).toFixed(2)}
                        </div>
                    </div>
                )
            }
        }

        if (metricType === "array" || Array.isArray(value)) {
            const values = Array.isArray(value) ? value : [value]
            // const Component = metricType === "string" ? "span" : Tag
            formatted =
                metricType === "string" ? (
                    <div className="list-disc">
                        {values.map((it: any) => (
                            <li key={String(it)} className="capitalize">
                                {String(it)}
                            </li>
                        ))}
                    </div>
                ) : (
                    <div className="flex flex-col">
                        {values.map((it: any) => (
                            <Tag key={String(it)} className="capitalize">
                                {String(it)}
                            </Tag>
                        ))}
                    </div>
                )
        } else if (typeof value === "object") {
            // Extract primitive when wrapped in an object (e.g. { score, value, ... })
            if ("score" in value) value = (value as any).score
            else {
                const prim = Object.values(value).find(
                    (v) => typeof v === "number" || typeof v === "string",
                )
                value = prim !== undefined ? prim : JSON.stringify(value)
            }
        }

        // Boolean metrics – show raw value
        if (metricType === "boolean") {
            formatted = String(value)
        }

        // Wrap in popover when distInfo present
        if (distInfo && metricType !== "string") {
            return (
                <CellWrapper>
                    <MetricDetailsPopover
                        metricKey={metricKey}
                        extraDimensions={distInfo}
                        highlightValue={value}
                        hidePrimitiveTable={hidePrimitiveTable}
                        metricType={metricType}
                    >
                        <span className="cursor-pointer underline underline-offset-2">
                            {formatted}
                        </span>
                    </MetricDetailsPopover>
                </CellWrapper>
            )
        }

        return (
            <CellWrapper>
                <Expandable expandKey={`${scenarioId}-${metricKey}-${fullKey}`}>
                    {formatted}
                </Expandable>
            </CellWrapper>
        )
    },
)

// --- Wrapper cell that fetches the value from atoms ----------------------

const failureRunTypes = [EvaluationStatus.FAILED, EvaluationStatus.FAILURE, EvaluationStatus.ERROR]

export const MetricValueCell = memo<MetricValueCellProps>(
    ({scenarioId, metricKey, fullKey, metricType, evalType}) => {
        const param = useMemo(() => ({scenarioId, metricKey}), [scenarioId, metricKey])
        const {value, distInfo} = useAtomValue(metricDataFamily(param as any))
        const loadable = useAtomValue(loadableScenarioStepFamily(scenarioId))

        // TODO: remove this from here and create a function or something to also use in somewhere else
        // Last minute implementation for eval-checkpoint
        const errorStep = useMemo(() => {
            if (evalType !== "auto") return null
            if (loadable.state === "loading") return null
            const [evalSlug, key] = metricKey.split(".")
            if (!key) return null // if does not have key that means it's not an evaluator metric
            const _step = loadable.data?.steps?.find((s) => s.key === evalSlug)

            if (!_step) {
                const invocationStep = loadable.data?.invocationSteps?.find(
                    (s) => s.scenarioId === scenarioId,
                )

                if (failureRunTypes.includes(invocationStep?.status)) {
                    return {
                        status: invocationStep?.status,
                        error: invocationStep?.error?.stacktrace || invocationStep?.error?.message,
                    }
                }
                return null
            }

            if (failureRunTypes.includes(_step?.status)) {
                return {
                    status: _step?.status,
                    error: _step?.error?.stacktrace || _step?.error?.message,
                }
            }

            return null
        }, [loadable])

        // TODO: create a separate component for error
        if (errorStep?.status || errorStep?.error) {
            return (
                <Tooltip
                    title={errorStep?.error}
                    classNames={{body: "max-w-[200px] max-h-[300px] overflow-y-auto"}}
                >
                    <span
                        className={clsx(
                            STATUS_COLOR_TEXT[errorStep?.status],
                            "text-wrap cursor-help",
                        )}
                    >
                        {getStatusLabel(errorStep?.status)}
                    </span>
                </Tooltip>
            )
        }

        return (
            <MetricCell
                scenarioId={scenarioId}
                metricKey={metricKey}
                fullKey={fullKey}
                value={value}
                distInfo={distInfo}
                metricType={metricType}
            />
        )
    },
)

// --- Annotation value cell -----------------------------------------------

export const AnnotationValueCell = memo<AnnotationValueCellProps>(
    ({
        scenarioId,
        stepKey,
        name,
        fieldPath,
        metricKey,
        metricType,
        fullKey,
        distInfo: propsDistInfo,
    }) => {
        const stepSlug = stepKey?.includes(".") ? stepKey.split(".")[1] : undefined
        const param = useMemo(
            () => ({scenarioId, stepSlug, metricKey: metricKey || ""}),
            [scenarioId, stepSlug, metricKey],
        )
        const {value: metricVal, distInfo} = useAtomValue(metricDataFamily(param))

        return (
            <MetricCell
                scenarioId={scenarioId}
                metricKey={metricKey}
                fullKey={fullKey ?? fieldPath}
                value={metricVal}
                distInfo={distInfo}
                metricType={metricType}
            />
        )
    },
)

export default MetricCell
