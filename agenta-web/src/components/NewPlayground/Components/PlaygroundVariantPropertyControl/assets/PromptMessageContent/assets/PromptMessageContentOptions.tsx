import {Button} from "antd"
import {MinusCircle, Copy} from "@phosphor-icons/react"
import {PromptMessageContentOptionsProps} from "./types"
import clsx from "clsx"
import usePlayground from "@/components/NewPlayground/hooks/usePlayground"
import {findPropertyInObject} from "@/components/NewPlayground/hooks/usePlayground/assets/helpers"
import {findPropertyById} from "@/components/NewPlayground/hooks/usePlayground/middlewares/playgroundVariantMiddleware"
import {EnhancedVariant} from "@/components/NewPlayground/assets/utilities/transformer/types"
import {EnhancedObjectConfig} from "@/components/NewPlayground/assets/utilities/genericTransformer/types"

const PromptMessageContentOptions = ({
    deleteMessage,
    messageId,
    className,
    propertyId,
    variantId,
    rowId,
    isMessageDeletable,
}: PromptMessageContentOptionsProps) => {
    const {baseProperty: property} = usePlayground({
        // variantId,
        // propertyId,
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

    console.log("baseProperty", property)

    return (
        <div className={clsx("flex items-center gap-1", className)}>
            <Button
                icon={<Copy size={14} />}
                type="text"
                onClick={() => {
                    const val = property?.value
                    if (val) {
                        navigator.clipboard.writeText(val)
                    }
                }}
            />
            <Button
                icon={<MinusCircle size={14} />}
                type="text"
                onClick={() => deleteMessage?.(messageId)}
                disabled={isMessageDeletable}
            />
        </div>
    )
}

export default PromptMessageContentOptions
