import {useMemo} from "react"

import {Collapse} from "antd"
import clsx from "clsx"
import {useAtomValue} from "jotai"

import SimpleSharedEditor from "@/oss/components/EditorViews/SimpleSharedEditor"
import {
    extractMessageArray,
    normalizeMessages,
    tryParseJson,
} from "@/oss/components/EvalRunDetails/utils/chatMessages"
import {inputRowsByIdFamilyAtom} from "@/oss/state/generation/entities"
import {
    PlaygroundTestResult,
    responseByRowRevisionAtomFamily,
} from "@/oss/state/newPlayground/generation/runtime"
import {playgroundFocusDrawerAtom} from "@/oss/state/playgroundFocusDrawerAtom"

import GenerationResultUtils from "../../../PlaygroundGenerations/assets/GenerationResultUtils"

const getOutputContent = (
    rep: PlaygroundTestResult,
    index: number,
): {
    type: "error" | "chat" | "text"
    content: string | React.ReactNode | {role: string; content: any; tool_calls?: any[]}[]
} => {
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
        const messageArray = extractMessageArray(parsed)

        if (messageArray) {
            const normalized = normalizeMessages(messageArray)
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

const FocusDrawerContent = () => {
    const {rowId, variantId} = useAtomValue(playgroundFocusDrawerAtom)

    const rowData = useAtomValue(inputRowsByIdFamilyAtom(rowId || ""))
    const responseData = useAtomValue(
        responseByRowRevisionAtomFamily({
            rowId: rowId || "",
            revisionId: variantId || "",
        }),
    )

    const repetitions = useMemo(() => {
        if (!responseData) return []
        if (Array.isArray(responseData)) return responseData
        return [responseData]
    }, [responseData])

    return (
        <div className="flex flex-col h-full">
            {/* Header Actions - Custom rendered inside Drawer title or here if we prefer custom header. 
                EnhancedDrawer uses Antd Drawer, so we can pass 'extra' prop for buttons. 
                But let's assume we render content here.
            */}

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
                                {rowData?.variables?.map((v: any, index: number) => {
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
                                })}
                                {(!rowData?.variables || rowData.variables.length === 0) && (
                                    <div className="text-gray-400">No inputs available</div>
                                )}
                            </div>
                        ),
                    },
                ]}
            />

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
                                            <GenerationResultUtils result={rep as any} showStatus />
                                        </div>
                                    )

                                    if (type === "chat" && Array.isArray(content)) {
                                        contentToRender = (
                                            <div className="flex flex-col gap-2">
                                                {content.map((msg: any, msgIndex: number) => {
                                                    const role = msg.role
                                                        ? msg.role.charAt(0).toUpperCase() +
                                                          msg.role.slice(1)
                                                        : "Unknown"
                                                    const value =
                                                        typeof msg.content === "string"
                                                            ? msg.content
                                                            : JSON.stringify(msg.content, null, 2)
                                                    return (
                                                        <SimpleSharedEditor
                                                            key={msgIndex}
                                                            value={value}
                                                            initialValue={value}
                                                            editorType="border"
                                                            isMinimizeVisible
                                                            headerName={role}
                                                            minimizedHeight={150}
                                                            // headerClassName="text-[#1677FF]"
                                                        />
                                                    )
                                                })}
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
                                    <div className="text-gray-400 p-2">No outputs available</div>
                                )}
                            </div>
                        ),
                    },
                ]}
            />
        </div>
    )
}

export default FocusDrawerContent
