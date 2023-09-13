import {KeyValuePair} from "../Types"

export const calculateResultsDataAvg = (resultsData: Record<string, number>) => {
    const count = Object.values(resultsData).reduce((acc, value) => acc + +value, 0)
    const sum = Object.keys(resultsData).reduce(
        (acc, key) => acc + parseFloat(key) * +resultsData[key],
        0,
    )
    return sum / count
}
