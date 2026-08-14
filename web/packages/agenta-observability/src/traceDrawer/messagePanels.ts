export interface RoleMessage {
    role?: string
    content?: unknown
    contents?: {message_content?: {text?: string}}[]
    [key: string]: unknown
}

interface MessageGroup {
    key: string
    path: string[]
    messages: RoleMessage[]
}

export interface TraceOverviewPanel {
    value: unknown
    hasMessages: boolean
}

interface PrepareTraceOverviewPanelsArgs {
    inputs: unknown
    outputs: unknown
    isEmbeddingSpan: boolean
}

const MESSAGE_KEY_HINTS = new Set(["messages", "prompt", "completion"])

export const isNullish = (value: unknown) => value === null || value === undefined

const isRecord = (value: unknown): value is Record<string, unknown> =>
    !!value && typeof value === "object" && !Array.isArray(value)

/** AI SDK content part types that represent message-like items */
const AI_SDK_PART_TYPES = new Set(["text", "tool-call", "tool-result"])

const isMessageLike = (value: unknown): value is RoleMessage => {
    if (!isRecord(value)) return false

    const hasRole = typeof value.role === "string"
    const hasContent = value.content !== undefined
    const hasMessageContentText =
        Array.isArray(value.contents) &&
        value.contents.some((item) => item?.message_content?.text !== undefined)

    // AI SDK content parts: {type: "text", text: "..."}, {type: "tool-call", toolName: "..."},
    // {type: "tool-result", output: {...}}
    const isAISDKPart =
        typeof value.type === "string" &&
        AI_SDK_PART_TYPES.has(value.type) &&
        (value.text !== undefined || value.toolName !== undefined || value.output !== undefined)

    return hasRole || hasContent || hasMessageContentText || isAISDKPart
}

const isMessageArray = (value: unknown, keyHint = false): value is RoleMessage[] =>
    Array.isArray(value) &&
    value.length > 0 &&
    value.every(isMessageLike) &&
    (keyHint || value.some((item) => typeof item.role === "string"))

/** Known chat role names for detecting flat {system: "...", user: "..."} objects */
const KNOWN_ROLES = new Set(["system", "user", "assistant", "tool", "function"])

/**
 * Detect flat role-keyed message objects like {system: "...", user: "..."}
 * and convert them to a standard [{role, content}] array.
 */
const flatRoleObjectToMessages = (value: unknown): RoleMessage[] | null => {
    if (!isRecord(value)) return null
    const keys = Object.keys(value)
    if (keys.length === 0) return null
    // At least one key must be a known role
    const roleKeys = keys.filter((k) => KNOWN_ROLES.has(k.toLowerCase()))
    if (roleKeys.length === 0) return null
    // Most keys should be roles (allow some non-role keys like "tool_calls")
    if (roleKeys.length < keys.length / 2) return null

    return roleKeys.map((k) => ({
        role: k.toLowerCase(),
        content: value[k],
    }))
}

/** Try to parse a JSON string into an object/array. Returns null on failure. */
const tryParseJson = (str: string): unknown => {
    try {
        const parsed = JSON.parse(str)
        return typeof parsed === "object" ? parsed : null
    } catch {
        return null
    }
}

const collectMessageGroups = (value: unknown, baseKey: string): MessageGroup[] => {
    const groups: MessageGroup[] = []
    const visited = new Set<unknown>()
    const seenPaths = new Set<string>()

    const walk = (current: unknown, path: string[]) => {
        // If current is a string that looks like a JSON array/object, parse it first.
        // This handles double-encoded messages from TS SDK spans where ag.data.inputs
        // contains {"messages": "[{\"role\":\"system\",...}]"} (string, not array).
        if (typeof current === "string" && current.length > 2) {
            const trimmed = current.trim()
            if (trimmed[0] === "[" || trimmed[0] === "{") {
                const parsed = tryParseJson(trimmed)
                if (parsed) {
                    walk(parsed, path)
                    return
                }
            }
            return
        }

        if (!current || typeof current !== "object") return
        if (visited.has(current)) return
        visited.add(current)

        if (Array.isArray(current)) {
            const leaf = path[path.length - 1]?.toLowerCase()
            const keyHint = leaf ? MESSAGE_KEY_HINTS.has(leaf) : false
            if (isMessageArray(current, keyHint)) {
                const serializedPath = path.join(".")
                if (!seenPaths.has(serializedPath)) {
                    seenPaths.add(serializedPath)
                    groups.push({
                        key: `${baseKey}.${serializedPath || "root"}`,
                        path,
                        messages: current,
                    })
                }
                return
            }

            current.forEach((item, index) => walk(item, [...path, String(index)]))
            return
        }

        // Detect flat role-keyed objects: {system: "...", user: "...", assistant: "..."}
        // Common in AI SDK's ai.prompt.messages attribute format
        const leaf = path[path.length - 1]?.toLowerCase()
        if (leaf && MESSAGE_KEY_HINTS.has(leaf)) {
            const converted = flatRoleObjectToMessages(current)
            if (converted && converted.length > 0) {
                const serializedPath = path.join(".")
                if (!seenPaths.has(serializedPath)) {
                    seenPaths.add(serializedPath)
                    groups.push({
                        key: `${baseKey}.${serializedPath || "root"}`,
                        path,
                        messages: converted,
                    })
                }
                return
            }
        }

        Object.entries(current).forEach(([key, nested]) => walk(nested, [...path, key]))
    }

    walk(value, [])
    return groups
}

const deleteAtPath = (target: unknown, path: string[]) => {
    if (!path.length || !target || typeof target !== "object") return

    const removeAtSegment = (container: unknown, segment: string): boolean => {
        if (Array.isArray(container)) {
            const index = Number(segment)
            if (
                Number.isInteger(index) &&
                String(index) === segment &&
                index >= 0 &&
                index < container.length
            ) {
                container.splice(index, 1)
                return true
            }
        }

        if (container && typeof container === "object" && segment in container) {
            delete (container as Record<string, unknown>)[segment]
            return true
        }

        return false
    }

    const isEmptyContainer = (value: unknown) =>
        (Array.isArray(value) && value.length === 0) ||
        (isRecord(value) && Object.keys(value).length === 0)

    const ancestors: {parent: unknown; segment: string}[] = []
    let cursor: any = target

    for (let index = 0; index < path.length - 1; index += 1) {
        const segment = path[index]
        if (!cursor || typeof cursor !== "object" || !(segment in cursor)) return
        ancestors.push({parent: cursor, segment})
        cursor = cursor[segment]
    }

    const lastSegment = path[path.length - 1]
    if (!removeAtSegment(cursor, lastSegment)) return

    // Prune only containers emptied by this delete path.
    for (let index = ancestors.length - 1; index >= 0; index -= 1) {
        const {parent, segment} = ancestors[index]
        const child = (parent as any)?.[segment]
        if (!isEmptyContainer(child)) break
        removeAtSegment(parent, segment)
    }
}

const removeMessageGroupsFromData = (value: unknown, groups: MessageGroup[]): unknown => {
    if (!groups.length || isNullish(value)) return value
    if (groups.some((group) => group.path.length === 0)) return undefined

    let cloned: any
    try {
        cloned = structuredClone(value)
    } catch {
        return value
    }

    groups.forEach((group) => deleteAtPath(cloned, group.path))

    if (
        (Array.isArray(cloned) && cloned.length === 0) ||
        (isRecord(cloned) && Object.keys(cloned).length === 0)
    ) {
        return undefined
    }

    return cloned
}

const serializeMessages = (messages: RoleMessage[]) => {
    try {
        return JSON.stringify(messages)
    } catch {
        return String(messages)
    }
}

const dedupeMessageGroups = (groups: MessageGroup[], seenMessages: Set<string>) => {
    return groups.filter((group) => {
        const key = serializeMessages(group.messages)
        if (seenMessages.has(key)) return false
        seenMessages.add(key)
        return true
    })
}

const mergeMessageGroupsIntoPanelValue = (
    residualValue: unknown,
    messageGroups: MessageGroup[],
): unknown => {
    if (messageGroups.length === 0) return residualValue
    if (isNullish(residualValue) && messageGroups.length === 1) {
        return messageGroups[0].messages
    }

    const merged: Record<string, unknown> = isRecord(residualValue) ? {...residualValue} : {}

    messageGroups.forEach((group, index) => {
        const leaf = group.path[group.path.length - 1]
        const preferredKey = leaf && leaf !== "root" ? leaf : "messages"
        const key =
            preferredKey in merged
                ? `${preferredKey}_${index + 1}`
                : index === 0
                  ? preferredKey
                  : `${preferredKey}_${index + 1}`
        merged[key] = group.messages
    })

    if (!isRecord(residualValue) && !isNullish(residualValue)) {
        merged.value = residualValue
    }

    return merged
}

const buildPanel = (
    value: unknown,
    baseKey: string,
    seenMessages: Set<string>,
): TraceOverviewPanel | null => {
    if (isNullish(value)) return null

    const groups = collectMessageGroups(value, baseKey)
    if (!groups.length) {
        return {
            value,
            hasMessages: false,
        }
    }

    const uniqueGroups = dedupeMessageGroups(groups, seenMessages)
    const residualValue = removeMessageGroupsFromData(value, groups)

    if (!uniqueGroups.length) {
        return isNullish(residualValue)
            ? null
            : {
                  value: residualValue,
                  hasMessages: false,
              }
    }

    return {
        value: mergeMessageGroupsIntoPanelValue(residualValue, uniqueGroups),
        hasMessages: true,
    }
}

const buildRawPanel = (value: unknown): TraceOverviewPanel | null =>
    isNullish(value)
        ? null
        : {
              value,
              hasMessages: false,
          }

export const prepareTraceOverviewPanels = ({
    inputs,
    outputs,
    isEmbeddingSpan,
}: PrepareTraceOverviewPanelsArgs): {
    inputs: TraceOverviewPanel | null
    outputs: TraceOverviewPanel | null
} => {
    if (isEmbeddingSpan) {
        return {
            inputs: buildRawPanel(inputs),
            outputs: buildRawPanel(outputs),
        }
    }

    const seenMessages = new Set<string>()

    return {
        inputs: buildPanel(inputs, "inputs", seenMessages),
        outputs: buildPanel(outputs, "outputs", seenMessages),
    }
}
