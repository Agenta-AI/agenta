import {HumanEvaluationListTableDataType} from "@/components/Evaluations/HumanEvaluationResult"
import {Evaluation, GenericObject, Variant} from "../Types"
import {convertToCsv, downloadCsv} from "./utils"

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
