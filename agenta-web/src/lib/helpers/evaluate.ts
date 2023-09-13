import {convertToCsv, downloadCsv} from "./utils"

export const exportExactEvaluationData = (evaluation: any, rows: any[]) => {
    const exportRow = rows.map((data) => {
        return {
            ["Inputs"]: data.inputs[0].input_value,
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

export const exportSimilarityEvaluationData = (evaluation: any, rows: any[]) => {
    const exportRow = rows.map((data) => {
        return {
            ["Inputs"]: data.inputs[0].input_value,
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

export const exportAICritiqueEvaluationData = (evaluation: any, rows: any[]) => {
    const exportRow = rows.map((data) => {
        return {
            ["Inputs"]: data.inputs[0].input_value,
            [`App Variant ${evaluation.variants[0].variantName} Output`]: data?.columnData0
                ? data?.columnData0
                : data.outputs[0]?.variant_output,
            ["Correct answer"]: data.correctAnswer,
            ["Score"]: data.evaluation,
        }
    })
    const exportCol = Object.keys(exportRow[0])

    const csvData = convertToCsv(exportRow, exportCol)
    const filename = `${evaluation.appName}_${evaluation.variants[0].variantName}_${evaluation.evaluationType}.csv`
    downloadCsv(csvData, filename)
}

export const exportABTestingEvaluationData = (evaluation: any, rows: any[]) => {
    const exportRow = rows.map((data) => {
        return {
            ["Inputs"]: data.inputs[0].input_value,
            [`App Variant ${evaluation.variants[0].variantName} Output 0`]: data?.columnData0
                ? data?.columnData0
                : data.outputs[0]?.variant_output,
            [`App Variant ${evaluation.variants[1].variantName} Output 1`]: data?.columnData1
                ? data?.columnData1
                : data.outputs[1]?.variant_output,
            ["Vote"]: data.vote,
        }
    })
    const exportCol = Object.keys(exportRow[0])

    const csvData = convertToCsv(exportRow, exportCol)
    const filename = `${evaluation.appName}_${evaluation.variants[0].variantName}_${evaluation.variants[1].variantName}_${evaluation.evaluationType}.csv`
    downloadCsv(csvData, filename)
}

export const exportRegexEvaluationData = (evaluation: any, rows: any[], settings: any) => {
    const exportRow = rows.map((data) => {
        const isCorrect = data.score === "correct"
        const isMatch = settings.regexShouldMatch ? isCorrect : !isCorrect

        return {
            ["Inputs"]: data.inputs[0].input_value,
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
