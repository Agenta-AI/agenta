import {type MouseEvent, memo, useCallback, useMemo, useState} from "react"
import clsx from "clsx"
import {Button, Popover} from "antd"
import {CaretDown} from "@phosphor-icons/react"
import PlaygroundVariantModelConfigTitle from "./assets/PlaygroundVariantModelConfigTitle"
import PlaygroundVariantModelConfigModal from "./assets/PlaygroundVariantModelConfigModal"
import useAgentaConfig from "../../hooks/useAgentaConfig"
import { ModelDefaults } from "../../state/types"

interface PlaygroundVariantModelConfigProps {
    variantId: string
    promptIndex: number
}

const PlaygroundVariantModelConfig = ({
    promptIndex,
    variantId,
}: PlaygroundVariantModelConfigProps) => {
    const [openAdvancedConfigPopover, setOpenAdvancedConfigPopover] = useState(false)
    const {prompt} = useAgentaConfig({variantId, promptIndex})

    const {promptDefaults, promptModel} = useMemo(() => {
        const modelProperties: ModelDefaults[] = prompt?.modelDefaults || []
        const property = modelProperties.find((mp) => mp.key === "model")
        const value = property?.value as string
        return {promptModel: value, promptDefaults: modelProperties}
    }, [prompt])

    const handleResetDefaults = useCallback((e: MouseEvent<HTMLElement>) => {
        console.log("reset defaults")

        closePopover(e)
    }, [])

    const closePopover = useCallback((e: MouseEvent<HTMLElement>) => {
        e.preventDefault()
        e.stopPropagation()

        setOpenAdvancedConfigPopover(false)
    }, [])

    const openPopover = useCallback((e: MouseEvent<HTMLElement>) => {
        e.preventDefault()
        e.stopPropagation()

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
                    properties={promptDefaults}
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
                {promptModel || null} <CaretDown size={14} />
            </Button>
        </Popover>
    )
}

export default memo(PlaygroundVariantModelConfig)
