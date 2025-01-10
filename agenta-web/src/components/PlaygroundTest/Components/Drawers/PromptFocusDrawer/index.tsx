import {useCallback} from "react"
import {Drawer, Divider} from "antd"
import {PromptFocusDrawerProps} from "./types"
import usePlayground from "../../../hooks/usePlayground"
import useDrawerWidth from "../../../hooks/useDrawerWidth"
import PromptFocusDrawerHeader from "./assets/PromptFocusDrawerHeader"
import PlaygroundDeploymentConfig from "../../PlaygroundDeploymentConfig"
import PlaygroundVariantConfigPrompt from "../../PlaygroundVariantConfigPrompt"
import {EnhancedVariant} from "@/components/PlaygroundTest/assets/utilities/transformer/types"

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
                title={<PromptFocusDrawerHeader variantName={variantName} revision={revision} />}
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
            </Drawer>
        </>
    )
}

export default PromptFocusDrawer
