import {Drawer, Divider} from "antd"
import {PlaygroundPromptFocusDrawerProps} from "./types"
import usePlayground from "../../../hooks/usePlayground"
import useDrawerWidth from "../../../hooks/useDrawerWidth"
import PlaygroundPromptFocusDrawerHeader from "./assets/PlaygroundPromptFocusDrawerHeader"
import PlaygroundDeploymentConfig from "../../PlaygroundDeploymentConfig"
import {variantToPromptsSelector} from "../../PlaygroundVariantConfig/assets/helpers"
import PlaygroundVariantConfigPrompt from "../../PlaygroundVariantConfigPrompt"
import PlaygroundPromptToolsConfig from "../../PlaygroundPromptToolsConfig"

const PlaygroundPromptFocusDrawer: React.FC<PlaygroundPromptFocusDrawerProps> = ({
    variantId,
    ...props
}) => {
    const {drawerWidth} = useDrawerWidth()
    const {
        prompts = [],
        variantName,
        revision,
    } = usePlayground({
        variantId,
        hookId: "PlaygroundConfigVariantPrompts",
        variantSelector: (variant) => ({
            ...variantToPromptsSelector(variant),
            variantName: variant?.variantName,
            revision: variant?.revision,
        }),
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

                {prompts.map((prompt, promptIndex) => (
                    <PlaygroundVariantConfigPrompt
                        key={prompt.key as string}
                        promptIndex={promptIndex}
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
