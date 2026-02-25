import {Space} from "antd"
import {useAtomValue} from "jotai"

import {TraceSpanDrillInView} from "@/oss/components/DrillInView"
import ResultTag from "@/oss/components/ResultTag/ResultTag"
import {getStringOrJson} from "@/oss/lib/helpers/utils"
import {TraceSpanNode} from "@/oss/services/tracing/types"
import {traceSpan} from "@/oss/state/entities/trace"
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

const isMessageLike = (value: unknown): value is RoleMessage => {
    if (!isRecord(value)) return false

    const hasRole = typeof value.role === "string"
    const hasContent = value.content !== undefined
    const hasMessageContentText =
        Array.isArray(value.contents) &&
        value.contents.some((item) => item?.message_content?.text !== undefined)

    return hasRole || hasContent || hasMessageContentText
}

const isMessageArray = (value: unknown, keyHint = false): value is RoleMessage[] =>
    Array.isArray(value) &&
    value.length > 0 &&
    value.every(isMessageLike) &&
    (keyHint || value.some((item) => typeof item.role === "string"))

const collectMessageGroups = (value: unknown, baseKey: string): MessageGroup[] => {
    const groups: MessageGroup[] = []
    const visited = new Set<unknown>()
    const seenPaths = new Set<string>()

    const walk = (current: unknown, path: string[]) => {
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

    let cursor: any = target
    for (let index = 0; index < path.length - 1; index += 1) {
        const segment = path[index]
        if (!cursor || typeof cursor !== "object" || !(segment in cursor)) return
        cursor = cursor[segment]
    }

    const lastSegment = path[path.length - 1]
    if (cursor && typeof cursor === "object") {
        delete cursor[lastSegment]
    }
}

const removeEmptyContainers = (value: unknown): unknown => {
    if (Array.isArray(value)) {
        return value.map(removeEmptyContainers).filter((nested) => nested !== undefined)
    }

    if (!isRecord(value)) {
        return value
    }

    const cleanedEntries = Object.entries(value)
        .map(([key, nested]) => [key, removeEmptyContainers(nested)] as const)
        .filter(([, nested]) => {
            if (nested === undefined) return false
            return !(isRecord(nested) && Object.keys(nested).length === 0)
        })

    if (!cleanedEntries.length) return undefined
    return Object.fromEntries(cleanedEntries)
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
    return removeEmptyContainers(cloned)
}

const getMessageContent = (message: RoleMessage): unknown => {
    if (message?.content !== undefined) return message.content
    if (
        message?.contents &&
        Array.isArray(message.contents) &&
        message.contents.length === 1 &&
        message.contents[0]?.message_content?.text !== undefined
    ) {
        return message.contents[0].message_content.text
    }
    return undefined
}

const OverviewTabItem = ({activeTrace}: {activeTrace: TraceSpanNode}) => {
    // Use trace drill-in API for data access while preserving existing UI rendering.
    const entityWithDrillIn = traceSpan as typeof traceSpan & {
        drillIn: NonNullable<typeof traceSpan.drillIn>
    }
    const metaConfig = useAtomValue(spanMetaConfigurationAtomFamily(activeTrace))
    const inputsFromSelectors = useAtomValue(spanDataInputsAtomFamily(activeTrace))
    const outputsFromSelectors = useAtomValue(spanDataOutputsAtomFamily(activeTrace))
    const internalsFromSelectors = useAtomValue(spanDataInternalsAtomFamily(activeTrace))
    const nodeType = useAtomValue(spanNodeTypeAtomFamily(activeTrace))
    const exception = useAtomValue(spanExceptionAtomFamily(activeTrace))

    const inputs =
        entityWithDrillIn.drillIn.getValueAtPath(activeTrace, ["ag", "data", "inputs"]) ??
        inputsFromSelectors
    const outputs =
        entityWithDrillIn.drillIn.getValueAtPath(activeTrace, ["ag", "data", "outputs"]) ??
        outputsFromSelectors
    const internals =
        entityWithDrillIn.drillIn.getValueAtPath(activeTrace, ["ag", "data", "internals"]) ??
        internalsFromSelectors
    const spanEntityId =
        activeTrace?.span_id || activeTrace?.invocationIds?.span_id || activeTrace?.key
    const isChatSpan = activeTrace?.span_type === "chat" || nodeType === "chat"
    const isEmbeddingSpan = activeTrace?.span_type === "embedding"
    const shouldRenderMessagePanels = isChatSpan && !isEmbeddingSpan
    const inputMessageGroups = shouldRenderMessagePanels
        ? collectMessageGroups(inputs, "inputs")
        : []
    const outputMessageGroups = shouldRenderMessagePanels
        ? collectMessageGroups(outputs, "outputs")
        : []
    const inputsPanelValue = removeMessageGroupsFromData(inputs, inputMessageGroups)
    const outputsPanelValue = removeMessageGroupsFromData(outputs, outputMessageGroups)

    return (
        <Space orientation="vertical" size={24} className="w-full">
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
                <Space orientation="vertical" className="w-full" size={24}>
                    {!isNullish(inputsPanelValue) &&
                        (spanEntityId ? (
                            <TraceSpanDrillInView
                                spanId={spanEntityId}
                                title="inputs"
                                editable={false}
                                rootScope="span"
                                spanDataOverride={inputsPanelValue}
                            />
                        ) : (
                            <AccordionTreePanel
                                label={"inputs"}
                                value={inputsPanelValue as any}
                                enableFormatSwitcher
                            />
                        ))}
                    {inputMessageGroups.length > 0 && (
                        <Space orientation="vertical" className="w-full" size={12}>
                            {inputMessageGroups.map((group) =>
                                group.messages.map((message, index) => {
                                    const content = getMessageContent(message)
                                    if (content !== undefined) {
                                        return (
                                            <AccordionTreePanel
                                                key={`${group.key}-input-message-${index}`}
                                                label={message.role || "message"}
                                                value={content}
                                                enableFormatSwitcher
                                                viewModePreset="message"
                                            />
                                        )
                                    }

                                    const {role, ...messageWithoutRole} = message
                                    return (
                                        <AccordionTreePanel
                                            key={`${group.key}-input-message-${index}`}
                                            label={role || "message"}
                                            value={messageWithoutRole}
                                            enableFormatSwitcher
                                            viewModePreset="message"
                                        />
                                    )
                                }),
                            )}
                        </Space>
                    )}
                </Space>
            ) : null}

            {outputs ? (
                <Space orientation="vertical" className="w-full" size={24}>
                    {!isNullish(outputsPanelValue) &&
                        (spanEntityId ? (
                            <TraceSpanDrillInView
                                spanId={spanEntityId}
                                title="outputs"
                                editable={false}
                                rootScope="span"
                                spanDataOverride={outputsPanelValue}
                            />
                        ) : (
                            <AccordionTreePanel
                                label={"outputs"}
                                value={outputsPanelValue as any}
                                enableFormatSwitcher
                            />
                        ))}
                    {outputMessageGroups.length > 0 && (
                        <Space orientation="vertical" className="w-full" size={12}>
                            {outputMessageGroups.map((group) =>
                                group.messages.map((message, index) => {
                                    const content = getMessageContent(message)
                                    if (content !== undefined) {
                                        return (
                                            <AccordionTreePanel
                                                key={`${group.key}-output-message-${index}`}
                                                label={message.role || "assistant"}
                                                value={content}
                                                enableFormatSwitcher
                                                viewModePreset="message"
                                                bgColor="#E6FFFB"
                                            />
                                        )
                                    }

                                    const {role, ...messageWithoutRole} = message
                                    return (
                                        <AccordionTreePanel
                                            key={`${group.key}-output-message-${index}`}
                                            label={role || "assistant"}
                                            value={messageWithoutRole}
                                            enableFormatSwitcher
                                            viewModePreset="message"
                                            bgColor="#E6FFFB"
                                        />
                                    )
                                }),
                            )}
                        </Space>
                    )}
                </Space>
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
        </Space>
    )
}

export default OverviewTabItem
