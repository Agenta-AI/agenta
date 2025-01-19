import {Button} from "antd"
import {MinusCircle, Copy} from "@phosphor-icons/react"
import {PromptMessageContentOptionsProps} from "./types"
import clsx from "clsx"
import usePlayground from "@/components/NewPlayground/hooks/usePlayground"

const PromptMessageContentOptions = ({
    deleteMessage,
    messageId,
    className,
    propertyId,
    variantId,
    isMessageDeletable,
}: PromptMessageContentOptionsProps) => {
    // TODO: REPLACE THIS WITH A GETTER ACTION FOR PROPERTY VALUE
    const {variantConfigProperty: property} = usePlayground({
        variantId,
        propertyId,
        hookId: "PlaygroundVariantPropertyControl",
    })

    return (
        <div className={clsx("flex items-center gap-1", className)}>
            <Button
                icon={<Copy size={14} />}
                type="text"
                onClick={() => navigator.clipboard.writeText(property?.value)}
            />
            <Button
                icon={<MinusCircle size={14} />}
                type="text"
                onClick={() => deleteMessage(messageId)}
                disabled={isMessageDeletable}
            />
        </div>
    )
}

export default PromptMessageContentOptions
