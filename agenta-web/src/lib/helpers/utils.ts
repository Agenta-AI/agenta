import dynamic from "next/dynamic"
import {EvaluationType} from "../enums"
import {GenericObject} from "../Types"
import Papa from "papaparse"

const llmAvailableProvidersToken = "llmAvailableProvidersToken"

export type LlmProvider = {
    title: string
    key: string
}

export const llmAvailableProviders: LlmProvider[] = [
    {title: "OpenAI", key: ""},
    {title: "Replicate", key: ""},
    {title: "Hugging Face", key: ""},
    {title: "Cohere", key: ""},
    {title: "Anthropic", key: ""},
    {title: "Azure", key: ""},
    {title: "TogetherAI", key: ""},
]

export const getAllLlmProviderKeysAsEnvVariable = () => {
    return {
        OPENAI_API_KEY: getLlmProviderKey("OpenAI"),
        REPLICATE_API_KEY: getLlmProviderKey("Replicate"),
        HUGGING_FACE_API_KEY: getLlmProviderKey("Hugging Face"),
        COHERE_API_KEY: getLlmProviderKey("Cohere"),
        ANTHROPIC_API_KEY: getLlmProviderKey("Anthropic"),
        AZURE_API_KEY: getLlmProviderKey("Azure"),
        TOGETHERAI_API_KEY: getLlmProviderKey("TogetherAI"),
    }
}

export const renameVariables = (name: string) => {
    return name.charAt(0).toUpperCase() + name.slice(1).replace(/_/g, " ")
}

export const renameVariablesCapitalizeAll = (name: string) => {
    const words = name.split("_")
    for (let i = 0; i < words.length; i++) {
        words[i] = words[i].charAt(0).toUpperCase() + words[i].slice(1)
    }
    return words.join(" ")
}

export const EvaluationTypeLabels: Record<EvaluationType, string> = {
    [EvaluationType.auto_exact_match]: "Exact Match",
    [EvaluationType.auto_similarity_match]: "Similarity Match",
    [EvaluationType.auto_ai_critique]: "AI Critic",
    [EvaluationType.human_a_b_testing]: "A/B Test",
    [EvaluationType.human_scoring]: "Scoring single variant",
    [EvaluationType.custom_code_run]: "Custom Code Run",
    [EvaluationType.auto_regex_test]: "Regex Test",
    [EvaluationType.auto_webhook_test]: "Webhook Test",
    [EvaluationType.single_model_test]: "Single Model Test",
}

export const getApikeys = () => {
    if (typeof window !== "undefined") {
        const llmAvailableProvidersTokenString = localStorage.getItem(llmAvailableProvidersToken)

        if (llmAvailableProvidersTokenString !== null) {
            const llmAvailableProvidersTokenArray = JSON.parse(llmAvailableProvidersTokenString)

            if (
                Array.isArray(llmAvailableProvidersTokenArray) &&
                llmAvailableProvidersTokenArray.length > 0
            ) {
                for (let i = 0; i < llmAvailableProvidersTokenArray.length; i++) {
                    if (llmAvailableProvidersTokenArray[i].key !== "") {
                        return llmAvailableProvidersTokenArray[i].key
                    }
                }
            }
        }
        return ""
    }
}

export const saveLlmProviderKey = (providerIdx: number, keyValue: string) => {
    if (typeof window !== "undefined") {
        // TODO: add encryption here
        const keys = JSON.parse(localStorage.getItem(llmAvailableProvidersToken) ?? "[{}]")
        keys[providerIdx].key = keyValue
        localStorage.setItem(llmAvailableProvidersToken, JSON.stringify(keys))
    }
}

export const getLlmProviderKey = (providerName: string) =>
    getAllProviderLlmKeys().find((item: LlmProvider) => item.title === providerName)

export const getAllProviderLlmKeys = () => {
    if (typeof window !== "undefined") {
        const inStorage = localStorage.getItem(llmAvailableProvidersToken)
        if (inStorage) {
            return JSON.parse(inStorage)
        }
        // if doesn't have the localStorage variable
        localStorage.setItem(llmAvailableProvidersToken, JSON.stringify(llmAvailableProviders))
    }

    return llmAvailableProviders
}

export const removeSingleLlmProviderKey = (providerIdx: number) => {
    if (typeof window !== "undefined") {
        const keys = JSON.parse(localStorage.getItem(llmAvailableProvidersToken) ?? "[{}]")
        keys[providerIdx].key = ""
        localStorage.setItem(llmAvailableProvidersToken, JSON.stringify(keys))
    }
}

export const removeLlmProviderKey = () => {
    if (typeof window !== "undefined") {
        localStorage.removeItem(llmAvailableProvidersToken)
    }
}

export const capitalize = (s: string) => {
    if (typeof s !== "string") return ""
    return s
        .split(" ")
        .map((word) => word.charAt(0).toUpperCase() + word.slice(1))
        .join(" ")
}

export const randString = (len: number = 8) =>
    window
        .btoa(
            Array.from(window.crypto.getRandomValues(new Uint8Array(len * 2)))
                .map((b) => String.fromCharCode(b))
                .join(""),
        )
        .replace(/[+/]/g, "")
        .substring(0, len)

export const isAppNameInputValid = (input: string) => {
    return /^[a-zA-Z0-9_-]+$/.test(input)
}

type RowType = Record<string, any>

export const convertToCsv = (rows: RowType[], header: string[]) => {
    return Papa.unparse({fields: header.filter((item) => !!item), data: rows})
}

export const downloadCsv = (csvContent: string, filename: string): void => {
    if (typeof window === "undefined") return

    const blob = new Blob([csvContent], {type: "text/csv"})
    const link = document.createElement("a")
    link.href = URL.createObjectURL(blob)
    link.download = filename
    document.body.appendChild(link)
    link.click()
    document.body.removeChild(link)
}

export const delay = (ms: number) => new Promise((res) => setTimeout(res, ms))

export const snakeToCamel = (str: string) =>
    str.replace(/([-_][a-z])/g, (group) => group.toUpperCase().replace("-", "").replace("_", ""))

export const camelToSnake = (str: string) =>
    str.replace(/([A-Z])/g, (group) => `_${group.toLowerCase()}`)

export const stringToNumberInRange = (text: string, min: number, max: number) => {
    // Calculate a hash value from the input string
    let hash = 0
    for (let i = 0; i < text.length; i++) {
        hash += text.charCodeAt(i)
    }

    // Map the hash value to the desired range
    const range = max - min + 1
    const mappedValue = ((hash % range) + range) % range

    // Add the minimum value to get the final result within the range
    const result = min + mappedValue

    return result
}

export const getInitials = (str: string, limit = 2) => {
    let initialText = "E"

    try {
        initialText = str
            ?.split(" ")
            .slice(0, limit)
            ?.reduce((acc, curr) => acc + (curr[0] || "")?.toUpperCase(), "")
    } catch (error) {
        console.log("Error using getInitials", error)
    }

    return initialText
}

export const isDemo = () => {
    if (process.env.NEXT_PUBLIC_FF) {
        return ["cloud", "ee"].includes(process.env.NEXT_PUBLIC_FF)
    }
    return false
}

export function dynamicComponent<T>(path: string, fallback: any = () => null) {
    return dynamic<T>(() => import(`@/components/${path}`), {
        loading: fallback,
        ssr: false,
    })
}

export const removeKeys = (obj: GenericObject, keys: string[]) => {
    let newObj = Object.assign({}, obj)
    for (let key of keys) {
        delete newObj[key]
    }
    return newObj
}

export const safeParse = (str: string, fallback: any = "") => {
    try {
        return JSON.parse(str)
    } catch (error) {
        console.log("error parsing JSON:", error)
        console.log("fallbacking to:", fallback)
        return fallback
    }
}
