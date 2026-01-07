import {useMemo} from "react"

import {Collapse} from "antd"
import {useAtomValue} from "jotai"

import SimpleSharedEditor from "@/oss/components/EditorViews/SimpleSharedEditor"

import {renderScenarioChatMessages} from "@/oss/components/EvalRunDetails/utils/chatMessages"

import {inputRowsByIdFamilyAtom} from "@/oss/state/generation/entities"
import {
    PlaygroundTestResult,
    responseByRowRevisionAtomFamily,
} from "@/oss/state/newPlayground/generation/runtime"
import {playgroundFocusDrawerAtom} from "@/oss/state/playgroundFocusDrawerAtom"

import GenerationResultUtils from "../../../PlaygroundGenerations/assets/GenerationResultUtils"
import clsx from "clsx"

const getOutputContent = (
    rep: PlaygroundTestResult,
    index: number,
): {
    type: "error" | "chat" | "text"
    content: string | React.ReactNode
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

        const chatNodes = renderScenarioChatMessages(chatValueString, `focus-drawer-rep-${index}`)

        if (chatNodes) {
            return {type: "chat", content: chatNodes}
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
                                    const key = v.key || `Variable ${index + 1}`
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
                    body: "!rounded-none bg-white !p-3",
                }}
                items={[
                    {
                        key: "output",
                        label: "Outputs",
                        children: (
                            <div className="flex flex-row gap-2 overflow-x-auto">
                                {repetitions.map((rep: PlaygroundTestResult, index: number) => {
                                    const {type, content} = getOutputContent(rep, index)
                                    let contentToRender: React.ReactNode = null

                                    if (type === "chat") {
                                        contentToRender = (
                                            <div className="flex flex-col gap-2">{content}</div>
                                        )
                                    } else {
                                        const isError = type === "error"
                                        contentToRender = (
                                            <SimpleSharedEditor
                                                value={content as string}
                                                initialValue={content as string}
                                                editorType="border"
                                                isMinimizeVisible
                                                headerName={
                                                    isError
                                                        ? `Repetition ${index + 1} (Error)`
                                                        : `Repetition ${index + 1}`
                                                }
                                                minimizedHeight={150}
                                                headerClassName="mb-2"
                                                footer={
                                                    <div className="mt-2">
                                                        <GenerationResultUtils
                                                            result={rep as any}
                                                            showStatus
                                                        />
                                                    </div>
                                                }
                                            />
                                        )
                                    }

                                    return (
                                        <div
                                            key={index}
                                            className={clsx(
                                                {
                                                    "min-w-[400px] max-w-[400px]":
                                                        repetitions.length > 1,
                                                },
                                                {
                                                    "w-full": repetitions.length === 1,
                                                },
                                                "flex flex-col gap-2",
                                            )}
                                        >
                                            {contentToRender}
                                        </div>
                                    )
                                })}
                                {repetitions.length === 0 && (
                                    <div className="text-gray-400 p-4">No outputs available</div>
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
