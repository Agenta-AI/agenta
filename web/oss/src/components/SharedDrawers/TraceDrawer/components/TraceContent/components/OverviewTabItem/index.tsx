import {useMemo} from "react"

import {traceSpanMolecule} from "@agenta/entities/trace"
import {Space} from "antd"
import {useAtomValue} from "jotai"

import {TraceSpanDrillInView} from "@/oss/components/DrillInView"
import ResultTag from "@/oss/components/ResultTag/ResultTag"
import {getStringOrJson} from "@/oss/lib/helpers/utils"
import {TraceSpanNode} from "@/oss/services/tracing/types"
import {
    spanDataInputsAtomFamily,
    spanDataInternalsAtomFamily,
    spanDataOutputsAtomFamily,
    spanDataParametersAtomFamily,
    spanExceptionAtomFamily,
    spanMetaConfigurationAtomFamily,
    spanNodeTypeAtomFamily,
} from "@/oss/state/newObservability/selectors/tracing"

import AccordionTreePanel from "../../../AccordionTreePanel"

import {prepareTraceOverviewPanels} from "./messagePanels"

const OverviewTabItem = ({activeTrace}: {activeTrace: TraceSpanNode}) => {
    // Use trace drill-in API for data access while preserving existing UI rendering.
    const entityWithDrillIn = traceSpanMolecule as typeof traceSpanMolecule & {
        drillIn: NonNullable<typeof traceSpanMolecule.drillIn>
    }
    const metaConfig = useAtomValue(spanMetaConfigurationAtomFamily(activeTrace))
    const inputsFromSelectors = useAtomValue(spanDataInputsAtomFamily(activeTrace))
    const outputsFromSelectors = useAtomValue(spanDataOutputsAtomFamily(activeTrace))
    const internalsFromSelectors = useAtomValue(spanDataInternalsAtomFamily(activeTrace))
    const parametersFromSelectors = useAtomValue(spanDataParametersAtomFamily(activeTrace))
    const nodeType = useAtomValue(spanNodeTypeAtomFamily(activeTrace))
    const exception = useAtomValue(spanExceptionAtomFamily(activeTrace))

    const {inputs, outputs, internals, parameters} = useMemo(
        () => ({
            inputs:
                entityWithDrillIn.drillIn.getValueAtPath(activeTrace, ["ag", "data", "inputs"]) ??
                inputsFromSelectors,
            outputs:
                entityWithDrillIn.drillIn.getValueAtPath(activeTrace, ["ag", "data", "outputs"]) ??
                outputsFromSelectors,
            internals:
                entityWithDrillIn.drillIn.getValueAtPath(activeTrace, [
                    "ag",
                    "data",
                    "internals",
                ]) ?? internalsFromSelectors,
            parameters:
                entityWithDrillIn.drillIn.getValueAtPath(activeTrace, [
                    "ag",
                    "data",
                    "parameters",
                ]) ?? parametersFromSelectors,
        }),
        [
            activeTrace,
            entityWithDrillIn,
            inputsFromSelectors,
            outputsFromSelectors,
            internalsFromSelectors,
            parametersFromSelectors,
        ],
    )

    const hasParameters =
        parameters != null &&
        typeof parameters === "object" &&
        Object.keys(parameters as Record<string, unknown>).length > 0
    const spanEntityId =
        activeTrace?.span_id || activeTrace?.invocationIds?.span_id || activeTrace?.key
    const isEmbeddingSpan = activeTrace?.span_type === "embedding"

    // Keep each side in one panel while switching message-like data to the readable view.
    const panels = useMemo(
        () =>
            prepareTraceOverviewPanels({
                inputs,
                outputs,
                isEmbeddingSpan,
            }),
        [inputs, outputs, isEmbeddingSpan],
    )

    return (
        <div className="w-full flex flex-col gap-2">
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

            {panels.inputs ? (
                <div className="flex flex-col gap-2">
                    {spanEntityId ? (
                        <TraceSpanDrillInView
                            spanId={spanEntityId}
                            title="inputs"
                            editable={false}
                            rootScope="span"
                            spanDataOverride={panels.inputs.value}
                            viewModePreset={panels.inputs.hasMessages ? "message" : "default"}
                        />
                    ) : (
                        <AccordionTreePanel
                            label={"inputs"}
                            value={panels.inputs.value as any}
                            enableFormatSwitcher
                            viewModePreset={panels.inputs.hasMessages ? "message" : "default"}
                        />
                    )}
                </div>
            ) : null}

            {hasParameters ? (
                <div className="flex flex-col gap-2">
                    {spanEntityId ? (
                        <TraceSpanDrillInView
                            spanId={spanEntityId}
                            title="parameters"
                            editable={false}
                            rootScope="span"
                            spanDataOverride={parameters}
                            defaultCollapsed
                        />
                    ) : (
                        <AccordionTreePanel
                            label={"parameters"}
                            value={parameters as any}
                            enableFormatSwitcher
                            defaultCollapsed
                        />
                    )}
                </div>
            ) : null}

            {panels.outputs ? (
                <div className="flex flex-col gap-2">
                    {spanEntityId ? (
                        <TraceSpanDrillInView
                            spanId={spanEntityId}
                            title="outputs"
                            editable={false}
                            rootScope="span"
                            spanDataOverride={panels.outputs.value}
                            viewModePreset={panels.outputs.hasMessages ? "message" : "default"}
                        />
                    ) : (
                        <AccordionTreePanel
                            label={"outputs"}
                            value={panels.outputs.value as any}
                            enableFormatSwitcher
                            viewModePreset={panels.outputs.hasMessages ? "message" : "default"}
                        />
                    )}
                </div>
            ) : null}

            {internals && (
                <Space orientation="vertical" className="w-full" size={24}>
                    {nodeType !== "chat" && (
                        <>
                            {spanEntityId ? (
                                <TraceSpanDrillInView
                                    spanId={spanEntityId}
                                    title="internals"
                                    editable={false}
                                    rootScope="span"
                                    spanDataOverride={internals}
                                />
                            ) : (
                                <AccordionTreePanel
                                    label={"internals"}
                                    value={internals}
                                    enableFormatSwitcher
                                />
                            )}
                        </>
                    )}
                </Space>
            )}

            {exception && (
                <Space orientation="vertical" className="w-full" size={24}>
                    {spanEntityId ? (
                        <TraceSpanDrillInView
                            spanId={spanEntityId}
                            title="Exception"
                            editable={false}
                            rootScope="span"
                            spanDataOverride={exception}
                        />
                    ) : null}
                </Space>
            )}
        </div>
    )
}

export default OverviewTabItem
