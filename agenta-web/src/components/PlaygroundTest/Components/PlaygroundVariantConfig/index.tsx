import {memo} from "react"
import clsx from "clsx"
import useAgentaConfig from "../../hooks/useAgentaConfig"
import {type StateVariant} from "../../state/types"
import PlaygroundVariantConfigHeader from "./assets/PlaygroundVariantConfigHeader"
import PlaygroundVariantConfigPrompt from "../PlaygroundVariantConfigPrompt"

const PlaygroundVariantConfig = ({
    variant,
    variantId,
}: {
    variant: StateVariant
    variantId: string
}) => {
    const {prompts} = useAgentaConfig({variant})
    console.log("render PlaygroundVariant - Config")

    return (
        <div
            className={clsx([
                "grow",
                "w-full h-full",
                "overflow-y-auto",
                "[&_.ant-collapse]:!bg-[transparent]",
                "[&_.ant-collapse-expand-icon]:!self-center",
                "[&_.ant-collapse-content-box]:!px-4",
                "[&_.ant-collapse-header]:!pl-3 [&_.ant-collapse-header]:!pr-4",
            ])}
        >
            <PlaygroundVariantConfigHeader variant={variant} />

            <div className="div flex flex-col gap-2 pb-10">
                {prompts.map((prompt) => {
                    return (
                        <PlaygroundVariantConfigPrompt
                            key={prompt.key}
                            variantId={variantId}
                            prompt={prompt}
                        />
                    )
                })}
            </div>
        </div>
    )
}

export default memo(PlaygroundVariantConfig)
