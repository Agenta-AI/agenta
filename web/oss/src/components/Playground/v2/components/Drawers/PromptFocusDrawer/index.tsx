import {useCallback} from "react"

import {Drawer} from "antd"

import {EnhancedVariant} from "@/oss/lib/shared/variant/transformer/types"
import PlaygroundVariantConfigPrompt from "@/oss/components/Playground/Components/PlaygroundVariantConfigPrompt"
import useDrawerWidth from "@/oss/components/Playground/hooks/useDrawerWidth"
import usePlayground from "@/oss/components/Playground/hooks/usePlayground"

import PromptFocusDrawerHeader from "./assets/PromptFocusDrawerHeader"
import {PromptFocusDrawerProps} from "./types"

const PromptFocusDrawer: React.FC<PromptFocusDrawerProps> = ({variantId, ...props}) => {
    const {drawerWidth} = useDrawerWidth()
    const {
        promptIds = [],
        variantName,
        revision,
    } = usePlayground({
        variantId,
        hookId: "PlaygroundConfigVariantPrompts",
        variantSelector: useCallback((variant: EnhancedVariant) => {
            const promptIds = (variant?.prompts || [])?.map((prompt) => prompt.__id) ?? []
            return {promptIds, variantName: variant?.variantName, revision: variant?.revision}
        }, []),
    })

    const onClose = (e: any) => {
        props?.onClose?.(e)
    }

    return (
        <>
            <Drawer
                placement={"right"}
                width={drawerWidth}
                classNames={{body: "!p-0"}}
                onClose={onClose}
                {...props}
                title={
                    <PromptFocusDrawerHeader
                        variantId={variantId}
                        variantName={variantName}
                        revision={revision}
                    />
                }
            >
                {promptIds.map((promptId) => (
                    <PlaygroundVariantConfigPrompt
                        key={promptId as string}
                        promptId={promptId}
                        variantId={variantId}
                    />
                ))}
            </Drawer>
        </>
    )
}

export default PromptFocusDrawer
