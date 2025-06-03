/** Metadata interfaces */

import type {Base} from "./base"
import {CompoundOption} from "./options"
import type {SchemaType} from "./schema"

/** Base metadata interface */
export interface BaseMetadata extends Base {
    type: SchemaType
    nullable?: boolean
    key?: string
}

export interface StringMetadata extends BaseMetadata {
    type: "string"
    options?: SelectOptions
    allowFreeform?: boolean
}

export interface NumberMetadata extends BaseMetadata {
    type: "number"
    min?: number
    max?: number
    isInteger?: boolean // Add isInteger flag
}

export interface BooleanMetadata extends BaseMetadata {
    type: "boolean"
    default?: boolean
    options?: SelectOptions
}

export interface ArrayMetadata<T extends ConfigMetadata = ConfigMetadata> extends BaseMetadata {
    type: "array"
    itemMetadata: T // Allow all metadata types for array items
    minItems?: number
    maxItems?: number
}

export interface ObjectMetadata extends BaseMetadata {
    type: "object"
    properties: Record<string, ConfigMetadata>
    additionalProperties?: boolean
}

export interface CompoundMetadata extends BaseMetadata {
    type: "compound"
    options: CompoundOption[]
}

/** Union of all metadata types */
export type ConfigMetadata =
    | StringMetadata
    | NumberMetadata
    | ArrayMetadata
    | ObjectMetadata
    | BooleanMetadata
    | CompoundMetadata
