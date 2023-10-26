import dynamic from "next/dynamic"
import {EvaluationType} from "../enums"

const openAItoken = "openAiToken"

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
    [EvaluationType.human_a_b_testing]: "A/B testing",
    [EvaluationType.human_scoring]: "Scoring single variant",
    [EvaluationType.custom_code_run]: "Custom Code Run",
    [EvaluationType.auto_regex_test]: "Regex Test",
    [EvaluationType.auto_webhook_test]: "Webhook Test",
}

export const saveOpenAIKey = (key: string) => {
    if (typeof window !== "undefined") {
        // TODO: add encryption here
        localStorage.setItem(openAItoken, key)
    }
}

export const getOpenAIKey = (): string => {
    // precedence order: local storage, env variable, empty string
    let key
    if (typeof window !== "undefined") {
        key = localStorage.getItem(openAItoken)
    }
    return key ?? process.env.NEXT_PUBLIC_OPENAI_API_KEY ?? ""
}

export const removeOpenAIKey = () => {
    if (typeof window !== "undefined") {
        localStorage.removeItem(openAItoken)
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

export const convertToCsv = (rows: RowType[], header: (string | undefined)[]): string => {
    const validHeaders = header.filter((h) => h !== undefined && h in rows[0]) as string[]
    const headerRow = validHeaders.join(",")
    const remainingRows = rows
        .map((row) => validHeaders.map((colName) => row[colName]).join(","))
        .join("\n")
    return `${headerRow}\n${remainingRows}`
}

export const downloadCsv = (csvContent: string, filename: string): void => {
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
        return process.env.NEXT_PUBLIC_FF === "demo"
    }
    return false
}

export function dynamicComponent<T>(path: string, fallback: any = () => null) {
    return dynamic<T>(() => import(`@/components/${path}`), {
        loading: fallback,
        ssr: false,
    })
}
