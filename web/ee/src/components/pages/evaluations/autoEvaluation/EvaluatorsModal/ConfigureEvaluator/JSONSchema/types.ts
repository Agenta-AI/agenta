export type ResponseFormatType = "continuous" | "boolean" | "categorical"

export interface ContinuousConfig {
    minimum: number
    maximum: number
}

export interface CategoricalOption {
    name: string
    description: string
}

export interface SchemaConfig {
    responseFormat: ResponseFormatType
    includeReasoning: boolean
    continuousConfig?: ContinuousConfig
    categoricalOptions?: CategoricalOption[]
}

export interface JSONSchemaProperty {
    type: string
    description: string
    minimum?: number
    maximum?: number
    enum?: string[]
}

export interface GeneratedJSONSchema {
    name: string
    schema: {
        title: string
        description: string
        type: "object"
        properties: Record<string, JSONSchemaProperty>
        required: string[]
        strict: boolean
    }
}
