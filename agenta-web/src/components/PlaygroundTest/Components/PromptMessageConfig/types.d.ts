import type {StateVariant} from "../../state/types"
import type {Path} from "../../types/pathHelpers"

export interface PromptMessageConfigProps {
    variantId: string
    configKey: Path<StateVariant>
    valueKey: Path<StateVariant>
}
