import clsx from "clsx"
import {Input} from "antd"
import usePlaygroundVariantConfig from "@/components/PlaygroundTest/hooks/usePlaygroundVariantConfig"
import { PromptMessageConfigProps } from "../../types"

const {TextArea} = Input

const PromptMessageContent = ({
    configKey,
    valueKey,
    variantId,
}: PromptMessageConfigProps) => {
    const {mutateVariant, property} = usePlaygroundVariantConfig({
        configKey,
        valueKey,
        variantId,
    })

    console.log("PromptMessageContentArea", configKey, valueKey, variantId, property)

    return (
       <TextArea
        rows={4}
        autoSize={{
            minRows: 4,
        }}
        placeholder={property.config.title}
        className={clsx(["border-0", "focus:ring-0"])}
        value={property.valueInfo}
        onChange={property.handleChange}
    />
    )
}

export default PromptMessageContent
