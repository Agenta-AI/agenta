import dayjs from "dayjs"
import capitalize from "lodash/capitalize"
import round from "lodash/round"

import AlertPopup from "@/oss/components/AlertPopup/AlertPopup"
import {runningStatuses} from "@/oss/components/pages/evaluations/cellRenderers/cellRenderers"
import {
    HumanEvaluationListTableDataType,
    SingleModelEvaluationListTableDataType,
} from "@/oss/lib/Types"
import {fetchEvaluatonIdsByResource} from "@/oss/services/evaluations/api"

import {EvaluationType} from "../enums"
import {
    Evaluation,
    GenericObject,
    TypedValue,
    Variant,
    _Evaluation,
    EvaluationScenario,
} from "../Types"

import {convertToCsv, downloadCsv} from "./fileManipulations"
import {formatCurrency, formatLatency} from "./formatters"
import {isDemo} from "./utils"

export const exportExactEvaluationData = (evaluation: Evaluation, rows: GenericObject[]) => {
    const exportRow = rows.map((data, ix) => {
        return {
            ["Inputs"]:
                evaluation.testset.csvdata[ix]?.[evaluation.testset.testsetChatColumn] ||
                data.inputs[0].input_value,
            [`App Variant ${evaluation.variants[0].variantName} Output`]: data?.columnData0
                ? data?.columnData0
                : data.outputs[0]?.variant_output,
            ["Correct answer"]: data.correctAnswer,
            ["Evaluation"]: data.score,
        }
    })
    const exportCol = Object.keys(exportRow[0])

    const csvData = convertToCsv(exportRow, exportCol)
    const filename = `${evaluation.appName}_${evaluation.variants[0].variantName}_${evaluation.evaluationType}.csv`
    downloadCsv(csvData, filename)
}

export const exportSimilarityEvaluationData = (evaluation: Evaluation, rows: GenericObject[]) => {
    const exportRow = rows.map((data, ix) => {
        return {
            ["Inputs"]:
                evaluation.testset.csvdata[ix]?.[evaluation.testset.testsetChatColumn] ||
                data.inputs[0].input_value,
            [`App Variant ${evaluation.variants[0].variantName} Output`]: data?.columnData0
                ? data?.columnData0
                : data.outputs[0]?.variant_output,
            ["Correct answer"]: data.correctAnswer,
            ["Score"]: data.score,
            ["Evaluation"]: data.similarity,
        }
    })
    const exportCol = Object.keys(exportRow[0])

    const csvData = convertToCsv(exportRow, exportCol)
    const filename = `${evaluation.appName}_${evaluation.variants[0].variantName}_${evaluation.evaluationType}.csv`
    downloadCsv(csvData, filename)
}

export const exportAICritiqueEvaluationData = (evaluation: Evaluation, rows: GenericObject[]) => {
    const exportRow = rows.map((data, ix) => {
        return {
            ["Inputs"]:
                evaluation.testset.csvdata[ix]?.[evaluation.testset.testsetChatColumn] ||
                data.inputs[0].input_value,
            [`App Variant ${evaluation.variants[0].variantName} Output`]: data?.columnData0
                ? data?.columnData0
                : data.outputs[0]?.variant_output,
            ["Correct answer"]: data.correctAnswer,
            ["Score"]: data.score,
        }
    })
    const exportCol = Object.keys(exportRow[0])

    const csvData = convertToCsv(exportRow, exportCol)
    const filename = `${evaluation.appName}_${evaluation.variants[0].variantName}_${evaluation.evaluationType}.csv`
    downloadCsv(csvData, filename)
}

export const exportABTestingEvaluationData = (
    evaluation: Evaluation,
    scenarios: EvaluationScenario[],
    rows: GenericObject[],
) => {
    const exportRow = rows.map((data, ix) => {
        const inputColumns = evaluation.testset.testsetChatColumn
            ? {Input: evaluation.testset.csvdata[ix]?.[evaluation.testset.testsetChatColumn]}
            : data.inputs.reduce(
                  (columns: any, input: {input_name: string; input_value: string}) => {
                      columns[`${input.input_name}`] = input.input_value
                      return columns
                  },
                  {},
              )
        return {
            ...inputColumns,
            [`App Variant ${evaluation.variants[0].variantName} Output 0`]: data?.columnData0
                ? data?.columnData0
                : data.outputs[0]?.variant_output,
            [`App Variant ${evaluation.variants[1].variantName} Output 1`]: data?.columnData1
                ? data?.columnData1
                : data.outputs[1]?.variant_output,
            ["Vote"]:
                evaluation.variants.find((v: Variant) => v.variantId === data.vote)?.variantName ||
                data.vote,
            ["Expected Output"]:
                scenarios[ix]?.correctAnswer || evaluation.testset.csvdata[ix].correct_answer,
            ["Additional notes"]: scenarios[ix]?.note,
        }
    })
    const exportCol = Object.keys(exportRow[0])

    const csvData = convertToCsv(exportRow, exportCol)
    const filename = `${evaluation.appName}_${evaluation.variants[0].variantName}_${evaluation.variants[1].variantName}_${evaluation.evaluationType}.csv`
    downloadCsv(csvData, filename)
}

export const exportSingleModelEvaluationData = (
    evaluation: Evaluation,
    scenarios: EvaluationScenario[],
    rows: GenericObject[],
) => {
    const exportRow = rows.map((data, ix) => {
        const inputColumns = evaluation.testset.testsetChatColumn
            ? {Input: evaluation.testset.csvdata[ix]?.[evaluation.testset.testsetChatColumn]}
            : data.inputs.reduce(
                  (columns: any, input: {input_name: string; input_value: string}) => {
                      columns[`${input.input_name}`] = input.input_value
                      return columns
                  },
                  {},
              )
        const numericScore = parseInt(data.score)
        return {
            ...inputColumns,
            [`App Variant ${evaluation.variants[0].variantName} Output 0`]: data?.columnData0
                ? data?.columnData0
                : data.outputs[0]?.variant_output,
            ["Score"]: isNaN(numericScore) ? "-" : numericScore,
            ["Expected Output"]:
                scenarios[ix]?.correctAnswer || evaluation.testset.csvdata[ix].correct_answer,
            ["Additional notes"]: scenarios[ix]?.note,
        }
    })
    const exportCol = Object.keys(exportRow[0])

    const csvData = convertToCsv(exportRow, exportCol)
    const filename = `${evaluation.appName}_${evaluation.variants[0].variantName}_${evaluation.evaluationType}.csv`
    downloadCsv(csvData, filename)
}

export const exportRegexEvaluationData = (
    evaluation: Evaluation,
    rows: GenericObject[],
    settings: GenericObject,
) => {
    const exportRow = rows.map((data, ix) => {
        const isCorrect = data.score === "correct"
        const isMatch = settings.regexShouldMatch ? isCorrect : !isCorrect

        return {
            ["Inputs"]:
                evaluation.testset.csvdata[ix]?.[evaluation.testset.testsetChatColumn] ||
                data.inputs[0].input_value,
            [`App Variant ${evaluation.variants[0].variantName} Output`]: data?.columnData0
                ? data?.columnData0
                : data.outputs[0]?.variant_output,
            ["Match / Mismatch"]: isMatch ? "Match" : "Mismatch",
            ["Evaluation"]: data.score,
        }
    })
    const exportCol = Object.keys(exportRow[0])

    const csvData = convertToCsv(exportRow, exportCol)
    const filename = `${evaluation.appName}_${evaluation.variants[0].variantName}_${evaluation.evaluationType}.csv`
    downloadCsv(csvData, filename)
}

export const exportWebhookEvaluationData = (evaluation: Evaluation, rows: GenericObject[]) => {
    const exportRow = rows.map((data, ix) => {
        return {
            ["Inputs"]:
                evaluation.testset.csvdata[ix]?.[evaluation.testset.testsetChatColumn] ||
                data.inputs[0].input_value,
            [`App Variant ${evaluation.variants[0].variantName} Output`]: data?.columnData0
                ? data?.columnData0
                : data.outputs[0]?.variant_output,
            ["Correct answer"]: data.correctAnswer,
            ["Score"]: data.score,
        }
    })
    const exportCol = Object.keys(exportRow[0])

    const csvData = convertToCsv(exportRow, exportCol)
    const filename = `${evaluation.appName}_${evaluation.variants[0].variantName}_${evaluation.evaluationType}.csv`
    downloadCsv(csvData, filename)
}

export const exportCustomCodeEvaluationData = (evaluation: Evaluation, rows: GenericObject[]) => {
    const exportRow = rows.map((data, ix) => {
        return {
            ["Inputs"]:
                evaluation.testset.csvdata[ix]?.[evaluation.testset.testsetChatColumn] ||
                data.inputs[0].input_value,
            [`App Variant ${evaluation.variants[0].variantName} Output`]: data?.columnData0
                ? data?.columnData0
                : data.outputs[0]?.variant_output,
            ["Correct answer"]: data.correctAnswer,
            ["Score"]: data.score,
        }
    })
    const exportCol = Object.keys(exportRow[0])

    const csvData = convertToCsv(exportRow, exportCol)
    const filename = `${evaluation.appName}_${evaluation.variants[0].variantName}_${evaluation.evaluationType}.csv`
    downloadCsv(csvData, filename)
}

export const calculateResultsDataAvg = (resultsData: Record<string, number>, multiplier = 10) => {
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

export const checkIfResourceValidForDeletion = async (
    data: Omit<Parameters<typeof fetchEvaluatonIdsByResource>[0], "appId">,
) => {
    if (isDemo()) {
        const response = await fetchEvaluatonIdsByResource(data)
        if (response.data.length > 0) {
            const name =
                (data.resourceType === "testset"
                    ? "Testset"
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
        default:
            return value?.toString()
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

export const removeCorrectAnswerPrefix = (str: string) => {
    return str.replace(/^correctAnswer_/, "")
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
            label: "Classifiers",
            value: "classifiers",
        },
        {
            label: "Similarity",
            value: "similarity",
        },
        {
            label: "AI / LLM",
            value: "ai_llm",
        },
        {
            label: "Functional",
            value: "functional",
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

export const calculateAvgScore = (evaluation: SingleModelEvaluationListTableDataType) => {
    let score = 0
    if (evaluation.scoresData) {
        score =
            ((evaluation.scoresData.correct?.length || evaluation.scoresData.true?.length || 0) /
                evaluation.scoresData.nb_of_rows) *
            100
    } else if (evaluation.resultsData) {
        const multiplier = {
            [EvaluationType.auto_webhook_test]: 100,
            [EvaluationType.single_model_test]: 1,
        }
        score = calculateResultsDataAvg(
            evaluation.resultsData,
            multiplier[evaluation.evaluationType as keyof typeof multiplier],
        )
        score = isNaN(score) ? 0 : score
    } else if (evaluation.avgScore) {
        score = evaluation.avgScore * 100
    }

    return score
}
