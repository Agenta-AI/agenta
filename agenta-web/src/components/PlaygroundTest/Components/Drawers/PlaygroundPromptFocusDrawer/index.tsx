import {useCallback} from "react"
import {Drawer, Divider} from "antd"
import {PlaygroundPromptFocusDrawerProps} from "./types"
import usePlayground from "../../../hooks/usePlayground"
import useDrawerWidth from "../../../hooks/useDrawerWidth"
import PlaygroundPromptFocusDrawerHeader from "./assets/PlaygroundPromptFocusDrawerHeader"
import PlaygroundDeploymentConfig from "../../PlaygroundDeploymentConfig"
import PlaygroundVariantConfigPrompt from "../../PlaygroundVariantConfigPrompt"
import PlaygroundPromptToolsConfig from "../../PlaygroundPromptToolsConfig"
import {EnhancedVariant} from "@/components/PlaygroundTest/assets/utilities/transformer/types"

const PlaygroundPromptFocusDrawer: React.FC<PlaygroundPromptFocusDrawerProps> = ({
    variantId,
    ...props
}) => {
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
                    <PlaygroundPromptFocusDrawerHeader
                        variantName={variantName}
                        revision={revision}
                    />
                }
            >
                <PlaygroundDeploymentConfig />

                <Divider className="!my-1.5" />

                {promptIds.map((promptId) => (
                    <PlaygroundVariantConfigPrompt
                        key={promptId as string}
                        promptId={promptId}
                        variantId={variantId}
                    />
                ))}

                <Divider className="!my-1.5" />

                <PlaygroundPromptToolsConfig />
            </Drawer>
        </>
    )
}

export default PlaygroundPromptFocusDrawer
