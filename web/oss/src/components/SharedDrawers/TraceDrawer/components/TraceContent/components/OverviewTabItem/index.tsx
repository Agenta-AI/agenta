import {useMemo} from "react"

import {Space} from "antd"
import {useAtomValue} from "jotai"

import {TraceSpanDrillInView} from "@/oss/components/DrillInView/TraceSpanDrillInView"
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

const OverviewTabItem = ({spanId, activeTrace}: {spanId?: string; activeTrace: TraceSpanNode}) => {
    const metaConfig = useAtomValue(spanMetaConfigurationAtomFamily(activeTrace))
    const inputs = useAtomValue(spanDataInputsAtomFamily(activeTrace))
    const outputs = useAtomValue(spanDataOutputsAtomFamily(activeTrace))
    const internals = useAtomValue(spanDataInternalsAtomFamily(activeTrace))
    const nodeType = useAtomValue(spanNodeTypeAtomFamily(activeTrace))
    const exception = useAtomValue(spanExceptionAtomFamily(activeTrace))

    const hasInputs = useMemo(() => inputs && Object.keys(inputs).length > 0, [inputs])
    const hasOutputs = useMemo(() => outputs && Object.keys(outputs).length > 0, [outputs])
    const hasInternals = useMemo(
        () => internals && Object.keys(internals).length > 0 && nodeType !== "chat",
        [internals, nodeType],
    )
    const hasException = useMemo(() => !!exception, [exception])

    if (!spanId) {
        return null
    }

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

            {hasInputs && (
                <div className="flex flex-col gap-2">
                    <span className="text-sm font-medium text-gray-700">Inputs</span>
                    <TraceSpanDrillInView
                        spanId={spanId}
                        title="inputs"
                        initialPath="ag.data.inputs"
                        hideBreadcrumb
                        showFieldDrillIn={false}
                        enableFieldViewModes
                    />
                </div>
            )}

            {hasOutputs && (
                <div className="flex flex-col gap-2">
                    <span className="text-sm font-medium text-gray-700">Outputs</span>
                    <TraceSpanDrillInView
                        spanId={spanId}
                        title="outputs"
                        initialPath="ag.data.outputs"
                        hideBreadcrumb
                        showFieldDrillIn={false}
                        enableFieldViewModes
                    />
                </div>
            )}

            {hasInternals && (
                <div className="flex flex-col gap-2">
                    <span className="text-sm font-medium text-gray-700">Internals</span>
                    <TraceSpanDrillInView
                        spanId={spanId}
                        title="internals"
                        initialPath="ag.data.internals"
                        hideBreadcrumb
                        showFieldDrillIn={false}
                        enableFieldViewModes
                    />
                </div>
            )}

            {hasException && (
                <div className="flex flex-col gap-2">
                    <span className="text-sm font-medium text-red-600">Exception</span>
                    <TraceSpanDrillInView
                        spanId={spanId}
                        title="Exception"
                        initialPath="exception"
                        hideBreadcrumb
                        showFieldDrillIn={false}
                        enableFieldViewModes
                    />
                </div>
            )}
        </Space>
    )
}

export default OverviewTabItem
