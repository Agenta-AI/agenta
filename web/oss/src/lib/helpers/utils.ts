import {notification} from "antd"
import dayjs from "dayjs"
import utc from "dayjs/plugin/utc"
import yaml from "js-yaml"
import JSON5 from "json5"
import Router from "next/router"
import promiseRetry from "promise-retry"
import {v4 as uuidv4} from "uuid"

import {tryParsePartialJson} from "@/oss/components/Editor/plugins/code/tryParsePartialJson"
import {LlmProvider} from "@/oss/lib/helpers/llmProviders"

import {EvaluationType} from "../enums"
import {GenericObject} from "../Types"

import {getEnv} from "./dynamicEnv"
import {getErrorMessage} from "./errorHandler"

if (typeof window !== "undefined") {
    // @ts-ignore
    if (!window.Cypress) {
        dayjs.extend(utc)
    }
}

export const renameVariables = (name: string) => {
    if (name === "inputs") {
        return "Prompt Variables"
    } else {
        return name.charAt(0).toUpperCase() + name.slice(1).replace(/_/g, " ")
    }
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
    [EvaluationType.field_match_test]: "JSON Field Match",
    [EvaluationType.auto_json_diff]: "JSON Diff Match",
    [EvaluationType.auto_semantic_similarity]: "Semantic Similarity Match",
    [EvaluationType.auto_webhook_test]: "Webhook Test",
    [EvaluationType.single_model_test]: "Single Model Test",
    [EvaluationType.rag_faithfulness]: "RAG Faithfulness",
    [EvaluationType.rag_context_relevancy]: "RAG Context Relevancy",
}

export const apiKeyObject = (apiKeys: LlmProvider[]) => {
    if (!apiKeys) return {}

    return apiKeys.reduce((acc: GenericObject, {key, name}: GenericObject) => {
        if (key) acc[name] = key
        return acc
    }, {})
}

export const capitalize = (s: string) => {
    if (typeof s !== "string") return ""
    return s
        .split(" ")
        .map((word) => word.charAt(0).toUpperCase() + word.slice(1))
        .join(" ")
}

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

export const isDemo = () => {
    if (getEnv("NEXT_PUBLIC_AGENTA_LICENSE")) {
        return ["cloud", "ee", "cloud-dev"].includes(getEnv("NEXT_PUBLIC_AGENTA_LICENSE"))
    }
    return false
}

export const removeKeys = (obj: GenericObject, keys: string[]) => {
    const newObj = Object.assign({}, obj)
    for (const key of keys) {
        delete newObj[key]
    }
    return newObj
}

export const safeParse = (str: string, fallback: any = "") => {
    try {
        if (!str) return fallback
        return JSON5.parse(str)
    } catch (error) {
        return fallback
    }
}

/**
 * Parses a string using JSON5, falling back to tryParsePartialJson if parsing fails.
 * Returns the parsed object or null if parsing fails.
 */
export function safeJson5Parse(input: string): any | null {
    try {
        return JSON5.parse(input)
    } catch {
        return tryParsePartialJson(input)
    }
}

export const extractChatMessages = (testcase: any) => {
    if (testcase.messages)
        return formatMessages(normalizeMessages(parseStringToJson(testcase.messages)))
    if (testcase.chat) return formatMessages(normalizeMessages(parseStringToJson(testcase.chat)))

    const filteredEntries = Object.entries(testcase).filter(([key]) => key !== "correct_answer")

    for (const [_, value] of filteredEntries) {
        const parsedValue = parseStringToJson(value)
        if (Array.isArray(parsedValue)) {
            return formatMessages(parsedValue)
        }
    }

    return []
}

const parseStringToJson = (value: any) => {
    if (typeof value === "string") {
        try {
            return JSON5.parse(value)
        } catch {
            return value
        }
    }
    return value
}

const normalizeMessages = (messages: any) => {
    if (!Array.isArray(messages) && typeof messages === "object") {
        return [messages]
    }
    return messages
}

const formatMessages = (messages: any) => {
    if (typeof messages === "object" && !Array.isArray(messages)) {
        messages = Object.values(messages)
    }

    return Array.isArray(messages)
        ? messages.map(({role, content, id}) => ({role, content, id}))
        : []
}

export const getAgentaApiUrl = () => {
    const apiUrl = getEnv("NEXT_PUBLIC_AGENTA_API_URL")

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
                    console.error("Error: ", getErrorMessage(e))
                    console.error("Retry attempt: ", attempt)
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
                if (logErrors) console.error("Ignored error:", getErrorMessage(e))
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

export const shortPoll = (
    func: Function,
    {delayMs, timeoutMs = 2000}: {delayMs: number; timeoutMs?: number},
) => {
    const startTime = Date.now()
    let shouldContinue = true

    const executor = async () => {
        while (shouldContinue && Date.now() - startTime < timeoutMs) {
            await func()
            await delay(delayMs)
        }
        if (Date.now() - startTime >= timeoutMs) throw new Error("timeout")
    }

    const promise = executor()

    return {
        stopper: () => {
            shouldContinue = false
        },
        promise,
    }
}

export function pickRandom<T>(arr: T[], len: number) {
    const result: T[] = []
    const length = arr.length

    for (let i = 0; i < len; i++) {
        const randomIndex = Math.floor(Math.random() * length)
        result.push(arr[randomIndex])
    }

    return result
}

export function durationToStr(ms: number) {
    const duration = dayjs.duration(ms, "milliseconds")
    const days = Math.floor(duration.asDays())
    const hours = Math.floor(duration.asHours() % 24)
    const mins = Math.floor(duration.asMinutes() % 60)
    const secs = Math.floor(duration.asSeconds() % 60)

    if (days > 0) return `${days}d ${hours}h`
    if (hours > 0) return `${hours}h ${mins}m`
    if (mins > 0) return `${mins}m ${secs}s`
    return `${secs}s`
}

type DayjsDate = Parameters<typeof dayjs>[0]
export function getDurationStr(date1: DayjsDate, date2: DayjsDate) {
    const d1 = dayjs(date1)
    const d2 = dayjs(date2)

    return durationToStr(d2.diff(d1, "milliseconds"))
}

export const generateOrRetrieveDistinctId = (): string => {
    if (typeof localStorage !== "undefined") {
        let distinctId = localStorage.getItem("posthog_distinct_id")
        if (!distinctId) {
            distinctId = uuidv4()
            localStorage.setItem("posthog_distinct_id", distinctId)
        }
        return distinctId
    } else {
        return uuidv4()
    }
}

export const redirectIfNoLLMKeys = async ({secrets: providerKeys}: {secrets: LlmProvider[]}) => {
    if (providerKeys?.length === 0 && !isDemo()) {
        notification.error({
            message: "LLM Key Missing",
            description: "Please provide at least one LLM key to access this feature.",
            duration: 5,
        })
        Router.push("/settings?tab=secrets")
        return true
    }
    return false
}

export const randNum = (min: number, max: number) =>
    Math.floor(Math.random() * (max - min + 1) + min)

export const snakeToTitle = (str: string) => {
    return str
        .split("_")
        .map((word) => word.charAt(0).toUpperCase() + word.slice(1))
        .join(" ")
}

export const getInitials = (str: string, limit = 2) => {
    let initialText = "E"

    try {
        initialText = str
            ?.split(" ")
            .slice(0, limit)
            ?.reduce((acc, curr) => acc + (curr[0] || "")?.toUpperCase(), "")
    } catch (error) {
        console.error("Error using getInitials", error)
    }

    return initialText
}

export const getStringOrJson = (value: any) => {
    return typeof value === "string" ? value : JSON.stringify(value, null, 2)
}

export const getYamlOrJson = (format: "JSON" | "YAML", data: any) => {
    try {
        return format === "YAML" ? yaml.dump(data) : getStringOrJson(data)
    } catch (error) {
        return getStringOrJson(data)
    }
}

export const filterVariantParameters = ({
    record,
    key,
    include = true,
}: {
    record: Record<string, any>
    key: string
    include?: boolean
}) => {
    return Object.keys(record).reduce(
        (acc, curr) => {
            const condition = curr.includes(key)
            if ((record.hasOwnProperty(curr) && include && condition) || (!include && !condition)) {
                acc[curr] = record[curr]
            }
            return acc
        },
        {} as Record<string, any>,
    )
}

export const formatVariantIdWithHash = (variantId: string) => {
    const parts = variantId.split("-")
    return `# ${parts[parts.length - 1]}`
}

export const collectKeyPathsFromObject = (obj: any, prefix = ""): string[] => {
    const paths: string[] = []
    if (!obj || typeof obj !== "object") return paths

    for (const [key, value] of Object.entries(obj)) {
        const fullPath = prefix ? `${prefix}.${key}` : key

        if (key === "outputs") {
            paths.push(fullPath)
            continue
        }

        if (value && typeof value === "object" && !Array.isArray(value)) {
            const nestedPaths = collectKeyPathsFromObject(value, fullPath)
            paths.push(...nestedPaths)
        } else {
            paths.push(fullPath)
        }
    }

    return paths
}

export const getUsernameFromEmail = (email: string) => email.split("@")[0]

export const removeEmptyFromObjects = (obj: any): any => {
    if (Array.isArray(obj)) {
        return obj
            .map(removeEmptyFromObjects)
            .filter((item) => item && (typeof item !== "object" || Object.keys(item).length))
    }
    if (obj && typeof obj === "object") {
        return Object.entries(obj).reduce(
            (acc, [key, value]) => {
                const cleaned = removeEmptyFromObjects(value)
                if (cleaned !== null && cleaned !== undefined && cleaned !== "") {
                    acc[key] = cleaned
                }
                return acc
            },
            {} as Record<string, any>,
        )
    }
    return obj
}

export const isUuid = (id: string) => {
    // Check for full UUID format (8-4-4-4-12)
    const fullUuidRegex = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
    // Check for just the last segment of a UUID (12 hex characters)
    const uuidSegmentRegex = /^[0-9a-f]{12}$/i

    return fullUuidRegex.test(id) || uuidSegmentRegex.test(id)
}

export const getUniquePartOfId = (id: string) => {
    const parts = id.split("-")
    return parts[parts.length - 1]
}

export const convertToStringOrJson = (value: any) => {
    return typeof value === "string" ? value : JSON.stringify(value)
}
