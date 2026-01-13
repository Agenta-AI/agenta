import {useMemo, useRef, useState} from "react"

import {MinusOutlined, PlusOutlined} from "@ant-design/icons"
import {Button, Collapse, CollapseProps, Tag, Typography} from "antd"
import clsx from "clsx"
import {useAtomValue} from "jotai"

import SimpleSharedEditor from "@/oss/components/EditorViews/SimpleSharedEditor"
import EnhancedTooltip from "@/oss/components/EnhancedUIs/Tooltip"
import SharedGenerationResultUtils from "@/oss/components/SharedGenerationResultUtils"

import AddToTestsetButton from "../../../AddToTestsetDrawer/components/AddToTestsetButton"
import AnnotateDrawerButton from "../../../AnnotateDrawer/assets/AnnotateDrawerButton"
import TraceAnnotations from "../../../TraceDrawer/components/TraceSidePanel/TraceAnnotations"
import {isAnnotationVisibleAtom} from "../../store/sessionDrawerStore"

interface SessionMessagePanelProps extends CollapseProps {
    value: Record<string, any> | string | any[]
    label: string
    enableFormatSwitcher?: boolean
    bgColor?: string
    fullEditorHeight?: boolean
    trace?: any
    defaultHiddenCount?: number
}

const SessionMessagePanel = ({
    value: incomingValue,
    label,
    trace,
    defaultHiddenCount = 0,
    ...props
}: SessionMessagePanelProps) => {
    const isAnnotationVisible = useAtomValue(isAnnotationVisibleAtom)
    const editorRef = useRef<HTMLDivElement>(null)
    const [showHidden, setShowHidden] = useState(false)

    // Get span ID for AddToTestsetButton - drawer will fetch data from entity cache
    const spanIds = useMemo(() => {
        if (!trace?.span_id) return []
        return [trace.span_id]
    }, [trace?.span_id])

    return (
        <>
            {" "}
            <Collapse
                {...props}
                defaultActiveKey={[label]}
                className={clsx(
                    "border border-solid border-colorBorder overflow-hidden",
                    "[&_.ant-collapse-header]:bg-[#05172905] [&_.ant-collapse-header]:border-0 [&_.ant-collapse-header]:border-b [&_.ant-collapse-header]:border-solid [&_.ant-collapse-header]:border-colorSplit",
                    "[&_.ant-collapse-body]:!bg-white [&_.ant-collapse-body]:!p-0",
                )}
                items={[
                    {
                        key: label,
                        label: (
                            <div className="flex items-center gap-2">
                                <Typography.Text strong>{label}</Typography.Text>
                                <EnhancedTooltip
                                    copyText={trace?.span_id}
                                    title="Copy span id"
                                    tooltipProps={{placement: "top", arrow: true}}
                                >
                                    <Tag
                                        className="font-mono truncate bg-[#0517290F]"
                                        bordered={false}
                                    >
                                        # {trace?.span_id || "-"}
                                    </Tag>
                                </EnhancedTooltip>
                            </div>
                        ),
                        children: (
                            <div className="w-full flex gap-2">
                                <div className="w-full flex flex-col gap-2 p-4">
                                    <div className="flex flex-col gap-2">
                                        {/* Hidden messages (shown when toggled) */}
                                        {showHidden &&
                                            (incomingValue as any[])
                                                ?.slice(0, defaultHiddenCount)
                                                .map((val: any, index: number) => (
                                                    <div ref={editorRef} key={val.id || index}>
                                                        <SimpleSharedEditor
                                                            headerName={val.role}
                                                            initialValue={val.content as string}
                                                            className="bg-[#0517290A] !w-[96%]"
                                                            headerClassName={
                                                                val.role === "exception"
                                                                    ? "capitalize text-red-500"
                                                                    : "capitalize"
                                                            }
                                                            editorType="borderless"
                                                            readOnly
                                                            noProvider
                                                        />
                                                    </div>
                                                ))}

                                        {/* Toggle Button */}
                                        {defaultHiddenCount > 0 && (
                                            <div className="flex items-center gap-2 my-1">
                                                <div className="flex-1 border-t border-solid border-gray-100" />
                                                <Button
                                                    type="text"
                                                    size="small"
                                                    onClick={() => setShowHidden(!showHidden)}
                                                    className="flex items-center gap-1 text-gray-400 hover:text-gray-600 hover:bg-transparent"
                                                    icon={
                                                        showHidden ? (
                                                            <MinusOutlined />
                                                        ) : (
                                                            <PlusOutlined />
                                                        )
                                                    }
                                                >
                                                    {showHidden
                                                        ? "Hide first messages"
                                                        : "Show all messages"}
                                                </Button>
                                                <div className="flex-1 border-t border-solid border-gray-100" />
                                            </div>
                                        )}

                                        {/* Always visible messages */}
                                        {(incomingValue as any[])
                                            ?.slice(defaultHiddenCount)
                                            .map((val: any, index: number) => (
                                                <div
                                                    ref={editorRef}
                                                    key={val.id || index + defaultHiddenCount}
                                                >
                                                    <SimpleSharedEditor
                                                        headerName={val.role}
                                                        initialValue={val.content as string}
                                                        className="bg-[#0517290A] !w-[96%]"
                                                        headerClassName={
                                                            val.role === "exception"
                                                                ? "capitalize text-red-500"
                                                                : "capitalize"
                                                        }
                                                        editorType="borderless"
                                                        readOnly
                                                        noProvider
                                                    />
                                                </div>
                                            ))}
                                    </div>

                                    <SharedGenerationResultUtils traceId={trace?.trace_id} />
                                </div>

                                {isAnnotationVisible && (
                                    <div className="w-[300px] shrink-0 border-0 border-l border-solid border-colorSplit p-4">
                                        <TraceAnnotations annotations={trace?.annotations} />
                                    </div>
                                )}
                            </div>
                        ),
                        extra: (
                            <div
                                className="flex items-center gap-2"
                                onClick={(e) => e.stopPropagation()}
                            >
                                <AddToTestsetButton
                                    className="flex items-center"
                                    label="Add to testset"
                                    size="small"
                                    spanIds={spanIds}
                                    disabled={!trace?.span_id}
                                />

                                <AnnotateDrawerButton
                                    label="Annotate"
                                    size="small"
                                    data={trace?.annotations || []}
                                    queryKey="session-drawer-annotations"
                                    traceSpanIds={{
                                        traceId: trace?.trace_id,
                                        spanId: trace?.span_id,
                                    }}
                                />
                            </div>
                        ),
                    },
                ]}
                bordered={false}
                expandIconPosition="end"
            />
        </>
    )
}

export default SessionMessagePanel
