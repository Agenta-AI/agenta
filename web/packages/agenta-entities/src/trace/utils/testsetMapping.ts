import {isChatMessagesArray} from "@agenta/shared/utils"

import {collectKeyPaths, getValueAtPath, matchColumnsWithSuggestions} from "./selectors"

/**
 * Pure helpers that turn span data into test set rows.
 *
 * A span's data is its `ag.data` object (see `extractAgData`). Paths address it from a `data`
 * root, so `data.inputs.country` reads `agData.inputs.country`.
 */

/** One data path to one target column. A mapping with an empty path or column is incomplete. */
export interface TraceMapping {
    path: string
    column: string
}

/** Structure checks and suggestions look at this many spans; rows use every span. */
export const TRACE_MAPPING_SAMPLE_SIZE = 50

const TRACE_DATA_PATH = "data"
const INPUTS_KEY = "inputs"
const OUTPUTS_KEY = "outputs"
const RESERVED_INPUT_KEYS = new Set(["messages", "prompt", "tools", "functions"])

interface ValueLocation {
    path: string
    value: unknown
}

const isRecord = (value: unknown): value is Record<string, unknown> =>
    !!value && typeof value === "object" && !Array.isArray(value)

const buildPath = (...parts: string[]) => parts.filter(Boolean).join(".")

const getPath = (value: unknown, path: string): unknown => {
    let current = value
    for (const part of path.split(".")) {
        if (!isRecord(current)) return undefined
        current = current[part]
    }
    return current
}

const getChildLocation = (data: Record<string, unknown>, key: string): ValueLocation | null =>
    key in data ? {path: buildPath(TRACE_DATA_PATH, key), value: data[key]} : null

const findMessagePath = (data: Record<string, unknown>): string | null => {
    const preferred = ["data.inputs.messages", "data.messages", "data.inputs.prompt", "data.prompt"]
    for (const path of preferred) {
        if (isChatMessagesArray(getPath({data}, path))) return path
    }

    const seen = new WeakSet<Record<string, unknown>>()
    const walk = (value: unknown, path: string): string | null => {
        if (isChatMessagesArray(value)) return path
        if (!isRecord(value) || seen.has(value)) return null
        seen.add(value)
        for (const [key, child] of Object.entries(value)) {
            const found = walk(child, `${path}.${key}`)
            if (found) return found
        }
        return null
    }
    return walk(data, TRACE_DATA_PATH)
}

/**
 * Whether `inputs` wraps the variables in a nested `inputs` object. It does when the messages sit
 * beside it, when a reserved key sits beside it, or when the messages are outside `data.inputs`
 * (playground completion traces keep them at `data.parameters.prompt.messages`).
 */
const isInputEnvelope = (
    inputs: Record<string, unknown>,
    inputsPath: string,
    messagePath: string,
): boolean => {
    if (!isRecord(inputs[INPUTS_KEY])) return false
    const messageIsInputSibling =
        messagePath.startsWith(`${inputsPath}.`) &&
        !messagePath.startsWith(`${buildPath(inputsPath, INPUTS_KEY)}.`)
    const hasReservedSibling = Object.keys(inputs).some((key) => RESERVED_INPUT_KEYS.has(key))
    const messagesAreOutsideInputs = !messagePath.startsWith(`${inputsPath}.`)
    return messageIsInputSibling || hasReservedSibling || messagesAreOutsideInputs
}

const getVariableInputsLocation = (
    data: Record<string, unknown>,
    messagePath: string,
): ValueLocation | null => {
    const inputs = getChildLocation(data, INPUTS_KEY)
    if (!inputs || !isRecord(inputs.value)) return null
    if (isInputEnvelope(inputs.value, inputs.path, messagePath)) {
        return {path: buildPath(inputs.path, INPUTS_KEY), value: inputs.value[INPUTS_KEY]}
    }
    return inputs
}

/**
 * The paths auto mapping proposes for one span. A completion span keeps the envelope
 * (`data.inputs`, `data.outputs`). A chat span splits the variable inputs from the message
 * history, so a replay can fill both.
 */
export const getCanonicalTraceMappingPaths = (data: unknown): string[] => {
    if (!isRecord(data)) return []
    const outputs = getChildLocation(data, OUTPUTS_KEY)
    const outputPaths = outputs ? [outputs.path] : []

    const messagePath = findMessagePath(data)
    if (!messagePath) {
        const inputs = getChildLocation(data, INPUTS_KEY)
        return [...(inputs ? [inputs.path] : []), ...outputPaths]
    }

    const variables = getVariableInputsLocation(data, messagePath)
    const variableInputs = isRecord(variables?.value) ? variables.value : {}
    const variablePaths = Object.entries(variableInputs)
        .filter(([key, value]) => !RESERVED_INPUT_KEYS.has(key) && !isChatMessagesArray(value))
        .map(([key]) => buildPath(variables?.path ?? "", key))
    return [...variablePaths, messagePath, ...outputPaths]
}

/** The column auto mapping names for a path: its last segment, with prompts named `messages`. */
export const getColumnNameForTraceMappingPath = (path: string): string => {
    const name = path.split(".").pop() || path
    return name === "prompt" || name === "completion" ? "messages" : name
}

const sample = <T>(items: readonly T[]) => items.slice(0, TRACE_MAPPING_SAMPLE_SIZE)

/**
 * The mappings auto mapping proposes: the canonical paths of the sampled spans, each to the
 * existing column with the same name (any case), or to a new column.
 */
export const suggestTraceMappings = ({
    spansData,
    existingColumns,
}: {
    spansData: readonly Record<string, unknown>[]
    existingColumns: readonly string[]
}): (TraceMapping & {isNew: boolean})[] => {
    const paths = new Set<string>()
    for (const data of sample(spansData)) {
        getCanonicalTraceMappingPaths(data).forEach((path) => paths.add(path))
    }
    const suggestions = [...paths].map((path) => ({
        data: path,
        suggestedColumn: getColumnNameForTraceMappingPath(path),
    }))
    return matchColumnsWithSuggestions(suggestions, [...existingColumns]).map(
        ({data, column, isNew}) => ({path: data, column, isNew}),
    )
}

/** Every path a mapping can read in the sampled spans, objects included. */
export const getTraceMappingPathOptions = (spansData: readonly Record<string, unknown>[]) => {
    const paths = new Set<string>()
    for (const data of sample(spansData)) {
        collectKeyPaths(data, TRACE_DATA_PATH, true).forEach((path) => paths.add(path))
    }
    return [...paths]
}

const completeMappings = (mappings: readonly TraceMapping[]) =>
    mappings
        .map(({path, column}) => ({path: path.trim(), column: column.trim()}))
        .filter(({path, column}) => path && column)

/**
 * One row per span: each complete mapping writes the value at its path to its column. A missing
 * value becomes `""`; objects and arrays stay as they are.
 */
export const buildTestsetRowsFromTraces = ({
    spansData,
    mappings,
}: {
    spansData: readonly Record<string, unknown>[]
    mappings: readonly TraceMapping[]
}): Record<string, unknown>[] => {
    const complete = completeMappings(mappings)
    return spansData.map((data) => {
        const row: Record<string, unknown> = {}
        for (const {path, column} of complete) {
            const value = getValueAtPath({data}, path)
            row[column] = value === undefined || value === null ? "" : value
        }
        return row
    })
}

/** The columns two or more mappings write to. */
export const findDuplicateMappingColumns = (mappings: readonly TraceMapping[]): string[] => {
    const seen = new Set<string>()
    const duplicates = new Set<string>()
    for (const {column} of mappings) {
        const name = column.trim()
        if (!name) continue
        if (seen.has(name)) duplicates.add(name)
        seen.add(name)
    }
    return [...duplicates]
}

/** The columns the complete mappings write to that the test set does not have yet. */
export const newColumnsOf = (
    mappings: readonly TraceMapping[],
    existingColumns: readonly string[],
): string[] => {
    const existing = new Set(existingColumns)
    const columns = completeMappings(mappings).map(({column}) => column)
    return [...new Set(columns)].filter((column) => !existing.has(column))
}

/** Whether the sampled spans do not all share the key structure of the first one. */
export const hasDifferentStructure = (spansData: readonly Record<string, unknown>[]): boolean => {
    const sampled = sample(spansData)
    if (sampled.length <= 1) return false
    const signature = (data: Record<string, unknown>) => collectKeyPaths(data).sort().join(",")
    const reference = signature(sampled[0])
    return sampled.slice(1).some((data) => signature(data) !== reference)
}
