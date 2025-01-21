import {useState} from "react"
import {MinusCircle, Copy, Check} from "@phosphor-icons/react"
import {PromptMessageContentOptionsProps} from "./types"
import usePlayground from "@/components/NewPlayground/hooks/usePlayground"
import EnhancedButton from "@/components/NewPlayground/assets/EnhancedButton"
import clsx from "clsx"

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
    const [isCopied, setIsCopied] = useState(false)

    const onCopyText = () => {
        setIsCopied(true)
        navigator.clipboard.writeText(property?.value)

        setTimeout(() => {
            setIsCopied(false)
        }, 1000)
    }

    return (
        <div className={clsx("flex items-center gap-1", className)}>
            <EnhancedButton
                icon={isCopied ? <Check size={14} /> : <Copy size={14} />}
                type="text"
                onClick={onCopyText}
                tooltipProps={{title: isCopied ? "Copied" : "Copy"}}
            />

            <EnhancedButton
                icon={<MinusCircle size={14} />}
                type="text"
                onClick={() => deleteMessage(messageId)}
                disabled={isMessageDeletable}
                tooltipProps={{title: "Remove"}}
            />
        </div>
    )
}

export default PromptMessageContentOptions
