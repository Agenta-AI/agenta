export interface ParameterPreviewItem {
    key: string
    displayValue?: string
    fullValue?: string
}

export interface OutputMetric {
    name: string
    type: string
    required: boolean
    description?: string
}

export interface PromptPreviewAttachment {
    type: "image"
    url: string
    alt?: string
}

export interface PromptPreviewSection {
    id: string
    label: string
    role?: string
    content: string
    attachments: PromptPreviewAttachment[]
}

export interface EvaluatorDetails {
    typeSlug?: string
    typeLabel?: string
    typeColor?: string
    parameters: ParameterPreviewItem[]
    visibleParameters: ParameterPreviewItem[]
    parameterPayload: Record<string, string>
    model: string
    outputs: OutputMetric[]
    promptSections: PromptPreviewSection[]
}
