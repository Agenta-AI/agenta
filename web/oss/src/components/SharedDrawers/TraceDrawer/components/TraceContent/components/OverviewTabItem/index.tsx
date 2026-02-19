import {useCallback, useMemo, useState} from "react"

import {Button, Space} from "antd"
import {useAtomValue} from "jotai"

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
import {transformDataInputs} from "../../utils"

interface RoleMessage {
    role?: string
    content?: unknown
    contents?: {message_content?: {text?: string}}[]
    [key: string]: unknown
}

const getCollapsedMessageIndices = (messages: RoleMessage[]): Set<number> => {
    const keep = new Set<number>()
    if (!messages.length) return keep

    const firstSystem = messages.findIndex((message) => message.role === "system")
    const lastUser = messages.findLastIndex((message) => message.role === "user")
    const lastAssistant = messages.findLastIndex((message) => message.role === "assistant")

    if (firstSystem >= 0) keep.add(firstSystem)
    if (lastUser >= 0) keep.add(lastUser)
    if (lastAssistant >= 0) keep.add(lastAssistant)

    if (keep.size === 0) {
        keep.add(messages.length - 1)
    }

    return keep
}

const OverviewTabItem = ({activeTrace}: {activeTrace: TraceSpanNode}) => {
    const metaConfig = useAtomValue(spanMetaConfigurationAtomFamily(activeTrace))
    const inputs = useAtomValue(spanDataInputsAtomFamily(activeTrace))
    const outputs = useAtomValue(spanDataOutputsAtomFamily(activeTrace))
    const internals = useAtomValue(spanDataInternalsAtomFamily(activeTrace))
    const nodeType = useAtomValue(spanNodeTypeAtomFamily(activeTrace))
    const exception = useAtomValue(spanExceptionAtomFamily(activeTrace))
    const [expandedGroups, setExpandedGroups] = useState<Record<string, boolean>>({})

    const toggleGroup = useCallback((groupKey: string) => {
        setExpandedGroups((prev) => ({...prev, [groupKey]: !prev[groupKey]}))
    }, [])

    const renderMessagePanels = useCallback(
        ({
            messages,
            groupKey,
            isOutput = false,
            bgColor,
        }: {
            messages: RoleMessage[]
            groupKey: string
            isOutput?: boolean
            bgColor?: string
        }) => {
            const keepIndices = getCollapsedMessageIndices(messages)
            const hiddenCount = Math.max(messages.length - keepIndices.size, 0)
            const shouldCollapse = messages.length > 3 && hiddenCount > 0
            const expanded = expandedGroups[groupKey] ?? false

            const visibleEntries = messages
                .map((message, index) => ({message, index}))
                .filter((entry) => !shouldCollapse || expanded || keepIndices.has(entry.index))

            return (
                <Space key={groupKey} orientation="vertical" className="w-full" size={8}>
                    {shouldCollapse && (
                        <div className="flex items-center gap-2">
                            <div className="h-px flex-1 bg-gray-200" />
                            <Button
                                type="text"
                                size="small"
                                onClick={() => toggleGroup(groupKey)}
                                className="text-gray-500"
                            >
                                {expanded
                                    ? "Hide intermediate messages"
                                    : `Show all messages (${hiddenCount} hidden)`}
                            </Button>
                            <div className="h-px flex-1 bg-gray-200" />
                        </div>
                    )}

                    {visibleEntries.map(({message: rawMessage, index}) => {
                        const param =
                            rawMessage && typeof rawMessage === "object"
                                ? (rawMessage as RoleMessage)
                                : ({content: rawMessage} as RoleMessage)
                        const rawRole = typeof param.role === "string" ? param.role : undefined
                        const role = isOutput ? rawRole || "assistant" : rawRole || "user"
                        const panelKey = `${groupKey}-${index}-${role}`

                        if (param.content !== undefined) {
                            return (
                                <AccordionTreePanel
                                    key={panelKey}
                                    label={role}
                                    value={param.content}
                                    useDrillInView
                                    viewModePreset="message"
                                    enableFormatSwitcher
                                    bgColor={bgColor}
                                />
                            )
                        }

                        if (
                            param.contents &&
                            Array.isArray(param.contents) &&
                            param.contents.length === 1 &&
                            param.contents[0].message_content?.text
                        ) {
                            return (
                                <AccordionTreePanel
                                    key={panelKey}
                                    label={role}
                                    value={param.contents[0].message_content.text}
                                    useDrillInView
                                    viewModePreset="message"
                                    enableFormatSwitcher
                                    bgColor={bgColor}
                                />
                            )
                        }

                        const {role: _role, ...withoutRole} = param
                        const displayRole = isOutput ? rawRole || "assistant" : rawRole || "user"

                        return (
                            <AccordionTreePanel
                                key={panelKey}
                                label={displayRole}
                                value={withoutRole}
                                useDrillInView
                                viewModePreset="message"
                                enableFormatSwitcher
                                bgColor={bgColor}
                            />
                        )
                    })}
                </Space>
            )
        },
        [expandedGroups, toggleGroup],
    )

    const transformedInputs = useMemo(() => transformDataInputs(inputs), [inputs])

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
                    {activeTrace?.span_type !== "embedding" &&
                    inputs?.prompt &&
                    Array.isArray(inputs?.prompt) &&
                    inputs?.prompt.length > 0 &&
                    inputs?.prompt.every((item: any) => "role" in item) ? (
                        Object.entries(transformedInputs).map(([key, values]) => {
                            if (key === "prompt") {
                                return Array.isArray(values)
                                    ? renderMessagePanels({
                                          messages: values as RoleMessage[],
                                          groupKey: "inputs-prompt",
                                      })
                                    : null
                            } else {
                                return Array.isArray(values) && values.length > 0 ? (
                                    <AccordionTreePanel
                                        key={key}
                                        label="tools"
                                        value={values as any[]}
                                        useDrillInView
                                        enableFormatSwitcher
                                    />
                                ) : null
                            }
                        })
                    ) : (
                        <AccordionTreePanel
                            label={"inputs"}
                            value={inputs}
                            useDrillInView
                            enableFormatSwitcher
                        />
                    )}
                </Space>
            ) : null}

            {outputs ? (
                <Space orientation="vertical" className="w-full" size={24}>
                    {activeTrace?.span_type !== "embedding" &&
                    outputs?.completion &&
                    Array.isArray(outputs?.completion) &&
                    outputs?.completion.length > 0 &&
                    outputs?.completion.every((item: any) => "role" in item) ? (
                        Object.entries(outputs).map(([outputKey, item]) =>
                            Array.isArray(item)
                                ? renderMessagePanels({
                                      messages: item as RoleMessage[],
                                      groupKey: `outputs-${outputKey}`,
                                      isOutput: true,
                                      bgColor: "#E6FFFB",
                                  })
                                : null,
                        )
                    ) : (
                        <AccordionTreePanel
                            label={"outputs"}
                            value={outputs}
                            useDrillInView
                            enableFormatSwitcher
                        />
                    )}
                </Space>
            ) : null}

            {internals && (
                <Space orientation="vertical" className="w-full" size={24}>
                    {nodeType !== "chat" && (
                        <AccordionTreePanel
                            label={"internals"}
                            value={internals}
                            useDrillInView
                            enableFormatSwitcher
                        />
                    )}
                </Space>
            )}

            {exception && (
                <Space orientation="vertical" className="w-full" size={24}>
                    <AccordionTreePanel
                        label={"Exception"}
                        value={exception}
                        useDrillInView
                        enableFormatSwitcher
                        bgColor="#FBE7E7"
                    />
                </Space>
            )}
        </Space>
    )
}

export default OverviewTabItem
