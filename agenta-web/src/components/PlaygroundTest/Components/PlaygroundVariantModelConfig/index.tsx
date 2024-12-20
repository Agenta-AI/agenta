import {type MouseEvent, memo, useCallback, useMemo, useState} from "react"
import clsx from "clsx"
import {Button, Popover} from "antd"
import {CaretDown} from "@phosphor-icons/react"
import PlaygroundVariantModelConfigTitle from "./assets/PlaygroundVariantModelConfigTitle"
import PlaygroundVariantModelConfigModal from "./assets/PlaygroundVariantModelConfigModal"
import useAgentaConfig from "../../hooks/useAgentaConfig"
import { PlaygroundVariantModelConfigProps } from "./types"
import { LLMConfig } from "../../types/openApiTypes"

const PlaygroundVariantModelConfig = ({
    promptIndex,
    variantId,
}: PlaygroundVariantModelConfigProps) => {
    const [openAdvancedConfigPopover, setOpenAdvancedConfigPopover] = useState(false)
    const {prompt} = useAgentaConfig({variantId, promptIndex})

    const {properties, modelName} = useMemo(() => {
        const llmConfig = prompt?.llm_config
        const llmConfigValue: LLMConfig = llmConfig?.value as LLMConfig || {} as LLMConfig
        const llmConfigProperties = llmConfig?.config
        console.log('llmConfigProperties', prompt, llmConfigProperties)
        const properties = llmConfigProperties ? (Object.keys(llmConfigProperties) as (keyof LLMConfig)[]).map((key) => {
            return {
                key,
                configKey: `${llmConfig.configKey}.${key}`,
                valueKey: `${llmConfig.valueKey}.${key}`,
                value: llmConfigProperties[key]?.default || null,
            }
        }) : []

        return {
            properties,
            modelName: llmConfigValue?.model,
        }
    }, [prompt])

    const closePopover = useCallback((e: MouseEvent<HTMLElement>) => {
        e.preventDefault()
        e.stopPropagation()

        setOpenAdvancedConfigPopover(false)
    }, [])

    const handleResetDefaults = useCallback((e: MouseEvent<HTMLElement>) => {
        console.log("reset defaults")

        closePopover(e)
    }, [closePopover])

    const openPopover = useCallback((e: MouseEvent<HTMLElement>) => {
        e.preventDefault()
        e.stopPropagation()

        // setOpenAdvancedConfigPopover((previous) => {
        //     console.log('set openAdvancedConfigPopover', previous)
        //     return !previous
        // })
    }, [])

    const saveProperties = useCallback(() => {
        console.log("save properties")
    }, [])

    return (
        <Popover
            open={openAdvancedConfigPopover}
            onOpenChange={setOpenAdvancedConfigPopover}
            trigger={["click"]}
            arrow={false}
            title={<PlaygroundVariantModelConfigTitle handleReset={handleResetDefaults} />}
            content={
                <PlaygroundVariantModelConfigModal
                    variantId={variantId}
                    properties={properties}
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
                {modelName ?? "Choose a model"} <CaretDown size={14} />
            </Button>
        </Popover>
    )
}

export default memo(PlaygroundVariantModelConfig)
