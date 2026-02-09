import {formatCurrency, formatLatency} from "@agenta/oss/src/lib/helpers/formatters"
import {isDemo} from "@agenta/oss/src/lib/helpers/utils"
import {GenericObject, TypedValue, _Evaluation} from "@agenta/oss/src/lib/Types"
import dayjs from "dayjs"
import capitalize from "lodash/capitalize"
import round from "lodash/round"

import AlertPopup from "@/oss/components/AlertPopup/AlertPopup"
import {runningStatuses} from "@/oss/components/pages/evaluations/cellRenderers/cellRenderers"
import {fetchEvaluatonIdsByResource} from "@/oss/services/evaluations/api"

export const checkIfResourceValidForDeletion = async (
    data: Omit<Parameters<typeof fetchEvaluatonIdsByResource>[0], "appId">,
) => {
    if (isDemo()) {
        const response = await fetchEvaluatonIdsByResource(data)
        if (response.data.length > 0) {
            const name =
                (data.resourceType === "testset"
                    ? "Test set"
                    : data.resourceType === "evaluator_config"
                      ? "Evaluator"
                      : "Variant") + (data.resourceIds.length > 1 ? "s" : "")

            const suffix = response.data.length > 1 ? "s" : ""
            AlertPopup({
                title: `${name} is in use`,
                message: `The ${name} is currently in used by ${response.data.length} evaluation${suffix}. Please delete the evaluation${suffix} first.`,
                cancelText: null,
                okText: "Ok",
            })
            return false
        }
    }
    return true
}

export function getTypedValue(res?: TypedValue) {
    const {value, type, error} = res || {}
    if (type === "error") {
        return error?.message
    }

    if (value === undefined) return "-"

    switch (type) {
        case "number":
            return round(Number(value), 2)
        case "boolean":
        case "bool":
            return capitalize(value?.toString())
        case "cost":
            return formatCurrency(Number(value))
        case "latency":
            return formatLatency(Number(value))
        case "string":
        case "text":
            return value?.toString() ?? "-"
        case "code":
        case "regex":
            return value?.toString() ?? "-"
        case "object":
            return typeof value === "object"
                ? JSON.stringify(value, null, 2)
                : (value?.toString() ?? "-")
        case "messages":
            return Array.isArray(value)
                ? value
                      .map((msg) => (typeof msg === "string" ? msg : JSON.stringify(msg)))
                      .join("\n")
                : (value?.toString() ?? "-")
        case "multiple_choice":
            return Array.isArray(value) ? value.join(", ") : (value?.toString() ?? "-")
        case "hidden":
            return "-"
        default:
            return value?.toString() ?? "-"
    }
}

type CellDataType = "number" | "text" | "date"
export function getFilterParams(type: CellDataType) {
    const filterParams: GenericObject = {}
    if (type == "date") {
        filterParams.comparator = function (
            filterLocalDateAtMidnight: Date,
            cellValue: string | null,
        ) {
            if (cellValue == null) return -1
            const cellDate = dayjs(cellValue).startOf("day").toDate()
            if (filterLocalDateAtMidnight.getTime() === cellDate.getTime()) {
                return 0
            }
            if (cellDate < filterLocalDateAtMidnight) {
                return -1
            }
            if (cellDate > filterLocalDateAtMidnight) {
                return 1
            }
        }
    }

    return {
        sortable: true,
        floatingFilter: true,
        filter:
            type === "number"
                ? "agNumberColumnFilter"
                : type === "date"
                  ? "agDateColumnFilter"
                  : "agTextColumnFilter",
        cellDataType: type === "number" ? "text" : type,
        filterParams,
        comparator: getCustomComparator(type),
    }
}

export const calcEvalDuration = (evaluation: _Evaluation) => {
    return dayjs(
        runningStatuses.includes(evaluation.status.value) ? Date.now() : evaluation.updated_at,
    ).diff(dayjs(evaluation.created_at), "milliseconds")
}

const getCustomComparator = (type: CellDataType) => (valueA: string, valueB: string) => {
    const getNumber = (val: string) => {
        const num = parseFloat(val || "0")
        return isNaN(num) ? 0 : num
    }

    valueA = String(valueA)
    valueB = String(valueB)

    switch (type) {
        case "date":
            return dayjs(valueA).diff(dayjs(valueB))
        case "text":
            return valueA.localeCompare(valueB)
        case "number":
            return getNumber(valueA) - getNumber(valueB)
        default:
            return 0
    }
}

export const mapTestcaseAndEvalValues = (
    settingsValues: Record<string, any>,
    selectedTestcase: Record<string, any>,
) => {
    const testcaseObj: Record<string, any> = {}
    const evalMapObj: Record<string, any> = {}

    Object.entries(settingsValues).forEach(([key, value]) => {
        if (typeof value === "string" && value.startsWith("testcase.")) {
            testcaseObj[key] = selectedTestcase[value.split(".")[1]]
        } else {
            evalMapObj[key] = value
        }
    })

    return {testcaseObj, evalMapObj}
}

export const transformTraceKeysInSettings = (
    settingsValues: Record<string, any>,
): Record<string, any> => {
    return Object.keys(settingsValues).reduce(
        (acc, curr) => {
            if (
                !acc[curr] &&
                typeof settingsValues[curr] === "string" &&
                settingsValues[curr].startsWith("trace.")
            ) {
                acc[curr] = settingsValues[curr].replace("trace.", "")
            } else {
                acc[curr] = settingsValues[curr]
            }

            return acc
        },
        {} as Record<string, any>,
    )
}

export const getEvaluatorTags = () => {
    const evaluatorTags = [
        {
            label: "AI / LLM",
            value: "ai_llm",
        },
        {
            label: "Classifiers",
            value: "classifiers",
        },
        {
            label: "Similarity",
            value: "similarity",
        },
        {
            label: "Custom",
            value: "custom",
        },
    ]

    if (isDemo()) {
        evaluatorTags.unshift({
            label: "RAG",
            value: "rag",
        })
    }

    return evaluatorTags
}
