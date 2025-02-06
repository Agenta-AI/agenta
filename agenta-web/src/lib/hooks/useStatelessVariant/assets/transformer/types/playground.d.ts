import type {ObjectSchema} from "../../genericTransformer/types"
import type {AgentaConfig} from "./variant"

export interface AgentaConfigSchema extends ObjectSchema {
    type: "object"
    properties: {
        prompt: ObjectSchema
    }
    default: AgentaConfig
}
