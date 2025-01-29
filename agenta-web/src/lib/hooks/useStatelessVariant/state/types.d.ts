import type {OpenAPISpec} from "../assets/utilities/genericTransformer/types"
import type {EnhancedVariant} from "../assets/utilities/transformer/types"

// State Types
export interface InitialStateType {
    variants: EnhancedVariant[]
    selected: string[]
    spec?: OpenAPISpec
    dirtyStates: Record<string, boolean>
    generationData: {
        inputs: EnhancedVariant["inputs"]
        messages: Enhanced<
            {
                history: EnhancedVariant["messages"]
            }[]
        >
    }
}
