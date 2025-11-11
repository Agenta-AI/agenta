import {memo} from "react"

import clsx from "clsx"

import {useVariantPrompts} from "@/oss/components/Playground/hooks/useVariantPrompts"

import PlaygroundVariantConfigPrompt from "../../PlaygroundVariantConfigPrompt"
import PlaygroundVariantCustomProperties from "../../PlaygroundVariantCustomProperties"

const PlaygroundVariantConfigEditors = ({
    variantId,
    className,
    ...divProps
}: {
    variantId: string
    className?: string
}) => {
    const {promptIds} = useVariantPrompts(variantId)

    return (
        <div className={clsx("flex flex-col", className)} {...divProps}>
            {promptIds.map((promptId) => (
                <PlaygroundVariantConfigPrompt
                    key={`${variantId}:${promptId as string}`}
                    promptId={promptId}
                    variantId={variantId}
                />
            ))}
            <PlaygroundVariantCustomProperties
                variantId={variantId}
                initialOpen={promptIds.length === 0}
            />
        </div>
    )
}

export default memo(PlaygroundVariantConfigEditors)
