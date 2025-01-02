/** Common schema types */
export type SchemaType =
    | "string"
    | "number"
    | "boolean"
    | "object"
    | "array"
    | "compound"
    | "null"
    | "integer"

/** Base interface for all schema-related types */
export interface BaseSchema {
    title?: string
    description?: string
    default?: unknown
    required?: boolean
    const?: unknown
    enum?: unknown[]
}

/** Base metadata interface */
export interface BaseMetadata {
    type: SchemaType
    title?: string
    description?: string
    required?: boolean
    nullable?: boolean
}

/** Common option types */
export interface BaseOption {
    label: string
    value: string
    group?: string
}

export interface OptionGroup {
    label: string
    options: BaseOption[]
}

export type SelectOptions = BaseOption[] | OptionGroup[]

/** Compound types */
export interface CompoundOption {
    label: string
    value: string
    config: {
        type: string
        schema?: Record<string, unknown>
        [key: string]: unknown
    }
}

export interface CompoundMetadata extends BaseMetadata {
    type: "compound"
    options: CompoundOption[]
}

/** Base variant interface */
export interface BaseVariant {
    id: string
    name: string
    version?: string
    createdAt?: string
    updatedAt?: string
    appId: string
    baseId: string
    baseName: string
    revision: string | number
    configName: string
    projectId: string
    appName: string
    templateVariantName: string
    variantName: string
}
