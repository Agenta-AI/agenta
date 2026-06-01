import {isChatMessagesArray} from "@agenta/shared/utils"

const TRACE_DATA_PATH = "data"
const INPUTS_KEY = "inputs"
const OUTPUTS_KEY = "outputs"
const RESERVED_INPUT_KEYS = new Set(["messages", "prompt", "tools", "functions"])

interface MessageLocation {
    path: string
}

interface ValueLocation {
    path: string
    value: unknown
}

const isRecord = (value: unknown): value is Record<string, unknown> =>
    !!value && typeof value === "object" && !Array.isArray(value)

const buildPath = (...parts: string[]) => parts.filter(Boolean).join(".")

const getPath = (value: unknown, path: string): unknown => {
    const parts = path.split(".")
    let current = value

    for (const part of parts) {
        if (!isRecord(current)) return undefined
        current = current[part]
    }

    return current
}

const getChildLocation = (
    parent: Record<string, unknown>,
    parentPath: string,
    key: string,
): ValueLocation | null => {
    if (!(key in parent)) return null
    return {path: buildPath(parentPath, key), value: parent[key]}
}

const getInputsLocation = (data: Record<string, unknown>): ValueLocation | null =>
    getChildLocation(data, TRACE_DATA_PATH, INPUTS_KEY)

const getOutputsLocation = (data: Record<string, unknown>): ValueLocation | null =>
    getChildLocation(data, TRACE_DATA_PATH, OUTPUTS_KEY)

const findMessageLocation = (data: Record<string, unknown>): MessageLocation | null => {
    const preferredPaths = [
        "data.inputs.messages",
        "data.messages",
        "data.inputs.prompt",
        "data.prompt",
    ]

    for (const path of preferredPaths) {
        const value = getPath({data}, path)
        if (isChatMessagesArray(value)) {
            return {path}
        }
    }

    const seen = new WeakSet<Record<string, unknown>>()
    const walk = (value: unknown, path: string): MessageLocation | null => {
        if (isChatMessagesArray(value)) return {path}
        if (!isRecord(value) || seen.has(value)) return null
        seen.add(value)

        for (const [key, child] of Object.entries(value)) {
            const childPath = path ? `${path}.${key}` : key
            const result = walk(child, childPath)
            if (result) return result
        }

        return null
    }

    return walk(data, TRACE_DATA_PATH)
}

export const isChatTraceData = (data: unknown): boolean => {
    if (!isRecord(data)) return false
    return !!findMessageLocation(data)
}

const isInputEnvelope = (
    inputs: Record<string, unknown>,
    inputsPath: string,
    messageLocation: MessageLocation,
): boolean => {
    const nestedInputs = inputs[INPUTS_KEY]
    if (!isRecord(nestedInputs)) return false

    const messageIsInputSibling =
        messageLocation.path.startsWith(`${inputsPath}.`) &&
        !messageLocation.path.startsWith(`${buildPath(inputsPath, INPUTS_KEY)}.`)

    const hasEnvelopeSibling = Object.keys(inputs).some((key) => RESERVED_INPUT_KEYS.has(key))

    return messageIsInputSibling || hasEnvelopeSibling
}

const getVariableInputsLocation = (
    data: Record<string, unknown>,
    messageLocation: MessageLocation,
): ValueLocation | null => {
    const inputsLocation = getInputsLocation(data)
    if (!inputsLocation || !isRecord(inputsLocation.value)) return null

    if (isInputEnvelope(inputsLocation.value, inputsLocation.path, messageLocation)) {
        return {
            path: buildPath(inputsLocation.path, INPUTS_KEY),
            value: inputsLocation.value[INPUTS_KEY],
        }
    }

    return inputsLocation
}

const getLocationPaths = (location: ValueLocation | null): string[] =>
    location ? [location.path] : []

export const getCanonicalTraceMappingPaths = (data: unknown): string[] => {
    if (!isRecord(data)) return []

    const messageLocation = findMessageLocation(data)
    if (messageLocation) {
        const variableInputsLocation = getVariableInputsLocation(data, messageLocation)
        const variableInputs = isRecord(variableInputsLocation?.value)
            ? variableInputsLocation.value
            : {}
        const variablePaths = Object.entries(variableInputs)
            .filter(([key, value]) => !RESERVED_INPUT_KEYS.has(key) && !isChatMessagesArray(value))
            .map(([key]) => buildPath(variableInputsLocation?.path ?? "", key))

        return [
            ...variablePaths,
            messageLocation.path,
            ...getLocationPaths(getOutputsLocation(data)),
        ]
    }

    const paths: string[] = []
    paths.push(...getLocationPaths(getInputsLocation(data)))
    paths.push(...getLocationPaths(getOutputsLocation(data)))
    return paths
}

export const getColumnNameForTraceMappingPath = (path: string): string => {
    const name = path.split(".").pop() || path
    return name === "prompt" || name === "completion" ? "messages" : name
}
