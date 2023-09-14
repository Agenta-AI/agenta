import {GenericObject, KeyValuePair} from "../Types"

export const evaluateWithExactMatch = (string1: string, string2: string): Boolean => {
    return string1 === string2
}

export const evaluateWithSimilarityMatch = (string1: string, string2: string): number => {
    let set1 = new Set(string1.split(" "))
    let set2 = new Set(string2.split(" "))
    let intersect = new Set(Array.from(set1).filter((x) => set2.has(x)))
    let union = new Set(Array.from(set1).concat(Array.from(set2)))

    const similarity = intersect.size / union.size
    return similarity
}

export const evaluateWithRegex = (testString: string, regex: string, shouldMatch: boolean) => {
    //case insensitive regex
    const re = new RegExp(regex, "i")
    const result = re.test(testString)
    return result === shouldMatch
}

export const evaluateWithWebhook = async (webhookUrl: string, body: GenericObject) => {
    return fetch(webhookUrl, {
        method: "POST",
        body: JSON.stringify(body),
        headers: {"Content-Type": "application/json", Accept: "application/json"},
    })
        .then((res) => res.json())
        .then((data) => {
            if (isNaN(data.score)) throw new Error("Webhook did not return a score")
            if (data.score < 0 || data.score > 1)
                throw new Error("Webhook returned an invalid score. Score must be between 0 and 1")
            return data.score
        })
}
