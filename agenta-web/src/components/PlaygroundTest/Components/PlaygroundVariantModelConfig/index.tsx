import {memo, useCallback, useState} from "react"
import clsx from "clsx"
import {Button, Popover} from "antd"
import {CaretDown} from "@phosphor-icons/react"
import {ConfigProperty} from "../../state/types"
import PlaygroundVariantModelConfigTitle from "./assets/PlaygroundVariantModelConfigTitle"
import PlaygroundVariantModelConfigModal from "./assets/PlaygroundVariantModelConfigModal"

interface PlaygroundVariantModelConfigProps {
    variantId: string
    modelProperties: ConfigProperty[]
}

const PlaygroundVariantModelConfig = ({
    modelProperties,
    variantId,
}: PlaygroundVariantModelConfigProps) => {
    const [openAdvancedConfigPopover, setOpenAdvancedConfigPopover] = useState(false)
    const promptModel = modelProperties.find((mp) => mp.title === "Model")

    const handleResetDefaults = useCallback(() => {
        console.log("reset defaults")
    }, [])

    const closePopover = useCallback(() => {
        setOpenAdvancedConfigPopover(false)
    }, [])
    const openPopover = useCallback(() => {
        setOpenAdvancedConfigPopover(true)
    }, [])

    const saveProperties = useCallback(() => {
        console.log("save properties")
    }, [])

    return (
        <Popover
            open={openAdvancedConfigPopover}
            onOpenChange={() => setOpenAdvancedConfigPopover(false)}
            trigger={["click"]}
            arrow={false}
            title={<PlaygroundVariantModelConfigTitle handleReset={handleResetDefaults} />}
            content={
                <PlaygroundVariantModelConfigModal
                    variantId={variantId}
                    properties={modelProperties}
                    handleClose={closePopover}
                    handleSave={saveProperties}
                />
            }
            overlayClassName={clsx([
                "[&_.ant-popover-inner-content]:px-3 [&_.ant-popover-inner-content]:py-2 [&_.ant-popover-inner-content]:pt-1",
                "[&._ant-popover-title]:mb-0",
                "[&_.ant-popover-inner]:p-0",
                "[&_.ant-popover-title_>_div]:p-2",
                "[&_.ant-popover-title]:p-1 [&_.ant-popover-title]:border-solid [&_.ant-popover-title]:border-0 [&_.ant-popover-title]:border-b [&_.ant-popover-title]:border-[#0517290f]",
            ])}
        >
            <Button onClick={openPopover}>
                {promptModel?.default} <CaretDown size={14} />
            </Button>
        </Popover>
    )
}

export default memo(PlaygroundVariantModelConfig)
