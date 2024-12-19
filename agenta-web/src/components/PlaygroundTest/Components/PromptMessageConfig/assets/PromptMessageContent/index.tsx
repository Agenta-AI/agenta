import clsx from "clsx"
import {Input} from "antd"
import usePlaygroundVariantConfig from "@/components/PlaygroundTest/hooks/usePlaygroundVariantConfig"
import {PromptMessageConfigProps} from "../../types"

const {TextArea} = Input

const PromptMessageContent = ({configKey, valueKey, variantId}: PromptMessageConfigProps) => {
    const {property} = usePlaygroundVariantConfig<typeof configKey, typeof valueKey>({
        configKey,
        valueKey,
        variantId,
    })

    console.log("PromptMessageContentArea", valueKey)
    if (!property) return null

    return (
        <TextArea
            rows={4}
            autoSize={{
                minRows: 4,
            }}
            placeholder={property?.config?.title}
            className={clsx(["border-0", "focus:ring-0"])}
            value={property.valueInfo as string}
            onChange={property.handleChange}
        />
    )
}

export default PromptMessageContent
