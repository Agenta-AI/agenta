import {memo} from "react"

import {Typography} from "antd"
import dynamic from "next/dynamic"

import {extractInputs, extractOutputs, getTraceTree, getTraceIdForStep} from "./utils"

const SharedGenerationResultUtils = dynamic(
    () => import("@agenta/oss/src/components/SharedGenerationResultUtils"),
    {ssr: false},
)

interface StepContentRendererProps {
    step: any
    includeTraceUtils?: boolean
    fallbackTrace?: any
}

const renderBlock = (label: string, value: any) => {
    const display =
        typeof value === "string" ? value : value ? JSON.stringify(value, null, 2) : "No content"
    return (
        <div className="flex flex-col gap-2">
            <Typography.Text type="secondary">{label}</Typography.Text>
            <pre className="whitespace-pre-wrap break-words bg-[#F8FAFC] rounded-lg p-3 max-h-80 overflow-auto border border-[#EAECF0]">
                {display}
            </pre>
        </div>
    )
}

const StepContentRenderer = ({
    step,
    includeTraceUtils = false,
    fallbackTrace,
}: StepContentRendererProps) => {
    const inputs = extractInputs(step)
    const outputs = extractOutputs(step) ?? step?.data ?? null
    const tree = getTraceTree(step, fallbackTrace)

    return (
        <div className="flex flex-col gap-3">
            {inputs ? renderBlock("Inputs", inputs) : null}
            {outputs ? renderBlock("Outputs", outputs) : null}
            {includeTraceUtils && tree ? (
                <SharedGenerationResultUtils
                    className="!mt-1"
                    traceId={getTraceIdForStep(step, fallbackTrace)}
                    showStatus={false}
                />
            ) : null}
            {!inputs && !outputs ? (
                <Typography.Text type="secondary">No content</Typography.Text>
            ) : null}
        </div>
    )
}

export default memo(StepContentRenderer)
