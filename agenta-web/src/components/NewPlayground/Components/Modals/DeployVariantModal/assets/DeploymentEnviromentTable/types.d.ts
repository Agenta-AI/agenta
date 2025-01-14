import {Enhanced} from "@/components/NewPlayground/assets/utilities/genericTransformer/types"
import {
    AgentaConfigPrompt,
    EnhancedVariant,
} from "@/components/NewPlayground/assets/utilities/transformer/types"
import {Environment, Variant} from "@/lib/Types"

export type DeploymentEnviromentTableProps = {
    environments: Environment[]
    selectedEnvs: string[]
    setSelectedEnvs: React.Dispatch<React.SetStateAction<string[]>>
    variantId: string
    variant: EnhancedVariant<Enhanced<AgentaConfigPrompt>> | undefined
    isLoading: boolean
}
