import {useMemo} from "react"

import {type PlaygroundTestResult, executionItemController} from "@agenta/playground"
import {
    extractChatMessages,
    normalizeChatMessages,
    type NormalizedChatMessage,
} from "@agenta/ui/cell-renderers"
import {Collapse} from "antd"
import clsx from "clsx"
import {useAtomValue} from "jotai"

import {usePlaygroundUI} from "../../../context"
import {playgroundFocusDrawerAtom} from "../../../state"

const tryParseJson = (value: unknown): unknown => {
    if (typeof value !== "string") return value
    try {
        return JSON.parse(value)
    } catch {
        return value
    }
}

const getOutputContent = (
    rep: PlaygroundTestResult,
    index: number,
): {
    type: "error" | "chat" | "text"
    content: string | React.ReactNode | NormalizedChatMessage[]
} => {
    if (!rep) return {type: "text", content: ""}
    const error = rep.error || rep.response?.error

    if (error) {
        const errorContent = typeof error === "string" ? error : JSON.stringify(error)
        return {type: "error", content: errorContent}
    }

    try {
        const potentialChatValue =
            rep.response?.choices || rep.response?.output || rep.response?.data || rep.response

        const chatValueString =
            typeof potentialChatValue === "string"
                ? potentialChatValue
                : JSON.stringify(potentialChatValue)

        const parsed = tryParseJson(chatValueString)
        const messageArray = extractChatMessages(parsed)

        if (messageArray) {
            const normalized = normalizeChatMessages(messageArray)
            if (normalized.length > 0) {
                return {type: "chat", content: normalized}
            }
        }
    } catch (e) {
        console.error("Error rendering output:", e)
        return {type: "error", content: "Error rendering output"}
    }

    const simpleContent =
        rep.response?.choices?.[0]?.message?.content ||
        rep.response?.output ||
        rep.response?.data ||
        (typeof rep.response === "string" ? rep.response : "") ||
        ""

    return {type: "text", content: String(simpleContent)}
}

const getLastUserMessage = (repetitions: PlaygroundTestResult[]) => {
    if (!repetitions?.length) return null

    try {
        const firstRep = repetitions[0]
        const nodes = firstRep.response?.tree?.nodes
        const node = Array.isArray(nodes) ? nodes[0] : nodes ? Object.values(nodes)[0] : null

        if (!node) return null

        // Support both direct data access and attributes.ag.data structure
        const data = node.data || node.attributes?.ag?.data
        const messages = data?.inputs?.messages

        if (Array.isArray(messages)) {
            return (
                messages
                    .slice()
                    .reverse()
                    .find((m: Record<string, unknown>) => m.role === "user") || null
            )
        }
    } catch (error) {
        console.error("Error getting user message", error)
    }
    return null
}

const getChatInputs = (repetitions: PlaygroundTestResult[]) => {
    if (!repetitions?.length) return []
    try {
        const firstRep = repetitions[0]
        const nodes = firstRep.response?.tree?.nodes
        const node = Array.isArray(nodes) ? nodes[0] : nodes ? Object.values(nodes)[0] : null

        if (!node) return []

        const data = node.data || node.attributes?.ag?.data
        let inputs = data?.inputs || {}
        if (typeof inputs !== "object" || inputs === null) return []

        if (inputs.inputs) {
            inputs = inputs.inputs
        }

        return Object.entries(inputs)
            .filter(([key]) => key !== "messages")
            .map(([key, value]) => ({key, value}))
    } catch (error) {
        console.error("Error getting chat inputs", error)
        return []
    }
}

const FocusDrawerContent = () => {
    const {SharedGenerationResultUtils, SimpleSharedEditor} = usePlaygroundUI()
    const appType = useAtomValue(executionItemController.selectors.appType)
    const {rowId, entityId} = useAtomValue(playgroundFocusDrawerAtom)

    const rowData = useAtomValue(executionItemController.selectors.rowData(rowId || ""))
    const responseData = useAtomValue(
        executionItemController.selectors.responseByRowRevision({
            rowId: rowId || "",
            revisionId: entityId || "",
        }),
    )

    const repetitions = useMemo(() => {
        if (!responseData) return []
        if (Array.isArray(responseData)) return responseData
        return [responseData]
    }, [responseData])

    const lastUserMessage = useMemo(() => {
        return getLastUserMessage(repetitions)
    }, [repetitions])

    const inputsToRender = useMemo(() => {
        if (appType === "chat") {
            return getChatInputs(repetitions)
        }
        // Convert flat row data to {key, value} pairs for rendering
        if (rowData?.data) {
            return Object.entries(rowData.data).map(([key, value]) => ({key, value}))
        }
        return []
    }, [appType, repetitions, rowData?.data])

    if (!SimpleSharedEditor) return null

    return (
        <div className="flex flex-col h-full">
            <Collapse
                defaultActiveKey={["input"]}
                expandIconPosition="end"
                bordered={false}
                classNames={{
                    header: "bg-[#05172905] !rounded-none select-none",
                    body: "!rounded-none bg-white !p-3",
                }}
                items={[
                    {
                        key: "input",
                        label: "Input",
                        children: (
                            <div className="flex flex-col gap-2">
                                {inputsToRender?.map(
                                    (
                                        v: {
                                            key?: string
                                            value?: unknown
                                            content?: {value?: unknown}
                                        },
                                        index: number,
                                    ) => {
                                        if (!v) return null
                                        const key = v.key || `Repeats ${index + 1}`
                                        const value = v.value ?? v.content?.value ?? ""

                                        return (
                                            <SimpleSharedEditor
                                                key={index}
                                                value={String(value)}
                                                initialValue={String(value)}
                                                defaultMinimized
                                                isJSON={false}
                                                isMinimizeVisible
                                                isFormatVisible={false}
                                                headerName={key}
                                                editorType="border"
                                                headerClassName="text-[#1677FF]"
                                            />
                                        )
                                    },
                                )}
                                {(!inputsToRender || inputsToRender.length === 0) && (
                                    <div className="text-gray-400">No inputs available</div>
                                )}
                            </div>
                        ),
                    },
                ]}
            />

            {/* Messages Section */}
            {lastUserMessage && (
                <Collapse
                    defaultActiveKey={["messages"]}
                    expandIconPosition="end"
                    bordered={false}
                    classNames={{
                        header: "bg-[#05172905] !rounded-none select-none",
                        body: "!rounded-none bg-white !p-0",
                    }}
                    items={[
                        {
                            key: "messages",
                            label: "Messages",
                            children: (
                                <div className="px-3 py-3">
                                    <SimpleSharedEditor
                                        value={
                                            typeof lastUserMessage.content === "string"
                                                ? lastUserMessage.content
                                                : JSON.stringify(lastUserMessage.content, null, 2)
                                        }
                                        initialValue={
                                            typeof lastUserMessage.content === "string"
                                                ? lastUserMessage.content
                                                : JSON.stringify(lastUserMessage.content, null, 2)
                                        }
                                        editorType="border"
                                        isMinimizeVisible
                                        headerName={lastUserMessage.role}
                                        minimizedHeight={100}
                                        headerClassName="text-gray-500 capitalize"
                                    />
                                </div>
                            ),
                        },
                    ]}
                />
            )}

            {/* Output Section */}
            <Collapse
                defaultActiveKey={["output"]}
                expandIconPosition="end"
                bordered={false}
                classNames={{
                    header: "bg-[#05172905] !rounded-none select-none",
                    body: "!rounded-none bg-white !p-0",
                }}
                items={[
                    {
                        key: "output",
                        label: "Outputs",
                        children: (
                            <div className="flex flex-col gap-4">
                                <div className="flex flex-row gap-2 overflow-x-auto pb-5 @container">
                                    {repetitions.map((rep: PlaygroundTestResult, index: number) => {
                                        const {type, content} = getOutputContent(rep, index)
                                        let contentToRender: React.ReactNode = null
                                        const isError = type === "error"
                                        const header = (
                                            <div className="flex justify-between items-center">
                                                <span className="">
                                                    {isError
                                                        ? `Repeat ${index + 1} (Error)`
                                                        : `Repeat ${index + 1}`}
                                                </span>
                                                {SharedGenerationResultUtils &&
                                                    rep?.response?.tree?.trace_id && (
                                                        <SharedGenerationResultUtils
                                                            traceId={rep.response.tree.trace_id}
                                                            showStatus
                                                        />
                                                    )}
                                            </div>
                                        )

                                        if (type === "chat" && Array.isArray(content)) {
                                            contentToRender = (
                                                <div className="flex flex-col gap-2">
                                                    {content.map(
                                                        (
                                                            msg: NormalizedChatMessage,
                                                            msgIndex: number,
                                                        ) => {
                                                            const role = msg.role
                                                                ? msg.role
                                                                      ?.charAt(0)
                                                                      .toUpperCase() +
                                                                  msg.role?.slice(1)
                                                                : "Unknown"
                                                            const value =
                                                                typeof msg.content === "string"
                                                                    ? msg.content
                                                                    : JSON.stringify(
                                                                          msg.content,
                                                                          null,
                                                                          2,
                                                                      )
                                                            return (
                                                                <SimpleSharedEditor
                                                                    key={msgIndex}
                                                                    value={value}
                                                                    initialValue={value}
                                                                    editorType="border"
                                                                    isMinimizeVisible
                                                                    headerName={role}
                                                                    minimizedHeight={150}
                                                                />
                                                            )
                                                        },
                                                    )}
                                                </div>
                                            )
                                        } else {
                                            contentToRender = (
                                                <SimpleSharedEditor
                                                    value={content as string}
                                                    initialValue={content as string}
                                                    editorType="border"
                                                    isMinimizeVisible
                                                    headerName="Output"
                                                    minimizedHeight={150}
                                                    headerClassName="mb-1"
                                                />
                                            )
                                        }

                                        return (
                                            <div
                                                key={index}
                                                className={clsx(
                                                    "flex-1 min-w-[400px]",
                                                    "border-0 border-r border-b border-solid border-gray-200 p-3",
                                                    "flex flex-col gap-3",
                                                )}
                                            >
                                                {header}
                                                {contentToRender}
                                            </div>
                                        )
                                    })}
                                    {repetitions.length === 0 && (
                                        <div className="text-gray-400 p-2">
                                            No outputs available
                                        </div>
                                    )}
                                </div>
                            </div>
                        ),
                    },
                ]}
            />
        </div>
    )
}

export default FocusDrawerContent
