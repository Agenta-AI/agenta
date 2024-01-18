import {HumanEvaluationListTableDataType} from "@/components/Evaluations/HumanEvaluationResult"
import {Evaluation, GenericObject, TypedValue, Variant, _Evaluation} from "../Types"
import {convertToCsv, downloadCsv} from "./fileManipulations"
import {capitalize, round} from "lodash"
import dayjs from "dayjs"
import {runningStatuses} from "@/components/pages/evaluations/cellRenderers/cellRenderers"

export const exportABTestingEvaluationData = (evaluation: Evaluation, rows: GenericObject[]) => {
    const exportRow = rows.map((data, ix) => {
        return {
            ["Inputs"]:
                evaluation.testset.csvdata[ix]?.[evaluation.testset.testsetChatColumn] ||
                data.inputs[0].input_value,
            [`App Variant ${evaluation.variants[0].variantName} Output 0`]: data?.columnData0
                ? data?.columnData0
                : data.outputs[0]?.variant_output,
            [`App Variant ${evaluation.variants[1].variantName} Output 1`]: data?.columnData1
                ? data?.columnData1
                : data.outputs[1]?.variant_output,
            ["Vote"]:
                evaluation.variants.find((v: Variant) => v.variantId === data.vote)?.variantName ||
                data.vote,
        }
    })
    const exportCol = Object.keys(exportRow[0])

    const csvData = convertToCsv(exportRow, exportCol)
    const filename = `${evaluation.appName}_${evaluation.variants[0].variantName}_${evaluation.variants[1].variantName}_${evaluation.evaluationType}.csv`
    downloadCsv(csvData, filename)
}

export const exportSingleModelEvaluationData = (evaluation: Evaluation, rows: GenericObject[]) => {
    const exportRow = rows.map((data, ix) => {
        const numericScore = parseInt(data.score)
        return {
            ["Inputs"]:
                evaluation.testset.csvdata[ix]?.[evaluation.testset.testsetChatColumn] ||
                data.inputs[0].input_value,
            [`App Variant ${evaluation.variants[0].variantName} Output 0`]: data?.columnData0
                ? data?.columnData0
                : data.outputs[0]?.variant_output,
            ["Score"]: isNaN(numericScore) ? "-" : numericScore,
        }
    })
    const exportCol = Object.keys(exportRow[0])

    const csvData = convertToCsv(exportRow, exportCol)
    const filename = `${evaluation.appName}_${evaluation.variants[0].variantName}_${evaluation.evaluationType}.csv`
    downloadCsv(csvData, filename)
}

export const calculateResultsDataAvg = (
    resultsData: Record<string, number>,
    multiplier: number = 10,
) => {
    const obj = {...resultsData}
    Object.keys(obj).forEach((key) => {
        if (isNaN(+key)) delete obj[key]
    })

    const count = Object.values(obj).reduce((acc, value) => acc + +value, 0)
    const sum = Object.keys(obj).reduce((acc, key) => acc + (parseFloat(key) || 0) * +obj[key], 0)
    return (sum / count) * multiplier
}

export const getVotesPercentage = (record: HumanEvaluationListTableDataType, index: number) => {
    const variant = record.votesData.variants[index]
    return record.votesData.variants_votes_data[variant]?.percentage
}

export function getTypedValue(res?: TypedValue) {
    const {value, type} = res || {}
    return type === "number"
        ? round(Number(value), 2)
        : ["boolean", "bool"].includes(type as string)
          ? capitalize(value?.toString())
          : value?.toString()
}

export function getFilterParams(type: "number" | "text" | "date") {
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
        cellDataType: type,
        filterParams,
    }
}

export const calcEvalDuration = (evaluation: _Evaluation) => {
    return dayjs(
        runningStatuses.includes(evaluation.status) ? Date.now() : evaluation.updated_at,
    ).diff(dayjs(evaluation.created_at), "milliseconds")
}
