import {useMemo, useRef, useState} from "react"

import {
    Accordion,
    AccordionContent,
    AccordionItem,
    AccordionTrigger,
} from "@agenta/primitive-ui/components/accordion"
import type {AccordionProps} from "@agenta/primitive-ui/components/accordion"
import {Badge} from "@agenta/primitive-ui/components/badge"
import {Button} from "@agenta/primitive-ui/components/button"
import {CopyTooltip as EnhancedTooltip} from "@agenta/ui/copy-tooltip"
import {MinusOutlined, PlusOutlined} from "@ant-design/icons"
import clsx from "clsx"
import {useAtomValue} from "jotai"

import SimpleSharedEditor from "@/oss/components/EditorViews/SimpleSharedEditor"
import SharedGenerationResultUtils from "@/oss/components/SharedGenerationResultUtils"

import AddToTestsetButton from "../../../AddToTestsetDrawer/components/AddToTestsetButton"
import AnnotateDrawerButton from "../../../AnnotateDrawer/assets/AnnotateDrawerButton"
import TraceAnnotations from "../../../TraceDrawer/components/TraceSidePanel/TraceAnnotations"
import {isAnnotationVisibleAtom} from "../../store/sessionDrawerStore"

interface SessionMessagePanelProps extends AccordionProps {
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
            <Accordion
                {...props}
                multiple
                defaultValue={[label]}
                className={clsx(
                    "border border-solid border-colorBorder overflow-hidden",
                    "[&_[data-slot=accordion-item]]:border-none",
                    "[&_[data-slot=accordion-trigger]]:bg-[var(--ag-c-05172905)] [&_[data-slot=accordion-trigger]]:border-0 [&_[data-slot=accordion-trigger]]:border-b [&_[data-slot=accordion-trigger]]:border-solid [&_[data-slot=accordion-trigger]]:border-colorSplit",
                    "[&_[data-slot=accordion-content]>div]:!bg-[var(--ag-c-FFFFFF)] [&_[data-slot=accordion-content]>div]:!p-0",
                )}
            >
                <AccordionItem value={label}>
                    <AccordionTrigger>
                        <div className="flex w-full items-center justify-between">
                            <div className="flex items-center gap-2">
                                <span className="font-semibold">{label}</span>
                                <EnhancedTooltip
                                    copyText={trace?.span_id}
                                    title="Copy span id"
                                    tooltipProps={{placement: "top", arrow: true}}
                                >
                                    <Badge
                                        className="font-mono truncate bg-[var(--ag-c-0517290F)]"
                                        variant="secondary"
                                    >
                                        # {trace?.span_id || "-"}
                                    </Badge>
                                </EnhancedTooltip>
                            </div>
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
                        </div>
                    </AccordionTrigger>
                    <AccordionContent>
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
                                                        className="bg-[var(--ag-c-0517290A)] !w-[96%]"
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
                                                onClick={() => setShowHidden(!showHidden)}
                                                className="flex items-center gap-1 text-gray-400 hover:text-gray-600 hover:bg-transparent"
                                                variant="ghost"
                                                size="sm"
                                            >
                                                {showHidden ? <MinusOutlined /> : <PlusOutlined />}
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
                                                    className="bg-[var(--ag-c-0517290A)] !w-[96%]"
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
                    </AccordionContent>
                </AccordionItem>
            </Accordion>
        </>
    )
}

export default SessionMessagePanel
