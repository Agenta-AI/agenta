import { memo } from "react"
import PromptMessageUserSelect from "./assets/PromptMessageUserSelect"
import { PromptMessageConfigProps } from "./types"
import type { Path } from "../../types"
import { StateVariant } from "../../state/types"
import PromptMessageContent from "./assets/PromptMessageContent"

const PromptMessageConfig = ({
    variantId,
    configKey,
    valueKey,
}: PromptMessageConfigProps) => {
    return (
        <div className="relative border-solid border border-[#bdc7d1] rounded-[theme(spacing.2)]">
            <PromptMessageUserSelect
                variantId={variantId}
                configKey={`${configKey}.role` as Path<StateVariant>}
                valueKey={`${valueKey}.role` as Path<StateVariant>}
            />
            <PromptMessageContent
                variantId={variantId}
                configKey={`${configKey}.content` as Path<StateVariant>}
                valueKey={`${valueKey}.content` as Path<StateVariant>}
            />
        </div>
    )
}

export default memo(PromptMessageConfig)