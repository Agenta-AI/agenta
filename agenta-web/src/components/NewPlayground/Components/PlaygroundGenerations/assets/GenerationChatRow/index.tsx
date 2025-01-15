import {Input} from "antd"
import PlaygroundVariantPropertyControl from "../../../PlaygroundVariantPropertyControl"
import GenerationOutputText from "../GenerationOutputText"
import GenerationVariableOptions from "../GenerationVariableOptions"
import {GenerationChatRowProps} from "./types"

const GenerationChatRow = ({
    variantId,
    message,
    disabled = false,
    type,
}: GenerationChatRowProps) => {
    return (
        <div className="flex items-start gap-2 group/item">
            <div className="w-[120px]">
                <PlaygroundVariantPropertyControl
                    propertyId={message.role.__id}
                    variantId={variantId}
                    as="SimpleDropdownSelect"
                    className="!border border-solid border-[rgba(5,23,41,0.06)] px-2 cursor-not-allowed"
                />
            </div>

            {type === "output" ? (
                <GenerationOutputText
                    text={message.content.value}
                    className="w-full mt-1"
                    disabled={disabled}
                />
            ) : (
                <Input bordered={false} />
            )}

            {!disabled && (
                <GenerationVariableOptions
                    variantId={variantId}
                    rowId={""}
                    className="invisible group-hover/item:visible"
                />
            )}
        </div>
    )
}

export default GenerationChatRow
