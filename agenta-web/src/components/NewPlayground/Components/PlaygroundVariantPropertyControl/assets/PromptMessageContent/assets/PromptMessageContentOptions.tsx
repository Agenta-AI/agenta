import {useState} from "react"
import {MinusCircle, Copy, Check} from "@phosphor-icons/react"
import {PromptMessageContentOptionsProps} from "./types"
import usePlayground from "@/components/NewPlayground/hooks/usePlayground"
import {findPropertyInObject} from "@/components/NewPlayground/hooks/usePlayground/assets/helpers"
import {findPropertyById} from "@/components/NewPlayground/hooks/usePlayground/middlewares/playgroundVariantMiddleware"
import {EnhancedVariant} from "@/components/NewPlayground/assets/utilities/transformer/types"
import {EnhancedObjectConfig} from "@/components/NewPlayground/assets/utilities/genericTransformer/types"
import EnhancedButton from "@/components/NewPlayground/assets/EnhancedButton"
import clsx from "clsx"

const PromptMessageContentOptions = ({
    deleteMessage,
    messageId,
    className,
    propertyId,
    variantId,
    rowId,
    isMessageDeletable,
}: PromptMessageContentOptionsProps) => {
    // TODO: REPLACE THIS WITH A GETTER ACTION FOR PROPERTY VALUE
    const {baseProperty: property} = usePlayground({
        hookId: "PlaygroundVariantPropertyControl",
        stateSelector: (state) => {
            const object = !!rowId
                ? state.generationData.inputs.value.find((v) => v.__id === rowId) ||
                  state.generationData.messages.value.find((v) => v.__id === rowId)
                : variantId
                  ? state.variants.find((v) => v.id === variantId)
                  : null

            if (!object) {
                return {}
            } else {
                const property = !!rowId
                    ? (findPropertyInObject(object, propertyId) as EnhancedObjectConfig<any>)
                    : (findPropertyById(
                          object as EnhancedVariant,
                          propertyId,
                      ) as EnhancedObjectConfig<any>)
                return {baseProperty: property}
            }
        },
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
                onClick={() => deleteMessage?.(messageId)}
                disabled={isMessageDeletable}
                tooltipProps={{title: "Remove"}}
            />
        </div>
    )
}

export default PromptMessageContentOptions
