import { memo } from "react"
import PromptMessageUserSelect from "./assets/PromptMessageUserSelect"
import PromptMessageContent from "./assets/PromptMessageContent"
import { PromptMessageConfigProps } from "./types"

const PromptMessageConfig = ({
    variantId,
    configKey,
    valueKey,
}: PromptMessageConfigProps) => {
    return (
        <div className="relative border-solid border border-[#bdc7d1] rounded-[theme(spacing.2)]">
            <PromptMessageUserSelect
                variantId={variantId}
                configKey={`${configKey}.role`}
                valueKey={`${valueKey}.role`}
            />
            <PromptMessageContent
                variantId={variantId}
                configKey={`${configKey}.content`}
                valueKey={`${valueKey}.content`}
            />
        </div>
    )
}

export default memo(PromptMessageConfig)