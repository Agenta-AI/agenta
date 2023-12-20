import dynamic from "next/dynamic"
import {EvaluationType} from "../enums"
import {GenericObject} from "../Types"
import promiseRetry from "promise-retry"
import {getErrorMessage} from "./errorHandler"

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

export const getAgentaApiUrl = () => {
    const apiUrl = process.env.NEXT_PUBLIC_AGENTA_API_URL

    if (!apiUrl && typeof window !== "undefined") {
        return `${window.location.protocol}//${window.location.hostname}`
    }

    return apiUrl
}

export function promisifyFunction(fn: Function, ...args: any[]) {
    return async () => {
        return fn(...args)
    }
}

export const withRetry = (
    fn: Function,
    options?: Parameters<typeof promiseRetry>[0] & {logErrors?: boolean},
) => {
    const {logErrors = true, ...config} = options || {}
    const func = promisifyFunction(fn)

    return promiseRetry(
        (retry, attempt) =>
            func().catch((e) => {
                if (logErrors) {
                    console.log("Error: ", getErrorMessage(e))
                    console.log("Retry attempt: ", attempt)
                }
                retry(e)
            }),
        {
            retries: 3,
            ...config,
        },
    )
}

export async function batchExecute(
    functions: Function[],
    options?: {
        batchSize?: number
        supressErrors?: boolean
        batchDelayMs?: number
        logErrors?: boolean
        allowRetry?: boolean
        retryConfig?: Parameters<typeof promiseRetry>[0]
    },
) {
    const {
        batchSize = 10,
        supressErrors = false,
        batchDelayMs = 2000,
        logErrors = true,
        allowRetry = true,
        retryConfig,
    } = options || {}

    functions = functions.map((f) => async () => {
        try {
            return await (allowRetry ? withRetry(f, {logErrors, ...(retryConfig || {})}) : f())
        } catch (e) {
            if (supressErrors) {
                if (logErrors) console.log("Ignored error:", getErrorMessage(e))
                return {__error: e}
            }
            throw e
        }
    })

    if (!batchSize || !Number.isInteger(batchSize) || batchSize <= 0)
        return Promise.all(functions.map((f) => f()))

    let position = 0
    let results: any[] = []

    while (position < functions.length) {
        const batch = functions.slice(position, position + batchSize)
        results = [...results, ...(await Promise.all(batch.map((f) => f())))]
        position += batchSize
        if (batchDelayMs) {
            await delay(batchDelayMs)
        }
    }
    return results
}

export const shortPoll = async (
    func: Function,
    {delayMs, timeoutMs = 2000}: {delayMs: number; timeoutMs?: number},
) => {
    let startTime = Date.now()
    let shouldContinue = true
    while (shouldContinue && Date.now() - startTime < timeoutMs) {
        try {
            shouldContinue = await func()
        } catch {}
        await delay(delayMs)
    }
}
