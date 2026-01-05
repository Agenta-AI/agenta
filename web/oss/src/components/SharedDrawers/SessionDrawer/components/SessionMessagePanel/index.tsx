import {useMemo, useRef} from "react"

import {Collapse, CollapseProps, Tag, Typography} from "antd"
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
}

const SessionMessagePanel = ({
    value: incomingValue,
    label,
    trace,
    ...props
}: SessionMessagePanelProps) => {
    const isAnnotationVisible = useAtomValue(isAnnotationVisibleAtom)
    const editorRef = useRef<HTMLDivElement>(null)

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
                                        {(incomingValue as any[])?.map(
                                            (val: any, index: number) => {
                                                return (
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
                                                )
                                            },
                                        )}
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
