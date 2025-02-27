import {Environment} from "@/oss/lib/Types"

export interface DeploymentEnvironmentTableProps {
    environments: Environment[]
    selectedEnvs: string[]
    setSelectedEnvs: React.Dispatch<React.SetStateAction<string[]>>
    variantId: string
    variantName: string
    revision: string | number
    isLoading: boolean
}
