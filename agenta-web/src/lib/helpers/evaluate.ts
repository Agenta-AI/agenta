import {HumanEvaluationListTableDataType} from "@/components/Evaluations/HumanEvaluationResult"
import {Evaluation, EvaluationScenario, GenericObject, Variant} from "../Types"
import {convertToCsv, downloadCsv} from "./fileManipulations"

export const exportABTestingEvaluationData = (
    evaluation: Evaluation,
    scenarios: EvaluationScenario[],
    rows: GenericObject[],
) => {
    const exportRow = rows.map((data, ix) => {
        const inputColumns = data.inputs.reduce(
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
            ["Expected answer"]:
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
        const inputColumns = data.inputs.reduce(
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
            ["Expected answer"]:
                scenarios[ix]?.correctAnswer || evaluation.testset.csvdata[ix].correct_answer,
            ["Additional notes"]: scenarios[ix]?.note,
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
