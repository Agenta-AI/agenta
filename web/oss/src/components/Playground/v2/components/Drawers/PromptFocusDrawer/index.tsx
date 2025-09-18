import {useMemo} from "react"

import {Drawer} from "antd"
import {useAtomValue} from "jotai"

import PlaygroundVariantConfigPrompt from "@/oss/components/Playground/Components/PlaygroundVariantConfigPrompt"
import useDrawerWidth from "@/oss/components/Playground/hooks/useDrawerWidth"
import {newestRevisionForVariantIdAtomFamily} from "@/oss/components/Playground/state/atoms"

import PromptFocusDrawerHeader from "./assets/PromptFocusDrawerHeader"
import {PromptFocusDrawerProps} from "./types"

const PromptFocusDrawer: React.FC<PromptFocusDrawerProps> = ({variantId, ...props}) => {
    const {drawerWidth} = useDrawerWidth()
    const enhanced = useAtomValue(newestRevisionForVariantIdAtomFamily(variantId))
    const {promptIds, variantName, revision} = useMemo(() => {
        if (!enhanced) {
            return {promptIds: [], variantName: undefined, revision: undefined}
        }
        const promptIds = (enhanced?.prompts || [])?.map((p: any) => p.__id) ?? []
        return {
            promptIds,
            variantName: (enhanced as any)?.variantName,
            revision: (enhanced as any)?.revision,
        }
    }, [enhanced])

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
