import {isEE} from "@agenta/shared/api"
import type {LlmProvider} from "@agenta/shared/types"
import {
    dataUriToObjectUrl,
    isBase64,
    isSlugInputValid,
    isUrl,
    removeEmptyFromObjects as sharedRemoveEmptyFromObjects,
    safeJson5Parse,
} from "@agenta/shared/utils"
import {dayjs} from "@agenta/shared/utils/dateTime"
import {notification} from "antd"
import JSON5 from "json5"
import Router from "next/router"
import {v4 as uuidv4} from "uuid"

import {waitForValidURL} from "@/oss/state/url"

import {GenericObject} from "../Types"

export const isDemo = () => {
    return isEE()
}

export const capitalize = (s: string) => {
    if (typeof s !== "string") return ""
    return s
        .split(" ")
        .map((word) => word.charAt(0).toUpperCase() + word.slice(1))
        .join(" ")
}

const URL_SAFE = /^[a-zA-Z0-9_-]+$/

// App names are free-form display labels (per AGE-3754). Only reject empty /
// whitespace-only input here; URL safety belongs on slug fields, not names.
export const isAppNameInputValid = (input: string) => {
    return typeof input === "string" && input.trim().length > 0
}

export const isVariantNameInputValid = (input: string) => {
    return URL_SAFE.test(input)
}

// Moved to @agenta/shared/utils; re-exported here so existing oss imports keep working.
export {isSlugInputValid}

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

// Re-export from @agenta/shared/utils for backward compatibility
export {dataUriToObjectUrl, isBase64, isUrl, safeJson5Parse}

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
        // Ensure project-scoped URL is ready, then redirect to project settings (LLMs tab)
        const {projectURL} = await waitForValidURL({requireProject: true})
        Router.push(`${projectURL}/settings?tab=llms`)
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

export const formatVariantIdWithHash = (variantId: string) => {
    const parts = variantId.split("-")
    return `# ${parts[parts.length - 1]}`
}

export const getUsernameFromEmail = (email: string) => email.split("@")[0]

// Canonical implementation lives in @agenta/shared/utils.
// Re-exported here to keep the existing @/oss/lib/helpers/utils import path working.
export const removeEmptyFromObjects = sharedRemoveEmptyFromObjects

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
