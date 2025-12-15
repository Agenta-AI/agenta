import {Button, Collapse, CollapseProps, Tag, Typography} from "antd"
import {useRef} from "react"

import EnhancedTooltip from "@/oss/components/EnhancedUIs/Tooltip"
import SharedGenerationResultUtils from "@/oss/components/SharedGenerationResultUtils"

import {Database} from "@phosphor-icons/react"
import clsx from "clsx"
import AnnotateDrawerButton from "../../../AnnotateDrawer/assets/AnnotateDrawerButton"
import TraceAnnotations from "../../../TraceDrawer/components/TraceSidePanel/TraceAnnotations"
import SimpleSharedEditor from "@/oss/components/EditorViews/SimpleSharedEditor"
import {EditorProvider} from "@/oss/components/Editor/Editor"
import {isAnnotationVisibleAtom} from "../../store/sessionDrawerStore"
import {useAtomValue} from "jotai"

interface SessionMessagePanelProps extends CollapseProps {
    value: Record<string, any> | string | any[]
    label: string
    enableFormatSwitcher?: boolean
    bgColor?: string
    fullEditorHeight?: boolean
}

const SessionMessagePanel = ({
    value: incomingValue,
    label,
    trace,
    ...props
}: SessionMessagePanelProps) => {
    const isAnnotationVisible = useAtomValue(isAnnotationVisibleAtom)
    const editorRef = useRef<HTMLDivElement>(null)
    const sanitizedValue = ""
    const isStringValue = true

    const collapse = (
        <Collapse
            {...props}
            defaultActiveKey={[label]}
            className={clsx(
                "border border-solid border-colorBorder overflow-hidden",
                "[&_.ant-collapse-header]:bg-[#05172905] [&_.ant-collapse-header]:border-0 [&_.ant-collapse-header]:border-b [&_.ant-collapse-header]:border-solid [&_.ant-collapse-header]:border-colorSplit",
                "[&_.ant-collapse-content]:!bg-white [&_.ant-collapse-content-box]:!p-0",
            )}
            items={[
                {
                    key: label,
                    label: (
                        <div className="flex items-center gap-2">
                            <Typography.Text strong>{label}</Typography.Text>
                            <EnhancedTooltip
                                title="Copy span id"
                                tooltipProps={{placement: "bottom", arrow: true}}
                            >
                                <Tag className="font-mono truncate bg-[#0517290F]" bordered={false}>
                                    # {trace?.span_id || "-"}
                                </Tag>
                            </EnhancedTooltip>
                        </div>
                    ),
                    children: (
                        <div className="w-full flex gap-2">
                            <div className="w-full flex flex-col gap-2 p-4">
                                <div className="flex flex-col gap-2">
                                    {incomingValue?.map((val: any) => {
                                        return (
                                            <div ref={editorRef}>
                                                <SimpleSharedEditor
                                                    headerName={val.role}
                                                    initialValue={val.content as string}
                                                    className="bg-[#0517290A] !w-[96%]"
                                                    headerClassName="capitalize"
                                                    editorType="borderless"
                                                    readOnly
                                                    noProvider
                                                />
                                            </div>
                                        )
                                    })}
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
                        <div className="flex items-center gap-2">
                            <Button
                                className="flex items-center"
                                onClick={(e) => {
                                    e.preventDefault()
                                    e.stopPropagation()
                                }}
                                // disabled={!activeTrace?.key}
                                size="small"
                            >
                                <Database size={14} />
                                Add to testset
                            </Button>

                            <AnnotateDrawerButton
                                label="Annotate"
                                size="small"
                                data={trace?.annotations || []}
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
    )

    if (isStringValue) {
        return (
            <EditorProvider
                initialValue={sanitizedValue as string}
                disabled
                showToolbar={false}
                readOnly
            >
                {collapse}
            </EditorProvider>
        )
    }

    return <>{collapse}</>
}

export default SessionMessagePanel
