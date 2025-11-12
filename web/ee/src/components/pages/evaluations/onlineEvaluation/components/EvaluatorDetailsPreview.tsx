import {Fragment} from "react"

import {Form, Tag, Tooltip, Typography} from "antd"

import type {EvaluatorDetails, OutputMetric, ParameterPreviewItem} from "../types"

import EvaluatorTypeTag from "./EvaluatorTypeTag"
import PromptPreview from "./PromptPreview"
import ReadOnlyBox from "./ReadOnlyBox"

const {Text} = Typography

interface EvaluatorDetailsPreviewProps {
    details: EvaluatorDetails
    typeLabel?: string
    typeColor?: string
    fallbackColors?: {backgroundColor?: string; textColor?: string}
    showType?: boolean
}

const renderParameterValue = (param: ParameterPreviewItem) => {
    const displayValue = param.displayValue?.trim()
    if (!displayValue) {
        return <Text type="secondary">Not provided</Text>
    }

    const isMultiline = displayValue.includes("\n")
    const baseContent = isMultiline ? (
        <pre className="m-0 max-h-48 overflow-auto whitespace-pre-wrap break-words text-xs text-[#1D2939]">
            {displayValue}
        </pre>
    ) : (
        <span className="text-[#1D2939] break-words">{displayValue}</span>
    )

    if (param.fullValue && param.fullValue !== displayValue) {
        const labelPrefix = param.key ? `${param.key}: ` : ""
        return <Tooltip title={`${labelPrefix}${param.fullValue}`}>{baseContent}</Tooltip>
    }

    return baseContent
}

const renderOutputType = (metric: OutputMetric) => {
    if (!metric.type) return "unknown"
    return metric.type
}

const EvaluatorDetailsPreview = ({
    details,
    typeLabel,
    typeColor,
    fallbackColors,
    showType,
}: EvaluatorDetailsPreviewProps) => {
    const hasParameters = details.visibleParameters.length > 0
    const hasOutputs = (details.outputs?.length ?? 0) > 0
    const hasPrompt = details.promptSections.length > 0

    return (
        <>
            {showType && typeLabel ? (
                <Form.Item label="Evaluator type" style={{marginBottom: 12}}>
                    <div className="flex items-center gap-2">
                        <EvaluatorTypeTag
                            label={typeLabel}
                            color={typeColor}
                            fallback={fallbackColors}
                        />
                    </div>
                </Form.Item>
            ) : null}

            {hasParameters && (
                <Fragment>
                    {details.visibleParameters.map((param, index) => {
                        const rawLabel = param.key?.trim() || "Parameter"
                        const formattedLabel = formatParameterLabel(rawLabel)
                        const labelNode =
                            formattedLabel === rawLabel ? (
                                formattedLabel
                            ) : (
                                <Tooltip title={rawLabel}>{formattedLabel}</Tooltip>
                            )

                        return (
                            <Form.Item
                                key={`${param.key}-${index}`}
                                label={labelNode}
                                colon={false}
                                style={{marginBottom: 12}}
                            >
                                <ReadOnlyBox>{renderParameterValue(param)}</ReadOnlyBox>
                            </Form.Item>
                        )
                    })}
                </Fragment>
            )}

            {/* {details.parameters.length > 0 ? (
                <Form.Item label="Evaluator JSON payload" style={{marginBottom: 12}}>
                    <ReadOnlyBox className="max-h-48 overflow-auto">
                        <pre className="m-0 whitespace-pre-wrap break-words text-xs text-[#1D2939]">
                            {JSON.stringify(details.parameterPayload, null, 2)}
                        </pre>
                    </ReadOnlyBox>
                </Form.Item>
            ) : null} */}

            {hasOutputs &&
                details.outputs.map((metric, index) => (
                    <Form.Item
                        key={`${metric.name}-${index}`}
                        label={index === 0 ? "Output metrics" : ""}
                        colon={index === 0}
                        style={{marginBottom: 12}}
                    >
                        <ReadOnlyBox>
                            <div className="flex flex-wrap items-center gap-2">
                                <span className="font-semibold text-[#475467]">{metric.name}</span>
                                <Tag className="!m-0" bordered={false}>
                                    {renderOutputType(metric)}
                                </Tag>
                                {metric.required ? (
                                    <Tag className="!m-0" bordered={false} color="success">
                                        Required
                                    </Tag>
                                ) : (
                                    <Tag
                                        className="!m-0"
                                        bordered={false}
                                        style={{backgroundColor: "#F2F4F7", color: "#475467"}}
                                    >
                                        Optional
                                    </Tag>
                                )}
                            </div>
                            {metric.description ? (
                                <div className="mt-1 text-[#475467]">{metric.description}</div>
                            ) : null}
                        </ReadOnlyBox>
                    </Form.Item>
                ))}

            {hasPrompt && (
                <Form.Item label="Prompt" style={{marginBottom: 0}}>
                    <PromptPreview sections={details.promptSections} />
                </Form.Item>
            )}
        </>
    )
}

const formatParameterLabel = (value: string) => {
    const trimmed = value.trim()
    if (!trimmed) return "Parameter"

    const withSpaces = trimmed
        .replace(/([a-z0-9])([A-Z])/g, "$1 $2")
        .replace(/[_-]+/g, " ")
        .replace(/\s+/g, " ")
        .trim()

    if (!withSpaces) return "Parameter"

    return withSpaces
        .split(" ")
        .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
        .join(" ")
}

export default EvaluatorDetailsPreview
