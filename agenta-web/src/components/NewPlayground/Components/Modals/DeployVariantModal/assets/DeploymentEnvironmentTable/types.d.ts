import {Environment, Variant} from "@/lib/Types"

export type DeploymentEnvironmentTableProps = {
    environments: Environment[]
    selectedEnvs: string[]
    setSelectedEnvs: React.Dispatch<React.SetStateAction<string[]>>
    variantId: string
    variantName: string
    revision: string | number
    isLoading: boolean
}
