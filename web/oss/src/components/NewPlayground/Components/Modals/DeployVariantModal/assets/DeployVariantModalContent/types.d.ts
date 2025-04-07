import {ExtendedEnvironment} from "../../types"

export interface DeployVariantModalContentProps {
    environments: ExtendedEnvironment[]
    selectedEnvName: string[]
    setSelectedEnvName: React.Dispatch<React.SetStateAction<string[]>>
    variantName: string
    revision: string | number
    isLoading: boolean
    note: string
    setNote: React.Dispatch<React.SetStateAction<string>>
}
