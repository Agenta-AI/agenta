import {Button, Dropdown} from "antd"
import {CaretUpDown} from "@phosphor-icons/react"
import clsx from "clsx"

import usePlaygroundVariantConfig from "@/components/PlaygroundTest/hooks/usePlaygroundVariantConfig"
import { PromptMessageConfigProps } from "../../types"

const PromptMessageUserSelect = ({
    configKey,
    valueKey,
    variantId,
}: PromptMessageConfigProps) => {
    const {mutateVariant, config, value} = usePlaygroundVariantConfig({
        configKey,
        valueKey,
        variantId,
    })

    console.log("PromptMessageUserSelect", configKey, valueKey, variantId, config, value)

    return (
        <Dropdown menu={config.enums} trigger={["click"]}>
            <Button
                className={clsx([
                    "rounded-md",
                    "bg-white",
                    "mt-1 mx-2 px-2",
                    "border-0",
                    "flex items-center",
                ])}
            >
                {value}
                <CaretUpDown size={14} />
            </Button>
        </Dropdown>
    )
}

export default PromptMessageUserSelect
