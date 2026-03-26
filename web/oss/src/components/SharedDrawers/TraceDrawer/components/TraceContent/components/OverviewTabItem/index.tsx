import {useMemo} from "react"

import {traceSpanMolecule} from "@agenta/entities/trace"
import {Space} from "antd"
import {useAtomValue} from "jotai"

import {TraceSpanDrillInView} from "@/oss/components/DrillInView"
import ResultTag from "@/oss/components/ResultTag/ResultTag"
import {getStringOrJson} from "@/oss/lib/helpers/utils"
import {TraceSpanNode} from "@/oss/services/tracing/types"
import {
    spanDataInputsAtomFamily,
    spanDataInternalsAtomFamily,
    spanDataOutputsAtomFamily,
    spanExceptionAtomFamily,
    spanMetaConfigurationAtomFamily,
    spanNodeTypeAtomFamily,
} from "@/oss/state/newObservability/selectors/tracing"

import AccordionTreePanel from "../../../AccordionTreePanel"

interface RoleMessage {
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

const MESSAGE_KEY_HINTS = new Set(["messages", "prompt", "completion"])

const isNullish = (value: unknown) => value === null || value === undefined

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

const OverviewTabItem = ({activeTrace}: {activeTrace: TraceSpanNode}) => {
    // Use trace drill-in API for data access while preserving existing UI rendering.
    const entityWithDrillIn = traceSpanMolecule as typeof traceSpanMolecule & {
        drillIn: NonNullable<typeof traceSpanMolecule.drillIn>
    }
    const metaConfig = useAtomValue(spanMetaConfigurationAtomFamily(activeTrace))
    const inputsFromSelectors = useAtomValue(spanDataInputsAtomFamily(activeTrace))
    const outputsFromSelectors = useAtomValue(spanDataOutputsAtomFamily(activeTrace))
    const internalsFromSelectors = useAtomValue(spanDataInternalsAtomFamily(activeTrace))
    const nodeType = useAtomValue(spanNodeTypeAtomFamily(activeTrace))
    const exception = useAtomValue(spanExceptionAtomFamily(activeTrace))

    const {inputs, outputs, internals} = useMemo(
        () => ({
            inputs:
                entityWithDrillIn.drillIn.getValueAtPath(activeTrace, ["ag", "data", "inputs"]) ??
                inputsFromSelectors,
            outputs:
                entityWithDrillIn.drillIn.getValueAtPath(activeTrace, ["ag", "data", "outputs"]) ??
                outputsFromSelectors,
            internals:
                entityWithDrillIn.drillIn.getValueAtPath(activeTrace, [
                    "ag",
                    "data",
                    "internals",
                ]) ?? internalsFromSelectors,
        }),
        [
            activeTrace,
            entityWithDrillIn,
            inputsFromSelectors,
            outputsFromSelectors,
            internalsFromSelectors,
        ],
    )
    const spanEntityId =
        activeTrace?.span_id || activeTrace?.invocationIds?.span_id || activeTrace?.key
    const isEmbeddingSpan = activeTrace?.span_type === "embedding"

    // Always attempt message detection for all span types (not just chat spans).
    // collectMessageGroups safely returns [] when no messages are found, so the
    // rendering falls through to the raw TraceSpanDrillInView for non-message data.
    const {inputMessageGroups, outputMessageGroups, inputsPanelValue, outputsPanelValue} =
        useMemo(() => {
            if (isEmbeddingSpan) {
                return {
                    inputMessageGroups: [] as MessageGroup[],
                    outputMessageGroups: [] as MessageGroup[],
                    inputsPanelValue: inputs,
                    outputsPanelValue: outputs,
                }
            }

            const nextInputMessageGroups = collectMessageGroups(inputs, "inputs")
            const nextOutputMessageGroups = collectMessageGroups(outputs, "outputs")

            return {
                inputMessageGroups: nextInputMessageGroups,
                outputMessageGroups: nextOutputMessageGroups,
                inputsPanelValue: removeMessageGroupsFromData(inputs, nextInputMessageGroups),
                outputsPanelValue: removeMessageGroupsFromData(outputs, nextOutputMessageGroups),
            }
        }, [inputs, outputs, isEmbeddingSpan])

    return (
        <div className="w-full flex flex-col gap-2">
            {metaConfig && (
                <Space style={{flexWrap: "wrap"}}>
                    {Object.entries(metaConfig)
                        .filter(([key]) =>
                            [
                                "model",
                                "temperature",
                                "base_url",
                                "top_p",
                                "max_output_tokens",
                            ].includes(key),
                        )
                        .map(([key, value], index) => (
                            <ResultTag key={index} value1={key} value2={getStringOrJson(value)} />
                        ))}
                </Space>
            )}

            {inputs ? (
                <div className="flex flex-col gap-2">
                    {spanEntityId ? (
                        <TraceSpanDrillInView
                            spanId={spanEntityId}
                            title="inputs"
                            editable={false}
                            rootScope="span"
                            spanDataOverride={
                                !isNullish(inputsPanelValue)
                                    ? inputsPanelValue
                                    : inputMessageGroups.length === 1
                                      ? inputMessageGroups[0].messages
                                      : inputs
                            }
                        />
                    ) : (
                        <AccordionTreePanel
                            label={"inputs"}
                            value={
                                (!isNullish(inputsPanelValue)
                                    ? inputsPanelValue
                                    : inputMessageGroups.length === 1
                                      ? inputMessageGroups[0].messages
                                      : inputs) as any
                            }
                            enableFormatSwitcher
                        />
                    )}
                </div>
            ) : null}

            {outputs ? (
                <div className="flex flex-col gap-2">
                    {spanEntityId ? (
                        <TraceSpanDrillInView
                            spanId={spanEntityId}
                            title="outputs"
                            editable={false}
                            rootScope="span"
                            spanDataOverride={
                                !isNullish(outputsPanelValue)
                                    ? outputsPanelValue
                                    : outputMessageGroups.length === 1
                                      ? outputMessageGroups[0].messages
                                      : outputs
                            }
                        />
                    ) : (
                        <AccordionTreePanel
                            label={"outputs"}
                            value={
                                (!isNullish(outputsPanelValue)
                                    ? outputsPanelValue
                                    : outputMessageGroups.length === 1
                                      ? outputMessageGroups[0].messages
                                      : outputs) as any
                            }
                            enableFormatSwitcher
                        />
                    )}
                </div>
            ) : null}

            {internals && (
                <Space orientation="vertical" className="w-full" size={24}>
                    {nodeType !== "chat" && (
                        <>
                            {spanEntityId ? (
                                <TraceSpanDrillInView
                                    spanId={spanEntityId}
                                    title="internals"
                                    editable={false}
                                    rootScope="span"
                                    spanDataOverride={internals}
                                />
                            ) : (
                                <AccordionTreePanel
                                    label={"internals"}
                                    value={internals}
                                    enableFormatSwitcher
                                />
                            )}
                        </>
                    )}
                </Space>
            )}

            {exception && (
                <Space orientation="vertical" className="w-full" size={24}>
                    <AccordionTreePanel
                        label={"Exception"}
                        value={exception}
                        enableFormatSwitcher
                        bgColor="#FBE7E7"
                    />
                </Space>
            )}
        </div>
    )
}

export default OverviewTabItem
