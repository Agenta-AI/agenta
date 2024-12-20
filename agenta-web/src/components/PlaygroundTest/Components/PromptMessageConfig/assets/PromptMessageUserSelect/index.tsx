import {useMemo} from "react"
import { Button, Dropdown, MenuProps } from "antd"
import { CaretUpDown } from "@phosphor-icons/react"
import clsx from "clsx"

import usePlaygroundVariantConfig from "@/components/PlaygroundTest/hooks/usePlaygroundVariantConfig"
import { PromptMessageConfigProps } from "../../types"

const PromptMessageUserSelect = ({ configKey, valueKey, variantId }: PromptMessageConfigProps) => {
    const { property } = usePlaygroundVariantConfig({
        configKey,
        valueKey,
        variantId,
    })

    const menuItems: MenuProps['items'] = useMemo(() => {
        interface MenuItemType {
            key: string;
            label: string;
            onClick: () => void;
        }

        return (property?.config?.enum || []).map((option: string): MenuItemType => ({
            key: option,
            label: option,
            onClick: () => property?.handleChange(option)
        }))
    }, [property])

    console.log('render - PromptMessageUserSelect', property)

    if (!property || !property?.config?.enum) return null

    return (
        <Dropdown 
            menu={{ items: menuItems }} 
            trigger={["click"]}
        >
            <Button
                className={clsx([
                    "rounded-md",
                    "bg-white",
                    "mt-1 mx-2 px-2",
                    "border-0",
                    "flex items-center",
                ])}
            >
                {(property?.valueInfo as string) || 'Select...'}  {/* value will be typed as string when config.type is "string" */}
                <CaretUpDown size={14} />
            </Button>
        </Dropdown>
    )
}

export default PromptMessageUserSelect
