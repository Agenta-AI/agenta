import {useEffect, memo} from "react"

import {Spin} from "antd"
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
    const {promptIds, variantExists, debug} = useVariantPrompts(variantId)

    useEffect(() => {
        if (process.env.NODE_ENV !== "production") {
            console.info("[PlaygroundVariantConfigEditors]", {
                variantId,
                promptCount: promptIds.length,
                variantExists,
                debug,
            })
        }
    }, [variantId, promptIds.length, variantExists, debug])

    if (!variantExists) {
        return (
            <div className="flex flex-col items-center justify-center py-6 gap-2">
                <Spin tip="Loading variant configuration…" />
                <span className="text-xs text-gray-500">variantId: {variantId}</span>
            </div>
        )
    }

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
