import {memo} from "react"

import {Play} from "@phosphor-icons/react"
import {Button, Typography} from "antd"

const ConfigureProviderDrawerTitle = () => {
    return (
        <div className="flex items-center justify-between">
            <Typography.Text className="text-sm font-medium">Configure provider</Typography.Text>
            <Button
                icon={<Play size={14} className="mt-1" />}
                href="https://docs.agenta.ai/prompt-engineering/playground/adding-custom-providers"
                target="_blank"
            >
                How to use
            </Button>
        </div>
    )
}

export default memo(ConfigureProviderDrawerTitle)
