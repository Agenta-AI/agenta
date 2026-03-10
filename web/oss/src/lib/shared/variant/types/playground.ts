import type {Merge, ObjectSchema} from "@agenta/entities/legacyAppRevision"

import type {AgentaConfig} from "./variantConfig"

type X<T> = T extends "prompt" ? never : T

export interface AgentaConfigSchema<T = string> extends ObjectSchema {
    type: "object"
    properties: Merge<
        Record<X<T>, ObjectSchema>,
        {
            prompt: ObjectSchema
        }
    >
    default: Merge<Record<X<T>, AgentaConfig>>
}
