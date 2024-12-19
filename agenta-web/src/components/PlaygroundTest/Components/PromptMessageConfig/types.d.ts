import {Path} from "../../assets/helpers"
import {StateVariant} from "../../state/types"

export interface PromptMessageConfigProps {
    variantId: string
    configKey: Path<StateVariant>
    valueKey: Path<StateVariant>
}
